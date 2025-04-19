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
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

contract LazyTradeLotto is Ownable, ReentrancyGuard, Pausable {
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

    /// @notice Mapping to track rolls that have been made to prevent replay attacks
    /// @dev Maps hash of transaction details to a boolean indicating if it has been processed
    mapping(bytes32 => bool) public history;

    /// @notice Maximum possible threshold for winning (100%)
    /// @dev Expressed as integer from 0-100,000,000 where 100,000,000 represents 100%
    uint256 public constant MAX_WIN_RATE_THRESHOLD = 100_000_000;

    /// @notice Address of the LSH Gen 1 NFT contract
    address public immutable LSH_GEN1;
    /// @notice Address of the LSH Gen 2 NFT contract
    address public immutable LSH_GEN2;
    /// @notice Address of the LSH Gen 1 Mutant NFT contract
    address public immutable LSH_GEN1_MUTANT;

    /// @notice Interface to the PRNG system contract for random number generation
    IPrngSystemContract public prngSystemContract;
    /// @notice Interface to the Lazy Gas Station contract for token payouts
    ILazyGasStation public lazyGasStation;
    /// @notice Interface to the Lazy Delegate Registry contract for NFT delegation
    ILazyDelegateRegistry public lazyDelegateRegistry;

    /// @notice Address of the wallet that signs transaction parameters
    address public systemWallet;

    /// @notice Current amount in the jackpot pool
    uint256 public jackpotPool;
    /// @notice Maximum threshold for the jackpot pool
    uint256 public maxJackpotPool;
    /// @notice Total number of jackpots won
    uint256 public jackpotsWon;
    /// @notice Total amount paid out in jackpots
    uint256 public jackpotPaid;
    /// @notice Total number of lotto rolls
    uint256 public totalRolls;
    /// @notice Total number of regular wins
    uint256 public totalWins;
    /// @notice Total amount paid out in regular wins (excluding jackpots)
    uint256 public totalPaid;
    /// @notice Amount to increment the jackpot by on each roll
    uint256 public lottoLossIncrement;

    /// @notice Percentage of winnings to burn for non-NFT holders
    uint256 public burnPercentage;

    /**
     * @notice Initialize the LazyTradeLotto contract with required parameters
     * @dev Sets up all necessary references and initial values
     * @param _prngSystemContract Address of the PRNG system contract for random number generation
     * @param _lazyGasStation Address of the Lazy Gas Station for token payouts
     * @param _lazyDelegateRegistry Address of the Lazy Delegate Registry for NFT delegation
     * @param _lshGen1 Address of the LSH Gen 1 NFT contract
     * @param _lshGen2 Address of the LSH Gen 2 NFT contract
     * @param _lshGen1Mutant Address of the LSH Gen 1 Mutant NFT contract
     * @param _systemWallet Address of the wallet that signs transaction parameters
     * @param _initialJackpot Initial amount in the jackpot pool
     * @param _lottoLossIncrement Amount to increment the jackpot by on each roll
     * @param _burnPercentage Percentage of winnings to burn for non-NFT holders
     */
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

        // Default maximum jackpot pool to 500,000
        maxJackpotPool = 500_000; // Assuming LAZY_DECIMAL is 1

        // Initialize as paused by default for safety
        _pause();
    }

    /**
     * @notice Executes a lotto roll for a trade with potential for regular win and jackpot
     * @dev Can be called by both buyer and seller but only once each per trade
     * @param token The address of the NFT token contract involved in the trade
     * @param serial The token ID/serial of the NFT involved in the trade
     * @param nonce A unique number for this trade to prevent replay attacks
     * @param buyer Whether the caller is the buyer (true) or seller (false)
     * @param winRateThreshold Threshold for winning a regular prize (0-100,000,000)
     * @param minWinAmt Minimum amount that can be won in a regular win
     * @param maxWinAmt Maximum amount that can be won in a regular win
     * @param jackpotThreshold Threshold for winning the jackpot (0-100,000,000)
     * @param teamSignature Signature from the system wallet validating these parameters
     */
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
    ) external nonReentrant whenNotPaused {
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
     * @notice Validates all parameters for a lotto roll
     * @dev Verifies parameters are valid and the signature is authentic
     * @param token The address of the NFT token contract
     * @param serial The token ID/serial of the NFT
     * @param nonce A unique number for this trade
     * @param buyer Whether the caller is the buyer or seller
     * @param winRateThreshold Threshold for winning a regular prize
     * @param minWinAmt Minimum amount that can be won
     * @param maxWinAmt Maximum amount that can be won
     * @param jackpotThreshold Threshold for winning the jackpot
     * @param teamSignature Signature from the system wallet
     * @return bool True if all parameters are valid
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
     * @notice Processes a regular win condition and pays out if won
     * @dev Compares random roll against threshold and pays out if winner
     * @param winRateThreshold Threshold for winning (0-100,000,000)
     * @param minWinAmt Minimum amount that can be won
     * @param maxWinAmt Maximum amount that can be won
     * @param nonce The nonce used for random number generation
     * @param randomRoll The random number generated for this roll
     * @return winAmt The amount won (0 if no win)
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
            lazyGasStation.payoutLazy(
                msg.sender,
                winAmt,
                getBurnForUser(msg.sender)
            );

            totalWins += 1;
            totalPaid += winAmt;
        }
        return winAmt;
    }

    /**
     * @notice Processes a jackpot win condition and pays out if won
     * @dev Compares random roll against threshold and pays out if jackpot winner
     * @param jackpotThreshold Threshold for winning the jackpot (0-100,000,000)
     * @param randomRoll The random number generated for this roll
     */
    function processJackpotWin(
        uint256 jackpotThreshold,
        uint256 randomRoll
    ) private {
        if (jackpotThreshold >= randomRoll) {
            // we have a jackpot winner!
            uint256 jackpotAmt = jackpotPool;

            // pay the jackpot winner
            lazyGasStation.payoutLazy(
                msg.sender,
                jackpotAmt,
                getBurnForUser(msg.sender)
            );

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

        // Ensure jackpot pool does not exceed the maximum threshold
        if (jackpotPool > maxJackpotPool) {
            jackpotPool = maxJackpotPool;
        }
    }

    /**
     * @notice Increases the jackpot pool by a specified amount
     * @dev Can only be called by the contract owner
     * @param amount The amount to add to the jackpot pool
     */
    function boostJackpot(uint256 amount) external onlyOwner {
        jackpotPool += amount;

        emit JackpotUpdate(amount);
    }

    /**
     * @notice Updates the amount added to the jackpot pool after each roll
     * @dev Can only be called by the contract owner
     * @param increment The new jackpot loss increment value
     */
    function updateJackpotLossIncrement(uint256 increment) external onlyOwner {
        lottoLossIncrement = increment;

        emit ContractUpdate(
            "JackpotLossIncrement",
            msg.sender,
            increment,
            "Updated"
        );
    }

    /**
     * @notice Updates the maximum threshold for the jackpot pool
     * @dev Can only be called by the contract owner
     * @param maxThreshold The new maximum jackpot threshold
     */
    function updateMaxJackpotPool(uint256 maxThreshold) external onlyOwner {
        maxJackpotPool = maxThreshold;

        emit ContractUpdate(
            "MaxJackpotPool",
            msg.sender,
            maxThreshold,
            "Updated"
        );
    }

    /**
     * @notice Updates the burn percentage applied to non-NFT holders
     * @dev Can only be called by the contract owner
     * @param percentage The new burn percentage (0-100)
     */
    function updateBurnPercentage(uint256 percentage) external onlyOwner {
        burnPercentage = percentage;

        emit ContractUpdate(
            "BurnPercentage",
            msg.sender,
            percentage,
            "Updated"
        );
    }

    /**
     * @notice Updates the system wallet address used for validating signatures
     * @dev Can only be called by the contract owner
     * @param newWallet The address of the new system wallet
     */
    function updateSystemWallet(address newWallet) external onlyOwner {
        systemWallet = newWallet;

        emit ContractUpdate("SystemWallet", msg.sender, 0, "Updated");
    }

    /**
     * @notice Determines the burn percentage to apply for a specific user
     * @dev Users who hold or have delegated access to LSH NFTs get 0% burn
     * @param _user The address of the user to check
     * @return uint256 The burn percentage to apply (0% for NFT holders, burnPercentage for others)
     */
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

    /**
     * @notice Emits a LottoRoll event with all roll details
     * @dev Called internally after processing a roll
     * @param token The address of the NFT token contract
     * @param serial The token ID/serial of the NFT
     * @param nonce The unique nonce for this roll
     * @param buyer Whether the roller was the buyer or seller
     * @param winRateThreshold The threshold for winning
     * @param minWinAmt Minimum win amount
     * @param maxWinAmt Maximum win amount
     * @param jackpotThreshold Threshold for jackpot win
     * @param winRolls Array of random numbers generated for this roll
     * @param winAmt The amount won (0 if no win)
     */
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
     * @return _maxJackpotPool the maximum jackpot pool threshold
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
            uint256 _lottoLossIncrement,
            uint256 _maxJackpotPool
        )
    {
        return (
            jackpotPool,
            jackpotsWon,
            jackpotPaid,
            totalRolls,
            totalWins,
            totalPaid,
            lottoLossIncrement,
            maxJackpotPool
        );
    }

    /**
     * @notice Pauses the contract to prevent any new lotto rolls
     * @dev Can only be called by the contract owner
     */
    function pause() external onlyOwner {
        _pause();
        emit ContractUpdate("Pause", msg.sender, 0, "Contract Paused");
    }

    /**
     * @notice Unpauses the contract to allow lotto rolls
     * @dev Can only be called by the contract owner
     */
    function unpause() external onlyOwner {
        _unpause();
        emit ContractUpdate("Unpause", msg.sender, 0, "Contract Unpaused");
    }

    /**
     * @notice Checks if the contract is currently paused
     * @return bool True if the contract is paused, false otherwise
     */
    function isPaused() external view returns (bool) {
        return paused();
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

    /**
     * @notice Default function to receive HBAR
     * @dev Triggered when HBAR is sent to the contract
     */
    receive() external payable {
        emit ContractUpdate("Receive", msg.sender, msg.value, "Received HBAR");
    }

    /**
     * @notice Fallback function that's triggered when the contract is called with non-existent functions
     * @dev Also allows receiving HBAR
     */
    fallback() external payable {
        emit ContractUpdate("Fallback", msg.sender, msg.value, "Fallback");
    }
}
