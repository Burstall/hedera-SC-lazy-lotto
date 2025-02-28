// SPDX-License-Identifier: ISC
pragma solidity >=0.8.12 <0.9.0;

/// @title LazyTradeLotto
/// @author stowerling.eth / stowerling.hbar
/// @notice This contract is a decentralized lotto system to reward users for using the Lazy Secure Trade platform.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {HederaAccountService} from "./HederaAccountService.sol";

import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

contract LazyTradeLotto is Ownable, ReentrancyGuard, HederaAccountService {
	using Address for address;

	event LottoRoll (
		address indexed _user,
		address indexed _token,
		uint256 _serial,
		uint256 _nonce,
		bool _buyer,
		uint256 _winRateThreshold,
		uint256 _winRoll,
		uint256 _minWinAmt,
		uint256 _maxWinAmt,
		uint256 _winAmount,
		uint256 _jackpotThreshold,
		uint256 _jackpotRoll
	);

	event JackpotWin (
		address indexed _user,
		uint256 _jackpotThreshold,
		uint256 _jackpotRoll,
		uint256 _jackpotAmt
	);

	event JackpotUpdate (
		uint256 _amount
	);

	event ContractUpdate (
		string _functionName,
		address _sender,
		uint256 _amount,
		string _message
	);


	error InvalidUserSignature();
	error InvalidTeamSignature();
	error BadArguments(string message);
	error AlreadyRolled();

	mapping(bytes32 => bool) public history;

	// win rate expressed in integer from (0-100_000_000) as a threshold for winning
	uint256 public constant MAX_WIN_RATE_THRESHOLD = 100_000_000;

	address public immutable LSH_GEN1;
	address public immutable LSH_GEN2;
	address public immutable LSH_GEN1_MUTANT;

	IPrngSystemContract public prngSystemContract;
	ILazyGasStation public lazyGasStation;
	ILazyDelegateRegistry public lazyDelegateRegistry;

	address public systemWallet;

	uint256 public jackpotPool;
	uint256 public jackpotsWon;
	uint256 public jackpotPaid;
	uint256 public totalRolls;
	uint256 public totalWins;
	// exclude the jackpot from the total paid
	uint256 public totalPaid;
	uint256 public lottoLossIncrement;
	uint256 public burnPercentage;

	constructor(
		address _prngSystemContract,
		address _lazyGasStation,
		address _lazyDelegateRegistry,
		address _lshGen1,
		address _lshGen2,
		address _lshGen1Mutant,
		address _systemWallet,
		uint256 _initialJackpot,
		uint256 _lottoLossIncrement,
		uint256 _burnPercentage) {
		if (!_prngSystemContract.isContract() || _prngSystemContract == address(0)) {
			revert BadArguments("PRNG Contract");
		}
		if (!_lazyGasStation.isContract() || _lazyGasStation == address(0)) {
			revert BadArguments("Lazy Gas Station");
		}
		if (_systemWallet == address(0)) {
			revert BadArguments("System Wallet");
		}
		if (_lshGen1 == address(0) || _lshGen2 == address(0) || _lshGen1Mutant == address(0)) {
			revert BadArguments("LSH Tokens");
		}

		prngSystemContract = IPrngSystemContract(_prngSystemContract);
		lazyGasStation = ILazyGasStation( _lazyGasStation);
		lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);
		systemWallet = _systemWallet;

		LSH_GEN1 = _lshGen1;
		LSH_GEN2 = _lshGen2;
		LSH_GEN1_MUTANT = _lshGen1Mutant;

		jackpotPool = _initialJackpot;
		lottoLossIncrement = _lottoLossIncrement;
		burnPercentage = _burnPercentage;
	}


	function rollLotto(
		address token,
		uint256 serial,
		uint256 nonce,
		bool buyer,
		uint256 winRateThreshold,
		uint256 minWinAmt,
		uint256 maxWinAmt,
		uint256 jackpotThreshold,
		bytes memory teamSignature
	) external nonReentrant {
		// each trade can be rolled by both the buyer and the seller but only once
		bytes32 hash = keccak256(abi.encodePacked(token, serial, nonce, buyer));
		
		// design note: not using timestamp as history of rolls is used to prevent replay attacks

		if (history[hash]) {
			revert AlreadyRolled();
		}

		// update the history early (before the signature checks) to prevent replay attacks as good hygiene even if reentrancy guard is present
		history[hash] = true;

		// check the parameters are valid
		if (token == address(0) || token == address(0) || serial == 0) {
			revert BadArguments("Trade Params");
		}

		if (minWinAmt > maxWinAmt || maxWinAmt == 0) {
			revert BadArguments("Win Amounts");
		}

		if (winRateThreshold > MAX_WIN_RATE_THRESHOLD) {
			revert BadArguments("Win Rate");
		}

		if (jackpotThreshold > MAX_WIN_RATE_THRESHOLD) {
			revert BadArguments("Jackpot Rate");
		}

		// validate the team signed the message to validate the off-chain data on win rates and jackpot thresholds for the calling user
		bytes memory message = abi.encodePacked(msg.sender, token, serial, nonce, buyer, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold);

		// check the signatures using the isAuthorizedRaw method of the Hedera Account Service
		( , bool teamAuthorized) = isAuthorizedRaw(systemWallet, message, teamSignature);

		if (!teamAuthorized) {
			revert InvalidTeamSignature();
		}

		// let's roll!

		// get 2 random numbers for the win rate and the jackpot threshold
		uint256[] memory winRolls = prngSystemContract.getPseudorandomNumberArray(0, MAX_WIN_RATE_THRESHOLD, nonce, 2);

		uint256 winAmt;
		if (winRateThreshold > winRolls[0]) {
			// we have a winner!
			winAmt = prngSystemContract.getPseudorandomNumber(minWinAmt, maxWinAmt, maxWinAmt + nonce);

			// pay the winner
			lazyGasStation.payoutLazy(msg.sender, winAmt, burnPercentage);

			totalWins += 1;
			totalPaid += winAmt;
		}

		// check for the jackpot
		if (jackpotThreshold > winRolls[1]) {
			// we have a jackpot winner!
			uint256 jackpotAmt = jackpotPool;

			// pay the jackpot winner
			lazyGasStation.payoutLazy(msg.sender, jackpotAmt, burnPercentage);

			// update the jackpot stats
			jackpotPool = 0;
			jackpotsWon += 1;
			jackpotPaid += jackpotAmt;

			emit JackpotWin(msg.sender, jackpotThreshold, winRolls[1], jackpotAmt);
		}
		else {
			// update the jackpot pool
			jackpotPool += lottoLossIncrement;
		}

		// update the stats
		totalRolls += 1;

		// log the roll
		// [moved due to stack depth issues]
		postLottoRoll(token, serial, nonce, buyer, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold, winRolls, winAmt);

		emit JackpotUpdate(jackpotPool);
	}

	function boostJackpot(uint256 amount) external onlyOwner {
		jackpotPool += amount;

		emit JackpotUpdate(amount);
	}

	function updateJackpotLossIncrement(uint256 increment) external onlyOwner {
		lottoLossIncrement = increment;

		emit ContractUpdate("JackpotLossIncrement", msg.sender, increment, "Updated");
	}

	function updateBurnPercentage(uint256 percentage) external onlyOwner {
		burnPercentage = percentage;

		emit ContractUpdate("BurnPercentage", msg.sender, percentage, "Updated");
	}

	function updateSystemWallet(address newWallet) external onlyOwner {
		systemWallet = newWallet;

		emit ContractUpdate("SystemWallet", msg.sender, 0, "Updated");
	}

	function getBurnForUser(address _user) public view returns (uint256) {
		if (IERC721(LSH_GEN1).balanceOf(_user) == 0 &&
				 IERC721(LSH_GEN2).balanceOf(_user)== 0 &&
				 IERC721(LSH_GEN1_MUTANT).balanceOf(_user) == 0 &&
				 lazyDelegateRegistry.getSerialsDelegatedTo(_user, LSH_GEN1).length == 0 &&
				 lazyDelegateRegistry.getSerialsDelegatedTo(_user, LSH_GEN2).length == 0 &&
				 lazyDelegateRegistry.getSerialsDelegatedTo(_user, LSH_GEN1_MUTANT).length == 0) {
			return 0;
		}
		else {
			return burnPercentage;
		}
	}

	function postLottoRoll(
		address token,
		uint256 serial,
		uint256 nonce,
		bool buyer,
		uint256 winRateThreshold,
		uint256 minWinAmt,
		uint256 maxWinAmt,
		uint256 jackpotThreshold,
		uint256[] memory winRolls,
		uint256 winAmt
	) internal {
		emit LottoRoll(
			msg.sender,
			token,
			serial,
			nonce,
			buyer,
			winRateThreshold,
			winRolls[0],
			minWinAmt,
			maxWinAmt,
			winAmt,
			jackpotThreshold,
			winRolls[1]
		);
	}

		/***
	 * @notice Remove Hbar from the contract
	 * Used on sunset to avoid trapped collateral
	 * **ONLY OWNER**
	 * @param receiverAddress the address to send the Hbar to
	 * @param amount the amount of Hbar to send
	 */
    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyOwner
    {
		if (receiverAddress == address(0)) {
			revert BadArguments("Address");
		} else if (amount == 0) {
			revert BadArguments("Amount");
		}

		Address.sendValue(receiverAddress, amount);
    }

	// Default methods to allow HBAR to be received in EVM
    receive() external payable {
        emit ContractUpdate(
            "Receive",
            msg.sender,
            msg.value,
			"Received HBAR"
        );
    }

    fallback() external payable {
        emit ContractUpdate(
            "Fallback",
            msg.sender,
            msg.value,
			"Fallback"
        );
    }
}