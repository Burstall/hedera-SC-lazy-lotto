// SPDX-License-Identifier: ISC
pragma solidity >=0.8.12 <0.9.0;

/// @title LazyTradeLotto
/// @author stowerling.eth / stowerling.hbar
/// @notice This contract is a decentralized lotto system to reward users for using the Lazy Secure Trade platform.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

contract LazyTradeLotto is Ownable, ReentrancyGuard {
    using Address for address;

    event LottoRoll(
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

    event JackpotWin(
        address indexed _user,
        uint256 _jackpotThreshold,
        uint256 _jackpotRoll,
        uint256 _jackpotAmt
    );

    event JackpotUpdate(uint256 _amount);

    event ContractUpdate(
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
        uint256 _burnPercentage
    ) {
        if (
            !_prngSystemContract.isContract() ||
            _prngSystemContract == address(0)
        ) {
            revert BadArguments("PRNG Contract");
        }
        if (!_lazyGasStation.isContract() || _lazyGasStation == address(0)) {
            revert BadArguments("Lazy Gas Station");
        }
        if (_systemWallet == address(0)) {
            revert BadArguments("System Wallet");
        }
        if (
            _lshGen1 == address(0) ||
            _lshGen2 == address(0) ||
            _lshGen1Mutant == address(0)
        ) {
            revert BadArguments("LSH Tokens");
        }
        if (
            !_lazyDelegateRegistry.isContract() ||
            _lazyDelegateRegistry == address(0)
        ) {
            revert BadArguments("Lazy Delegate Registry");
        }

        prngSystemContract = IPrngSystemContract(_prngSystemContract);
        lazyGasStation = ILazyGasStation(_lazyGasStation);
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

        // update the history early to prevent replay attacks as good hygiene even if reentrancy guard is present
        history[hash] = true;

        // Validate parameters and signature (moved to a separate function to reduce stack usage)
        validateRollParameters(
            token,
            serial,
            nonce,
            buyer,
            winRateThreshold,
            minWinAmt,
            maxWinAmt,
            jackpotThreshold,
            teamSignature
        );

        // Get random rolls and process the lotto roll
        uint256[] memory winRolls = prngSystemContract
            .getPseudorandomNumberArray(0, MAX_WIN_RATE_THRESHOLD, nonce, 2);

        // Check for regular win and handle prize distribution
        uint256 winAmt = processRegularWin(
            winRateThreshold,
            minWinAmt,
            maxWinAmt,
            nonce,
            winRolls[0]
        );

        // Check for jackpot win
        processJackpotWin(jackpotThreshold, winRolls[1]);

        // Update the stats and emit events
        totalRolls += 1;

        // log the roll
        postLottoRoll(
            token,
            serial,
            nonce,
            buyer,
            winRateThreshold,
            minWinAmt,
            maxWinAmt,
            jackpotThreshold,
            winRolls,
            winAmt
        );

        emit JackpotUpdate(jackpotPool);
    }

    /**
     * @dev Validate all the parameters for a lotto roll
     * This is extracted to a separate function to resolve stack too deep errors
     */
    function validateRollParameters(
        address token,
        uint256 serial,
        uint256 nonce,
        bool buyer,
        uint256 winRateThreshold,
        uint256 minWinAmt,
        uint256 maxWinAmt,
        uint256 jackpotThreshold,
        bytes memory teamSignature
    ) internal view returns (bool) {
        // check the parameters are valid
        if (token == address(0) || serial == 0) {
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

        // Create the raw message
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                msg.sender,
                token,
                serial,
                nonce,
                buyer,
                winRateThreshold,
                minWinAmt,
                maxWinAmt,
                jackpotThreshold
            )
        );

        bytes32 ethSignedMessageHash = ECDSA.toEthSignedMessageHash(
            messageHash
        );

        address recoveredSigner = ECDSA.recover(
            ethSignedMessageHash,
            teamSignature
        );

        if (recoveredSigner != systemWallet) {
            revert InvalidTeamSignature();
        }

        return true;
    }

    /**
     * @dev Process regular win condition and payout
     * @return winAmt The amount won (or 0 if no win)
     */
    function processRegularWin(
        uint256 winRateThreshold,
        uint256 minWinAmt,
        uint256 maxWinAmt,
        uint256 nonce,
        uint256 randomRoll
    ) private returns (uint256 winAmt) {
        winAmt = 0;
        if (winRateThreshold >= randomRoll) {
            // we have a winner!
            winAmt = prngSystemContract.getPseudorandomNumber(
                minWinAmt,
                maxWinAmt,
                maxWinAmt + nonce
            );

            // pay the winner
            lazyGasStation.payoutLazy(msg.sender, winAmt, burnPercentage);

            totalWins += 1;
            totalPaid += winAmt;
        }
        return winAmt;
    }

    /**
     * @dev Process jackpot win condition and payout
     */
    function processJackpotWin(
        uint256 jackpotThreshold,
        uint256 randomRoll
    ) private {
        if (jackpotThreshold >= randomRoll) {
            // we have a jackpot winner!
            uint256 jackpotAmt = jackpotPool;

            // pay the jackpot winner
            lazyGasStation.payoutLazy(msg.sender, jackpotAmt, burnPercentage);

            // update the jackpot stats
            jackpotPool = 0;
            jackpotsWon += 1;
            jackpotPaid += jackpotAmt;

            emit JackpotWin(
                msg.sender,
                jackpotThreshold,
                randomRoll,
                jackpotAmt
            );
        }

        // update the jackpot pool
        // ensures there is always some amount in the jackpot pool to give out
        // nobody is excited by a 0 jackpot!
        jackpotPool += lottoLossIncrement;
    }

    function boostJackpot(uint256 amount) external onlyOwner {
        jackpotPool += amount;

        emit JackpotUpdate(amount);
    }

    function updateJackpotLossIncrement(uint256 increment) external onlyOwner {
        lottoLossIncrement = increment;

        emit ContractUpdate(
            "JackpotLossIncrement",
            msg.sender,
            increment,
            "Updated"
        );
    }

    function updateBurnPercentage(uint256 percentage) external onlyOwner {
        burnPercentage = percentage;

        emit ContractUpdate(
            "BurnPercentage",
            msg.sender,
            percentage,
            "Updated"
        );
    }

    function updateSystemWallet(address newWallet) external onlyOwner {
        systemWallet = newWallet;

        emit ContractUpdate("SystemWallet", msg.sender, 0, "Updated");
    }

    function getBurnForUser(address _user) public view returns (uint256) {
        if (
            IERC721(LSH_GEN1).balanceOf(_user) > 0 ||
            IERC721(LSH_GEN2).balanceOf(_user) > 0 ||
            IERC721(LSH_GEN1_MUTANT).balanceOf(_user) > 0 ||
            lazyDelegateRegistry.getSerialsDelegatedTo(_user, LSH_GEN1).length >
            0 ||
            lazyDelegateRegistry.getSerialsDelegatedTo(_user, LSH_GEN2).length >
            0 ||
            lazyDelegateRegistry
                .getSerialsDelegatedTo(_user, LSH_GEN1_MUTANT)
                .length >
            0
        ) {
            return 0;
        } else {
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
     * @notice Get the current jackpot pool and stats in one call
     * @dev This is a view function that returns the current jackpot pool and stats
     * @return _jackpotPool the current jackpot pool
     * @return _jackpotsWon the total number of jackpots won
     * @return _jackpotPaid the total amount of jackpots paid out
     * @return _totalRolls the total number of rolls
     * @return _totalWins the total number of wins
     * @return _totalPaid the total amount paid out
     * @return _lottoLossIncrement the current jackpot loss increment
     */
    function getLottoStats()
        external
        view
        returns (
            uint256 _jackpotPool,
            uint256 _jackpotsWon,
            uint256 _jackpotPaid,
            uint256 _totalRolls,
            uint256 _totalWins,
            uint256 _totalPaid,
            uint256 _lottoLossIncrement
        )
    {
        return (
            jackpotPool,
            jackpotsWon,
            jackpotPaid,
            totalRolls,
            totalWins,
            totalPaid,
            lottoLossIncrement
        );
    }

    /***
     * @notice Remove Hbar from the contract
     * Used on sunset to avoid trapped collateral
     * **ONLY OWNER**
     * @param receiverAddress the address to send the Hbar to
     * @param amount the amount of Hbar to send
     */
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyOwner {
        if (receiverAddress == address(0)) {
            revert BadArguments("Address");
        } else if (amount == 0) {
            revert BadArguments("Amount");
        }

        Address.sendValue(receiverAddress, amount);
    }

    // Default methods to allow HBAR to be received in EVM
    receive() external payable {
        emit ContractUpdate("Receive", msg.sender, msg.value, "Received HBAR");
    }

    fallback() external payable {
        emit ContractUpdate("Fallback", msg.sender, msg.value, "Fallback");
    }
}
