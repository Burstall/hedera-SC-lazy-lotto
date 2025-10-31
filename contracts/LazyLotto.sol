// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/*
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 * ⚡                                                             ⚡
 * ⚡                        LAZY SUPERHEROES                     ⚡
 * ⚡                      The OG Hedera Project                  ⚡
 * ⚡                                                             ⚡
 * ⚡                        %%%%#####%%@@@@                      ⚡
 * ⚡                   @%%%@%###%%%%###%%%%%@@                   ⚡
 * ⚡                %%%%%%@@@@@@@@@@@@@@@@%##%%@@                ⚡
 * ⚡              @%%@#@@@@@@@@@@@@@@@@@@@@@@@@*%%@@             ⚡
 * ⚡            @%%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*%@@           ⚡
 * ⚡           %%%#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%#%@@         ⚡
 * ⚡          %%%@@@@@@@@@@@@@@#-:--==+#@@@@@@@@@@@@@*%@@        ⚡
 * ⚡         %@#@@@@@@@@@@@@@@*-------::%@@@@@@@@%%%%%*%@@       ⚡
 * ⚡        %%#@@@@@@@@@@@@@@@=-------:#@@@@@@@@@%%%%%%*%@@      ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@#-------:+@@@@@@@@@@%%%%%%%#%@@     ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@=------:=@@@@@@@@@@@%%%%%%%%#@@     ⚡
 * ⚡      #%#@@@%%%%%%%@@@@@%------:-@@@@@@@@@@@@@%%%%%%%#%@@    ⚡
 * ⚡      %%#@@@%%%%%%%%@@@@=------------:::@@@@@@@@%%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@%:------------::%@@@@@@@@@%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@=:::---------:-@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      #%#@@@%%%%%%%@@@@*:::::::----:-@@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      %%%%@@@@%%%%%@@@@@@@@@@-:---:=@@@@@@@@@@@@@@@@@%@@@    ⚡
 * ⚡       %%#@@@@%%%%@@@@@@@@@@@::--:*@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡       %#%#@@@%@%%%@@@@@@@@@#::::#@@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡        %%%%@@@%%%%%%@@@@@@@*:::%@@@@@@@@@@@@@@@@@@%@@@      ⚡
 * ⚡         %%#%@@%%%%%%%@@@@@@=.-%@@@@@@@@@@@@@@@@@@%@@@       ⚡
 * ⚡          %##*@%%%%%%%%%@@@@=+@@@@@@@@@@@@@@@@@@%%@@@        ⚡
 * ⚡           %##*%%%%%%%%%%@@@@@@@@@@@@@@@@@@@@@@%@@@@         ⚡
 * ⚡             %##+#%%%%%%%%@@@@@@@@@@@@@@@@@@@%@@@@           ⚡
 * ⚡               %##*=%%%%%%%@@@@@@@@@@@@@@@#@@@@@             ⚡
 * ⚡                 %##%#**#@@@@@@@@@@@@%%%@@@@@@               ⚡
 * ⚡                    %%%%@@%@@@%%@@@@@@@@@@@                  ⚡
 * ⚡                         %%%%%%%%%%%@@                       ⚡
 * ⚡                                                             ⚡
 * ⚡                 Development Team Focused on                 ⚡
 * ⚡                   Decentralized Solutions                   ⚡
 * ⚡                                                             ⚡
 * ⚡         Visit: http://lazysuperheroes.com/                  ⚡
 * ⚡            or: https://dapp.lazysuperheroes.com/            ⚡
 * ⚡                   to get your LAZY on!                      ⚡
 * ⚡                                                             ⚡
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 */

/// @title Lazy Lotto
/// @author stowerling.eth / stowerling.hbar
/// @notice Degens going to degen - this contract allows users to spend their $LAZY in the hope
/// of getting prizes from the lotto.
/// @dev now uses hbar for royalty handling currently

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";
import {IHederaTokenServiceLite} from "./interfaces/IHederaTokenServiceLite.sol";
import {HederaTokenServiceLite} from "./HederaTokenServiceLite.sol";
import {KeyHelperLite} from "./KeyHelperLite.sol";
import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

/// @title  LazyLottoV2
/// @notice On-chain lotto pools with Hedera VRF randomness, multi-roll batching, burn on entry, and transparent prize management.
contract LazyLotto is
    ReentrancyGuard,
    Pausable,
    HederaTokenServiceLite,
    KeyHelperLite
{
    using SafeCast for uint256;
    using SafeCast for int256;
    // --- DATA STRUCTURES ---
    /**
     * @dev Defines the structure for royalty fees on an NFT.
     * @param numerator The numerator of the royalty fee fraction.
     * @param denominator The denominator of the royalty fee fraction.
     * @param fallbackfee The fallback fee in HBAR if the royalty fee cannot be paid (e.g., 0 denominator).
     * @param account The account that will receive the royalty fee.
     */
    struct NFTFeeObject {
        uint32 numerator;
        uint32 denominator;
        uint32 fallbackfee;
        address account;
    }
    struct PrizePackage {
        address token; // HTS token address (0 = HBAR)
        uint256 amount; // amount for fungible prizes
        address[] nftTokens; // NFT addresses
        uint256[][] nftSerials; // NFT serials
    }
    struct LottoPool {
        string ticketCID;
        string winCID;
        uint256 winRateThousandthsOfBps; // Moved up
        uint256 entryFee; // Moved up
        PrizePackage[] prizes; // Moved up
        uint256 outstandingEntries; // Moved up
        address poolTokenId;
        bool paused; // Grouped with poolTokenId and closed
        bool closed; // Grouped with poolTokenId and paused
        address feeToken; // Moved down
    }
    struct PendingPrize {
        uint256 poolId; // pool ID
        bool asNFT; // true if the prize is an NFT - Moved up to pack with prize.token
        PrizePackage prize; // prize package
    }
    struct TimeWindow {
        uint256 start;
        uint256 end;
        uint16 bonusBps;
    }

    /// --- CONSTANTS ---
    /// @notice Maximum possible threshold for winning (100%)
    /// @dev Expressed as integer from 0-100,000,000 where 100,000,000 represents 100%
    uint256 public constant MAX_WIN_RATE_THRESHOLD = 100_000_000;
    uint256 public constant NFT_BATCH_SIZE = 10;
    int32 private constant DEFAULT_AUTO_RENEW_PERIOD = 7776000; // Default auto-renew period for tokens (90 days in seconds)
    uint256 private constant MAX_NFTS_PER_TX = 8; // Maximum NFTs per HTS transaction

    // --- ENUMS ---
    enum MethodEnum {
        FALLBACK,
        RECEIVE,
        FT_TRANSFER,
        HBAR_TRANSFER
    }

    enum TransferDirection {
        STAKING,
        WITHDRAWAL
    }

    // --- ERRORS ---
    error LottoPoolNotFound(uint256 _poolId);
    error BalanceError(
        address _tokenAddress,
        uint256 _balance,
        uint256 _requestedAmount
    );

    error BadParameters();
    error NotAdmin();
    error FungibleTokenTransferFailed();
    error LastAdminError();
    error PoolIsClosed();
    error PoolNotClosed();
    error NotEnoughHbar(uint256 _needed, uint256 _presented);
    error NotEnoughFungible(uint256 _needed, uint256 _presented);
    error NotEnoughTickets(
        uint256 _poolId,
        uint256 _requested,
        uint256 _available
    );
    error NoTickets(uint256 _poolId, address _user);
    error NoPendingPrizes();
    error FailedNFTCreate();
    error FailedNFTMintAndSend();
    error FailedNFTWipe();
    error PoolOnPause();
    error EntriesOutstanding(uint256 _outstanding, uint256 _tokensOutstanding);
    error NoPrizesAvailable();
    error AlreadyWinningTicket();
    error FailedToInitialize();
    error NFTTransferFailed(TransferDirection _direction);
    error AssociationFailed(address tokenAddress);

    /// --- EVENTS ---
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event PoolCreated(uint256 indexed poolId);
    event PoolPaused(uint256 indexed poolId);
    event PoolClosed(uint256 indexed poolId);
    event PoolOpened(uint256 indexed poolId);
    event EntryPurchased(
        address indexed user,
        uint256 indexed poolId,
        uint256 count
    );
    event Rolled(
        address indexed user,
        uint256 indexed poolId,
        bool won,
        uint256 rollBps
    );
    event PrizeClaimed(address indexed user, PrizePackage prize);
    event TicketEvent(
        uint256 indexed poolId,
        address indexed tokenId,
        address indexed user,
        int64[] serialNumber,
        bool mint
    );
    event TimeBonusAdded(uint256 start, uint256 end, uint16 bonusBps);
    event NFTBonusSet(address indexed token, uint16 bonusBps);
    event LazyBalanceBonusSet(uint256 threshold, uint16 bonusBps);
    event ContractUpdate(MethodEnum method, address _sender, uint256 _amount);

    // --- STATE ---
    mapping(address => bool) private _isAddressAdmin;
    uint256 private _adminCount;

    IPrngSystemContract public prng;
    uint256 public burnPercentage;

    // HTS helper contracts
    address public lazyToken;
    ILazyGasStation public lazyGasStation;
    ILazyDelegateRegistry public lazyDelegateRegistry;

    LottoPool[] private pools;
    // allow a lookup of prizes available to a user

    mapping(address => PendingPrize[]) private pending;
    // switched to the hash of tokenId + serialNumber when redeemed to NFT
    mapping(bytes32 => PendingPrize) private pendingNFTs;
    // need to track how much of an FT the contract needs for prizes (won and pledged to pools)
    mapping(address => uint256) private ftTokensForPrizes;

    // Bonus config
    mapping(address => uint16) public nftBonusBps;
    address[] public nftBonusTokens;
    uint256 public lazyBalanceThreshold;
    uint16 public lazyBalanceBonusBps;
    TimeWindow[] public timeBonuses;
    // mapping of poolId -> User -> entries in state
    mapping(uint256 => mapping(address => uint256)) public userEntries;

    // --- CONSTRUCTOR ---
    /// @param _lazyToken The address of the $LAZY token
    /// @param _lazyGasStation The address of the LazyGasStation contract
    /// @param _lazyDelegateRegistry The address of the LazyDelegateRegistry contract
    /// @param _prng The address of the PrngSystemContract
    /// @param _burnPercentage The percentage of the entry fee to burn on entry (0-100)
    constructor(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry,
        address _prng,
        uint256 _burnPercentage
    ) {
        if (
            _lazyToken == address(0) ||
            _lazyGasStation == address(0) ||
            _lazyDelegateRegistry == address(0) ||
            _prng == address(0)
        ) {
            revert BadParameters();
        }

        // Initialize HTS helper contracts (inlined from _initContracts)
        lazyToken = _lazyToken;
        lazyGasStation = ILazyGasStation(_lazyGasStation);
        lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);

        int256 response = associateToken(address(this), lazyToken);
        if (response != HederaResponseCodes.SUCCESS) {
            revert FailedToInitialize();
        }

        prng = IPrngSystemContract(_prng);

        burnPercentage = _burnPercentage;

        // Initialize the admin with the deployer
        _isAddressAdmin[msg.sender] = true;
        _adminCount = 1;
        emit AdminAdded(msg.sender);
    }

    // --- INTERNAL REQUIREMENT FUNCTIONS ---
    /// @dev Internal function to check if caller is admin (replaces onlyAdmin modifier)
    function _requireAdmin() internal view {
        if (!_isAddressAdmin[msg.sender]) {
            revert NotAdmin();
        }
    }

    /// @dev Internal function to validate pool exists and is not closed (replaces validPool modifier)
    function _requireValidPool(uint256 id) internal view {
        if (id >= pools.length) {
            revert LottoPoolNotFound(id);
        }
        if (pools[id].closed) {
            revert PoolIsClosed();
        }
    }

    // --- ADMIN FUNCTIONS ---
    /// @notice Adds a new admin address
    /// @param a The address of the new admin
    function addAdmin(address a) external {
        _requireAdmin();
        if (a == address(0)) revert BadParameters();
        if (!_isAddressAdmin[a]) {
            _isAddressAdmin[a] = true;
            _adminCount++;
            emit AdminAdded(a);
        }
    }

    /// @notice Removes an admin address
    /// @param a The address of the admin to remove
    function removeAdmin(address a) external {
        _requireAdmin();
        if (a == address(0)) revert BadParameters();
        if (_adminCount <= 1) {
            revert LastAdminError();
        }
        if (_isAddressAdmin[a]) {
            _isAddressAdmin[a] = false;
            _adminCount--;
            emit AdminRemoved(a);
        } else {
            revert NotAdmin();
        }
    }

    /// @notice Sets the burn percentage for the entry fee
    /// @param _burnPercentage The new burn percentage (0-100)
    function setBurnPercentage(uint256 _burnPercentage) external {
        _requireAdmin();
        if (_burnPercentage > 100) {
            revert BadParameters();
        }
        burnPercentage = _burnPercentage;
    }

    /// @notice Sets the lazy balance bonus parameters
    /// @param _threshold The threshold for the lazy balance bonus
    /// @param _bonusBps The bonus in basis points (0-10000)
    function setLazyBalanceBonus(
        uint256 _threshold,
        uint16 _bonusBps
    ) external {
        _requireAdmin();
        if (_threshold == 0 || _bonusBps > 10000) {
            revert BadParameters();
        }
        lazyBalanceThreshold = _threshold;
        lazyBalanceBonusBps = _bonusBps;
        emit LazyBalanceBonusSet(_threshold, _bonusBps);
    }

    /// @notice Sets an NFT bonus token and its bonus bps
    /// @param _token The address of the NFT token
    /// @param _bonusBps The bonus in basis points (0-10000)
    function setNFTBonus(address _token, uint16 _bonusBps) external {
        _requireAdmin();
        if (_token == address(0) || _bonusBps > 10000) {
            revert BadParameters();
        }
        nftBonusTokens.push(_token);
        nftBonusBps[_token] = _bonusBps;
        emit NFTBonusSet(_token, _bonusBps);
    }

    /// @notice Sets a time-based bonus window
    /// @param _start The start time of the bonus window
    /// @param _end The end time of the bonus window
    /// @param _bonusBps The bonus in basis points (0-10000)
    function setTimeBonus(
        uint256 _start,
        uint256 _end,
        uint16 _bonusBps
    ) external {
        _requireAdmin();
        if (_start == 0 || _end == 0 || _bonusBps > 10000) {
            revert BadParameters();
        }
        timeBonuses.push(TimeWindow(_start, _end, _bonusBps));
        emit TimeBonusAdded(_start, _end, _bonusBps);
    }

    /// @notice Removes a time-based bonus window
    /// @param index The index of the bonus window to remove
    function removeTimeBonus(uint256 index) external {
        _requireAdmin();
        if (index >= timeBonuses.length) {
            revert BadParameters();
        }
        timeBonuses[index] = timeBonuses[timeBonuses.length - 1];
        timeBonuses.pop();
    }

    /// @notice Removes an NFT bonus token
    /// @param index The index of the NFT bonus token to remove
    function removeNFTBonus(uint256 index) external {
        _requireAdmin();
        if (index >= nftBonusTokens.length) {
            revert BadParameters();
        }
        nftBonusTokens[index] = nftBonusTokens[nftBonusTokens.length - 1];
        delete nftBonusBps[nftBonusTokens[index]];
        nftBonusTokens.pop();
    }

    /// @notice Sets the PRNG contract address (for testing purposes)
    /// @param _prng The address of the new PRNG contract
    function setPrng(address _prng) external {
        _requireAdmin();
        if (_prng == address(0)) {
            revert BadParameters();
        }
        prng = IPrngSystemContract(_prng);
    }

    /// Initializes a fresh Lotto pool with the given parameters
    /// @param _name The name of the Pool (for the token)
    /// @param _symbol The symbol of the pool token
    /// @param _memo The memo for the token
    /// @param _royalties The royalties for the token (NFT)
    /// @param _ticketCID The CID for the (unrolled) ticket metadata
    /// @param _winCID The CID for the winning metadata
    /// @param _winRateTenThousandthsOfBps The winning rate in basis points (0-100_000_000)
    /// @param _entryFee The entry fee for the pool
    /// @param _feeToken The token to use for fees
    /// @return poolId The ID of the created pool
    function createPool(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        NFTFeeObject[] memory _royalties,
        string memory _ticketCID,
        string memory _winCID,
        uint256 _winRateTenThousandthsOfBps,
        uint256 _entryFee,
        address _feeToken
    ) external payable returns (uint256 poolId) {
        _requireAdmin();
        // check the parameters are valid
        if (
            bytes(_name).length == 0 ||
            bytes(_symbol).length == 0 ||
            bytes(_memo).length == 0 ||
            bytes(_ticketCID).length == 0 ||
            bytes(_winCID).length == 0 ||
            bytes(_memo).length > 100 ||
            _royalties.length > 10 ||
            _winRateTenThousandthsOfBps > MAX_WIN_RATE_THRESHOLD ||
            _entryFee == 0
        ) {
            revert BadParameters();
        }

        // we need to associate the _feeToken with the contract
        if (
            _feeToken != address(0) &&
            _feeToken != lazyToken &&
            IERC20(_feeToken).balanceOf(address(this)) == 0
        ) {
            _tokenAssociate(_feeToken);
        }

        // now mint the token for the pool making the SC the treasury
        IHederaTokenServiceLite.TokenKey[]
            memory _keys = new IHederaTokenServiceLite.TokenKey[](1);

        // make the contract the sole supply / wipe key
        _keys[0] = getSingleKey(
            KeyType.SUPPLY,
            KeyType.WIPE,
            KeyValueType.CONTRACT_ID,
            address(this)
        );

        IHederaTokenServiceLite.HederaToken memory _token;
        _token.name = _name;
        _token.symbol = _symbol;
        _token.memo = _memo;
        _token.treasury = address(this);
        _token.tokenKeys = _keys;
        _token.tokenSupplyType = false;
        // int64 max value
        _token.maxSupply = 0x7FFFFFFFFFFFFFFF;

        // create the expiry schedule for the token using ExpiryHelper
        _token.expiry = createAutoRenewExpiry(
            address(this),
            DEFAULT_AUTO_RENEW_PERIOD
        );

        IHederaTokenServiceLite.RoyaltyFee[]
            memory _fees = new IHederaTokenServiceLite.RoyaltyFee[](
                _royalties.length
            );

        uint256 _length = _royalties.length;
        for (uint256 f = 0; f < _length; ) {
            IHederaTokenServiceLite.RoyaltyFee memory _fee;
            _fee.numerator = _royalties[f].numerator;
            _fee.denominator = _royalties[f].denominator;
            _fee.feeCollector = _royalties[f].account;

            if (_royalties[f].fallbackfee != 0) {
                _fee.amount = _royalties[f].fallbackfee;
                _fee.useHbarsForPayment = true;
            }

            _fees[f] = _fee;

            unchecked {
                ++f;
            }
        }

        (
            int32 responseCode,
            address tokenAddress
        ) = createNonFungibleTokenWithCustomFees(
                _token,
                new IHederaTokenServiceLite.FixedFee[](0),
                _fees
            );

        if (responseCode != SUCCESS) {
            revert FailedNFTCreate();
        }

        // now create the pool and add it to the list of pools;
        pools.push(
            LottoPool({
                ticketCID: _ticketCID,
                winCID: _winCID,
                poolTokenId: tokenAddress,
                winRateThousandthsOfBps: _winRateTenThousandthsOfBps,
                entryFee: _entryFee,
                feeToken: _feeToken,
                prizes: new PrizePackage[](0),
                outstandingEntries: 0,
                paused: false,
                closed: false
            })
        );

        poolId = pools.length - 1;

        emit PoolCreated(poolId);
    }

    /// Admin can add prizes to a pool
    /// @param poolId The ID of the pool to add prizes to
    /// @param token The address of the token to add as a prize
    /// @param amount The amount of the token to add as a prize
    /// @param nftTokens The addresses of the NFT tokens to add as prizes
    function addPrizePackage(
        uint256 poolId,
        address token,
        uint256 amount,
        address[] memory nftTokens,
        uint256[][] memory nftSerials
    ) external payable {
        _requireValidPool(poolId);
        if (nftTokens.length != nftSerials.length) {
            revert BadParameters();
        }

        _checkAndPullFungible(token, amount);
        _bulkTransfer(
            TransferDirection.STAKING,
            nftTokens,
            nftSerials,
            msg.sender
        );

        LottoPool storage p = pools[poolId];
        p.prizes.push(
            PrizePackage({
                token: token,
                amount: amount,
                nftTokens: nftTokens,
                nftSerials: nftSerials
            })
        );
    }

    /// Admin can add multiple fungible prizes to a pool in one call
    /// @param poolId The ID of the pool to add prizes to
    /// @param tokenId The address of the token to add as a prize
    /// @param amounts The amounts of the token to add as prizes
    function addMultipleFungiblePrizes(
        uint256 poolId,
        address tokenId,
        uint256[] memory amounts
    ) external payable {
        _requireValidPool(poolId);
        if (amounts.length == 0) {
            revert BadParameters();
        }

        // for efficiency we will pull all the tokens in one go
        // and then split them out into the prize packages

        // get the total amount of tokens to transfer
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; ) {
            totalAmount += amounts[i];
            unchecked {
                ++i;
            }
        }

        // check the contract has enough of the token to pay the prize
        _checkAndPullFungible(tokenId, totalAmount);

        LottoPool storage p = pools[poolId];

        uint256 _length = amounts.length;
        for (uint256 i = 0; i < _length; ) {
            p.prizes.push(
                PrizePackage({
                    token: tokenId,
                    amount: amounts[i],
                    nftTokens: new address[](0),
                    nftSerials: new uint256[][](0)
                })
            );

            unchecked {
                ++i;
            }
        }
    }

    /// Admin can pause a pool preventing the purchase of further tickets
    /// @param poolId The ID of the pool to pause
    function pausePool(uint256 poolId) external {
        _requireAdmin();
        _requireValidPool(poolId);
        LottoPool storage p = pools[poolId];
        p.paused = true;
        emit PoolPaused(poolId);
    }

    /// Admin can unpause a pool allowing the purchase of further tickets
    /// @param poolId The ID of the pool to unpause
    function unpausePool(uint256 poolId) external {
        _requireAdmin();
        _requireValidPool(poolId);
        LottoPool storage p = pools[poolId];
        p.paused = false;
        emit PoolOpened(poolId);
    }

    /// Admin can permanently close a pool preventing any further actions
    /// Required to be able to remove prizes from the pool
    /// @param poolId The ID of the pool to close
    function closePool(uint256 poolId) external {
        _requireAdmin();
        _requireValidPool(poolId);
        LottoPool storage p = pools[poolId];

        // we can only close a pool if there are no outstanding entries and no oustanding tokens too
        if (
            p.outstandingEntries > 0 || IERC20(p.poolTokenId).totalSupply() > 0
        ) {
            revert EntriesOutstanding(
                p.outstandingEntries,
                IERC20(p.poolTokenId).totalSupply()
            );
        }

        p.closed = true;
        emit PoolClosed(poolId);
    }

    /// Admin can remove prizes from a pool if closed
    /// @param poolId The ID of the pool to remove prizes from
    /// @param prizeIndex The index of the prize to remove
    function removePrizes(uint256 poolId, uint256 prizeIndex) external {
        _requireAdmin();
        LottoPool storage p = pools[poolId];
        if (!p.closed) {
            revert PoolNotClosed();
        }

        // check the prize index is valid
        if (prizeIndex >= p.prizes.length) {
            revert BadParameters();
        }

        PrizePackage memory prize = p.prizes[prizeIndex];

        // remove the prize from the pool
        p.prizes[prizeIndex] = p.prizes[p.prizes.length - 1];
        p.prizes.pop();

        // reduce the amount of the token needed for prizes
        ftTokensForPrizes[prize.token] -= prize.amount;

        // transfer the token amount back to the caller
        if (prize.token == address(0)) {
            // transfer the HBAR to the caller
            Address.sendValue(payable(msg.sender), prize.amount);
        } else if (prize.token == lazyToken) {
            // transfer the $LAZY to the caller
            lazyGasStation.payoutLazy(msg.sender, prize.amount, 0);
        } else {
            // attempt to transfer the token to the caller
            IERC20(prize.token).transfer(msg.sender, prize.amount);
        }

        // then transfer the NFTs back to the caller
        _bulkTransfer(
            TransferDirection.WITHDRAWAL,
            prize.nftTokens,
            prize.nftSerials,
            msg.sender
        );
    }

    // PAUSE
    /// @notice Pauses the contract
    function pause() external {
        _requireAdmin();
        _pause();
    }
    /// @notice Unpauses the contract
    function unpause() external {
        _requireAdmin();
        _unpause();
    }

    // --- USER ACTIONS ---
    /// User buys entries in the specified pool
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    function buyEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused nonReentrant {
        _requireValidPool(poolId);
        _buyEntry(poolId, ticketCount, false);
    }

    /// Helper function to allow the user to buy and roll in one transaction
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    function buyAndRollEntry(
        uint256 poolId,
        uint256 ticketCount
    )
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        _requireValidPool(poolId);
        _buyEntry(poolId, ticketCount, false);
        (wins, offset) = _roll(poolId, ticketCount);
    }

    /// Helper function to allow the user to buy and redeem to NFT in one transaction
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    function buyAndRedeemEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused nonReentrant {
        _requireValidPool(poolId);
        _buyEntry(poolId, ticketCount, false);
        _redeemEntriesToNFT(poolId, ticketCount, msg.sender);
    }

    /// Admin function to buy entries on behalf of a user
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    /// @param onBehalfOf The address to buy the tickets for
    function adminBuyEntry(
        uint256 poolId,
        uint256 ticketCount,
        address onBehalfOf
    ) external whenNotPaused nonReentrant {
        _requireAdmin();
        _requireValidPool(poolId);
        _buyEntry(poolId, ticketCount, false);
        _redeemEntriesToNFT(poolId, ticketCount, onBehalfOf);
    }

    /// User rolls all tickets in the pool (in memory not any NFT entries)
    /// @param poolId The ID of the pool to roll tickets in
    function rollAll(
        uint256 poolId
    )
        external
        whenNotPaused
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        _requireValidPool(poolId);
        if (userEntries[poolId][msg.sender] == 0) {
            revert NoTickets(poolId, msg.sender);
        }
        return _roll(poolId, userEntries[poolId][msg.sender]);
    }

    /// User rolls a batch of tickets in the pool (in memory not any NFT entries)
    /// @param poolId The ID of the pool to roll tickets in
    /// @param numberToRoll The number of tickets to roll
    function rollBatch(
        uint256 poolId,
        uint256 numberToRoll
    )
        external
        whenNotPaused
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        _requireValidPool(poolId);
        if (numberToRoll == 0) {
            revert BadParameters();
        }
        if (numberToRoll > userEntries[poolId][msg.sender]) {
            revert NotEnoughTickets(
                poolId,
                numberToRoll,
                userEntries[poolId][msg.sender]
            );
        }

        return _roll(poolId, numberToRoll);
    }

    /// User rolls tickets redeemed from NFTs
    /// @param poolId The ID of the pool to roll tickets in
    /// @param serialNumbers The serial numbers of the NFTs to roll
    function rollWithNFT(
        uint256 poolId,
        int64[] memory serialNumbers
    )
        external
        whenNotPaused
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        _requireValidPool(poolId);
        if (serialNumbers.length == 0) {
            revert BadParameters();
        }

        // redeem the tickets for the user and credit the entries
        _redeemEntriesFromNFT(poolId, serialNumbers);
        return _roll(poolId, serialNumbers.length);
    }

    /// User redeems pending prizes to NFTs
    /// @param indices The indices of the pending prizes to redeem
    function redeemPrizeToNFT(
        uint256[] memory indices
    ) external nonReentrant returns (int64[] memory serials) {
        return _redeemPendingPrizeToNFT(indices);
    }

    /// User claims prizes redeemed from NFTs
    /// @param tokenId The NFT tokenId to claim prizes from
    /// @param serialNumbers The serial numbers of the NFTs to claim prizes from
    function claimPrizeFromNFT(
        address tokenId,
        int64[] memory serialNumbers
    ) external nonReentrant {
        uint256[] memory prizeSlots = _redeemPendingPrizeFromNFT(
            tokenId,
            serialNumbers
        );
        uint256 _length = prizeSlots.length;
        // Claim in reverse order to avoid index shifting issues
        for (uint256 i = _length; i > 0; ) {
            _claimPrize(prizeSlots[i - 1]);
            unchecked {
                --i;
            }
        }
    }

    /// User claims a specific prize by index
    /// @param pkgIdx The index of the prize package to claim
    function claimPrize(uint256 pkgIdx) external nonReentrant {
        _claimPrize(pkgIdx);
    }

    /// User claims all pending prizes
    function claimAllPrizes() external nonReentrant {
        if (pending[msg.sender].length == 0) {
            revert NoPendingPrizes();
        }
        // Iterate by always claiming the prize at index 0
        // This is safe as the array shrinks and elements shift (or last is swapped to 0 and popped)
        while (pending[msg.sender].length > 0) {
            _claimPrize(0);
        }
    }

    /// --- VIEWS (Getters) ---
    /// @notice Get the total number of pools
    /// @return uint256 The total number of pools
    function totalPools() external view returns (uint256) {
        return pools.length;
    }

    /// @notice Get the details of a specific pool
    /// @param id The ID of the pool to get details for
    /// @return LottoPool The details of the specified pool
    function getPoolDetails(
        uint256 id
    ) external view returns (LottoPool memory) {
        if (id < pools.length) {
            return pools[id];
        } else {
            revert LottoPoolNotFound(id);
        }
    }

    /// @notice Get the user's entries for a specific pool
    /// @param poolId The ID of the pool to get entries for
    /// @param user The address of the user to get entries for
    /// @return uint256 The number of entries the user has in the specified pool
    function getUsersEntries(
        uint256 poolId,
        address user
    ) external view returns (uint256) {
        return userEntries[poolId][user];
    }

    /// @notice Get the user's entries across all pools
    /// @param user The address of the user to get entries for
    /// @return uint256[] memory The number of entries the user has in each pool
    function getUserEntries(
        address user
    ) external view returns (uint256[] memory) {
        uint256[] memory entries = new uint256[](pools.length);
        for (uint256 i = 0; i < pools.length; i++) {
            entries[i] = userEntries[i][user];
        }
        return entries;
    }

    /// @notice Get the user's pending prizes (all)
    /// @param user The address of the user to get pending prizes for
    /// @return PendingPrize[] memory The user's pending prizes
    function getPendingPrizes(
        address user
    ) external view returns (PendingPrize[] memory) {
        return pending[user];
    }

    /// @notice Get a specific pending prize for a user by index
    /// @param user The address of the user to get the pending prize for
    /// @param index The index of the pending prize to retrieve
    /// @return PendingPrize The pending prize at the specified index for the user
    function getPendingPrize(
        address user,
        uint256 index
    ) external view returns (PendingPrize memory) {
        // check the user has a pending prize at this index
        if (index >= pending[user].length) {
            revert BadParameters();
        }
        return pending[user][index];
    }

    /// @notice Get a specific pending prize for a user by NFT tokenId and serial number
    /// @param tokenId The NFT tokenId to get the pending prize for
    /// @param serialNumber The serial number of the NFT to get the pending prize for
    /// @return PendingPrize The pending prize for the specified NFT
    function getPendingPrizes(
        address tokenId,
        uint256 serialNumber
    ) external view returns (PendingPrize memory) {
        return pendingNFTs[keccak256(abi.encode(tokenId, serialNumber))];
    }

    /// @notice Get a specific prize package from a pool by index
    /// @param poolId The ID of the pool to get the prize package from
    /// @param prizeIndex The index of the prize package to retrieve
    /// @return PrizePackage The prize package at the specified index in the pool
    function getPrizePackage(
        uint256 poolId,
        uint256 prizeIndex
    ) external view returns (PrizePackage memory) {
        if (poolId >= pools.length) {
            revert LottoPoolNotFound(poolId);
        }
        if (prizeIndex >= pools[poolId].prizes.length) {
            revert BadParameters();
        }
        return pools[poolId].prizes[prizeIndex];
    }

    /// @notice Check if an address is an admin
    /// @param a The address to check
    function isAdmin(address a) external view returns (bool) {
        return _isAddressAdmin[a];
    }

    /// @notice Get the total number of time-based bonuses
    /// @return uint256 The total number of time-based bonuses
    function totalTimeBonuses() external view returns (uint256) {
        return timeBonuses.length;
    }

    /// @notice Get the total number of NFT bonus tokens
    /// @return uint256 The total number of NFT bonus tokens
    function totalNFTBonusTokens() external view returns (uint256) {
        return nftBonusTokens.length;
    }

    /// Function to calculate the boost for a user based on their holdings and time bonuses
    /// @param _user The address of the user to calculate the boost for
    /// @return boost The calculated boost in basis points (bps)
    function calculateBoost(address _user) public view returns (uint32) {
        uint32 boost;
        uint256 ts = block.timestamp;
        for (uint256 i; i < timeBonuses.length; ) {
            if (ts >= timeBonuses[i].start && ts <= timeBonuses[i].end) {
                boost += timeBonuses[i].bonusBps;
            }

            unchecked {
                i++;
            }
        }
        for (uint256 i; i < nftBonusTokens.length; ) {
            address tkn = nftBonusTokens[i];
            if (
                IERC721(tkn).balanceOf(_user) > 0 ||
                lazyDelegateRegistry.getSerialsDelegatedTo(_user, tkn).length >
                0
            ) boost += nftBonusBps[tkn];

            unchecked {
                i++;
            }
        }
        if (IERC20(lazyToken).balanceOf(_user) >= lazyBalanceThreshold) {
            boost += lazyBalanceBonusBps;
        }

        // scale bps to tens of thousands of bps
        boost *= 10_000;

        return boost;
    }

    /// --- INTERNAL FUNCTIONS ---
    function _checkAndPullFungible(address tokenId, uint256 amount) internal {
        // only pull the fungible token if amount > 0
        if (amount == 0) {
            return;
        }

        ftTokensForPrizes[tokenId] += amount;

        if (tokenId == address(0)) {
            if (address(this).balance < ftTokensForPrizes[tokenId]) {
                revert BalanceError(
                    address(0),
                    address(this).balance,
                    ftTokensForPrizes[address(0)]
                );
            }
        } else if (tokenId == lazyToken) {
            // transfer the $LAZY to the LGS
            lazyGasStation.drawLazyFrom(msg.sender, amount, 0);
        } else {
            // attempt to transfer the token to the contract
            if (
                IERC20(tokenId).balanceOf(address(this)) <
                ftTokensForPrizes[tokenId]
            ) {
                // first check if the contract has a balance > 0 (else try to associate)
                if (IERC20(tokenId).balanceOf(address(this)) == 0) {
                    _tokenAssociate(tokenId);
                }

                // now try and move the token to the contract (needs an allowance to be in place)
                IERC20(tokenId).transferFrom(msg.sender, address(this), amount);

                // check the contract has enough of the token to pay the prize
                if (
                    IERC20(tokenId).balanceOf(address(this)) <
                    ftTokensForPrizes[tokenId]
                ) {
                    revert BalanceError(
                        tokenId,
                        IERC20(tokenId).balanceOf(address(this)),
                        ftTokensForPrizes[tokenId]
                    );
                }
            }
        }
    }

    function _redeemEntriesFromNFT(
        uint256 _poolId,
        int64[] memory serialNumbers
    ) internal {
        LottoPool storage p = pools[_poolId];

        // check the serials are not winning tickets
        // then wipe the NFTs from the user
        // and credit the entries
        uint256 _numTickets = serialNumbers.length;
        for (uint256 outer = 0; outer < _numTickets; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (_numTickets - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (_numTickets - outer);
            int64[] memory batchSerialsForBurn = new int64[](thisBatch);
            for (
                uint256 inner = 0;
                ((outer + inner) < _numTickets) && (inner < thisBatch);

            ) {
                // check the serial is not a winning ticket
                if (
                    // hash the tokenId and serial number to get the key
                    pendingNFTs[
                        keccak256(
                            abi.encode(
                                p.poolTokenId,
                                serialNumbers[outer + inner]
                            )
                        )
                    ].asNFT
                ) {
                    revert AlreadyWinningTicket();
                }

                batchSerialsForBurn[inner] = serialNumbers[outer + inner];

                unchecked {
                    ++inner;
                }
            }

            emit TicketEvent(
                _poolId,
                p.poolTokenId,
                msg.sender,
                batchSerialsForBurn,
                false
            );

            int256 response = wipeTokenAccountNFT(
                p.poolTokenId,
                msg.sender,
                batchSerialsForBurn
            );

            if (response != SUCCESS) {
                revert FailedNFTWipe();
            }

            // now credit the entries to the user
            userEntries[_poolId][msg.sender] += thisBatch;
            p.outstandingEntries += thisBatch;
        }
    }

    function _redeemPendingPrizeToNFT(
        uint256[] memory _idxs
    ) internal returns (int64[] memory mintedSerialsToUser) {
        uint256 count = _idxs.length;
        if (count == 0) {
            revert BadParameters();
        }
        mintedSerialsToUser = new int64[](count);

        // Sort _idxs descending to handle removals from pending[msg.sender] correctly
        for (uint256 i = 0; i < count; ) {
            for (uint256 j = i + 1; j < count; ) {
                if (_idxs[i] < _idxs[j]) {
                    uint256 tmp = _idxs[i];
                    _idxs[i] = _idxs[j];
                    _idxs[j] = tmp;
                }
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }

        for (uint256 k = 0; k < count; ) {
            uint256 prizeIndexInPendingArray = _idxs[k];

            if (prizeIndexInPendingArray >= pending[msg.sender].length) {
                revert BadParameters(); // Index out of bounds
            }

            PendingPrize memory prizeToConvert = pending[msg.sender][
                prizeIndexInPendingArray
            ];

            // Remove from pending[msg.sender] by swapping with the last element and popping
            if (prizeIndexInPendingArray < pending[msg.sender].length - 1) {
                pending[msg.sender][prizeIndexInPendingArray] = pending[
                    msg.sender
                ][pending[msg.sender].length - 1];
            }
            pending[msg.sender].pop();

            prizeToConvert.asNFT = true; // Mark that this prize is now represented by an NFT

            bytes[] memory metadata = new bytes[](1);
            metadata[0] = abi.encodePacked(pools[prizeToConvert.poolId].winCID);
            address poolTokenIdForPrizeNFT = pools[prizeToConvert.poolId]
                .poolTokenId;

            (
                int32 responseCode,
                int64[] memory mintedSerials
            ) = _mintAndTransferNFT(
                    poolTokenIdForPrizeNFT,
                    address(this),
                    msg.sender,
                    metadata
                );

            if (responseCode != SUCCESS) {
                revert FailedNFTMintAndSend();
            }

            // 3. Store in pendingNFTs mapping
            bytes32 nftKey = keccak256(
                abi.encode(poolTokenIdForPrizeNFT, mintedSerials[0])
            );
            pendingNFTs[nftKey] = prizeToConvert;
            mintedSerialsToUser[k] = mintedSerials[0];

            emit TicketEvent(
                prizeToConvert.poolId,
                poolTokenIdForPrizeNFT,
                msg.sender,
                mintedSerials,
                true
            );

            unchecked {
                ++k;
            }
        }
    }

    function _redeemPendingPrizeFromNFT(
        address poolTokenId, // This is the poolTokenId of the NFT voucher
        int64[] memory serialNumbers
    ) internal returns (uint256[] memory prizeSlotsInPendingArray) {
        uint256 numSerials = serialNumbers.length;
        if (numSerials == 0) {
            revert BadParameters();
        }

        prizeSlotsInPendingArray = new uint256[](numSerials);
        uint256 successfullyRedeemedCount = 0;
        uint256 poolId = 0;

        for (uint256 i = 0; i < numSerials; ) {
            bytes32 nftKey = keccak256(
                abi.encode(poolTokenId, serialNumbers[i])
            );
            PendingPrize memory prize = pendingNFTs[nftKey];

            if (!prize.asNFT) {
                // If asNFT is false, it's not a valid entry from pendingNFTs or was already processed.
                // Could revert, or skip this serial. For now, revert.
                revert BadParameters();
            }

            delete pendingNFTs[nftKey]; // Remove from NFT voucher mapping

            prize.asNFT = false; // Mark as a regular pending prize again
            poolId = prize.poolId;
            pending[msg.sender].push(prize);
            prizeSlotsInPendingArray[successfullyRedeemedCount] =
                pending[msg.sender].length -
                1;
            successfullyRedeemedCount++;

            // Wipe the NFT voucher from the sender's account
            int64[] memory singleSerialArray = new int64[](1);
            singleSerialArray[0] = serialNumbers[i];
            int256 responseWipe = wipeTokenAccountNFT(
                poolTokenId,
                msg.sender,
                singleSerialArray
            );

            if (responseWipe != SUCCESS) {
                // If wipe fails, the state might be inconsistent. Reverting is safest.
                // Consider if this should revert all or just this specific redemption.
                revert FailedNFTWipe();
            }

            unchecked {
                ++i;
            }
        }

        emit TicketEvent(poolId, poolTokenId, msg.sender, serialNumbers, false);

        // If some redemptions failed and we chose to skip (not current logic), resize array.
        // For now, successfullyRedeemedCount should equal numSerials if no reverts.
        if (successfullyRedeemedCount < numSerials) {
            uint256[] memory sizedPrizeSlots = new uint256[](
                successfullyRedeemedCount
            );
            for (uint256 j = 0; j < successfullyRedeemedCount; ) {
                sizedPrizeSlots[j] = prizeSlotsInPendingArray[j];
                unchecked {
                    ++j;
                }
            }
            return sizedPrizeSlots;
        }
        return prizeSlotsInPendingArray;
    }

    function _redeemEntriesToNFT(
        uint256 _poolId,
        uint256 _numTickets,
        address _onBehalfOf
    ) internal returns (int64[] memory mintedSerials) {
        if (userEntries[_poolId][msg.sender] < _numTickets) {
            revert NotEnoughTickets(
                _poolId,
                _numTickets,
                userEntries[_poolId][msg.sender]
            );
        }

        // Remove the tickets from the user's entry count
        userEntries[_poolId][msg.sender] -= _numTickets;

        LottoPool storage p = pools[_poolId];
        // @dev: not adjusting the oustanding entries here, as the tickets are not being rolled yet

        // mint the NFTs for the user
        for (uint256 outer = 0; outer < _numTickets; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (_numTickets - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (_numTickets - outer);
            bytes[] memory batchMetadataForMint = new bytes[](thisBatch);
            for (
                uint256 inner = 0;
                ((outer + inner) < _numTickets) && (inner < thisBatch);

            ) {
                batchMetadataForMint[inner] = bytes(p.ticketCID);
                unchecked {
                    ++inner;
                }
            }

            int32 responseCode;

            (responseCode, mintedSerials) = _mintAndTransferNFT(
                p.poolTokenId,
                address(this),
                _onBehalfOf,
                batchMetadataForMint
            );

            if (responseCode != SUCCESS) {
                revert FailedNFTMintAndSend();
            }

            emit TicketEvent(
                _poolId,
                p.poolTokenId,
                msg.sender,
                mintedSerials,
                true
            );
        }
    }

    function _buyEntry(
        uint256 poolId,
        uint256 ticketCount,
        bool isFreeOfPayment
    ) internal {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        LottoPool storage p = pools[poolId];

        if (p.paused) {
            revert PoolOnPause();
        }

        if (!isFreeOfPayment) {
            uint256 totalFee = p.entryFee * ticketCount;

            if (p.feeToken == address(0)) {
                if (msg.value < totalFee) {
                    revert NotEnoughHbar(totalFee, msg.value);
                }
                // Refund excess HBAR
                if (msg.value > totalFee) {
                    Address.sendValue(
                        payable(msg.sender),
                        msg.value - totalFee
                    );
                }
            } else if (p.feeToken == lazyToken) {
                // If the token is $LAZY, take payment to LGS and burn part of the fee

                // This is a SAFE transfer method and will revert if the transfer fails
                lazyGasStation.drawLazyFrom(
                    msg.sender,
                    totalFee,
                    burnPercentage
                );
            } else {
                bool success = IERC20(p.feeToken).transferFrom(
                    msg.sender,
                    address(this),
                    totalFee
                );

                if (!success) {
                    revert NotEnoughFungible(totalFee, msg.value);
                }
            }
        }

        p.outstandingEntries += ticketCount;
        userEntries[poolId][msg.sender] += ticketCount;
        emit EntryPurchased(msg.sender, poolId, ticketCount);
    }

    function _roll(
        uint256 poolId,
        uint256 numberToRoll
    ) internal returns (uint256 wins, uint256 offset) {
        uint32 boostBps = calculateBoost(msg.sender);

        LottoPool storage p = pools[poolId];

        // ensure we know the total number of prizes available
        uint256 totalPrizesAvailable = p.prizes.length;
        if (totalPrizesAvailable == 0) {
            revert NoPrizesAvailable();
        }

        if (p.outstandingEntries < numberToRoll) {
            revert NotEnoughTickets(poolId, numberToRoll, p.outstandingEntries);
        }
        if (userEntries[poolId][msg.sender] < numberToRoll) {
            revert NotEnoughTickets(
                poolId,
                numberToRoll,
                userEntries[poolId][msg.sender]
            );
        }

        p.outstandingEntries -= numberToRoll;
        userEntries[poolId][msg.sender] -= numberToRoll;

        // boostBps is already scaled to 10_000s of bps in calculateBoost
        uint256 winRateWithBoost = p.winRateThousandthsOfBps + boostBps;

        if (winRateWithBoost > MAX_WIN_RATE_THRESHOLD) {
            winRateWithBoost = MAX_WIN_RATE_THRESHOLD;
        }

        offset = pending[msg.sender].length;

        uint256[] memory rolls = prng.getPseudorandomNumberArray(
            0, // min value for random number
            MAX_WIN_RATE_THRESHOLD, // max value for random number (exclusive for PRNG, so 0 to 99,999,999)
            uint256(
                keccak256(
                    abi.encodePacked(
                        block.timestamp,
                        msg.sender,
                        poolId,
                        numberToRoll
                    )
                )
            ), // seed
            numberToRoll
        );

        for (uint256 i = 0; i < numberToRoll; i++) {
            bool won = rolls[i] < winRateWithBoost;
            emit Rolled(msg.sender, poolId, won, rolls[i]); // Emit roll event regardless of win

            if (won && totalPrizesAvailable > 0) {
                // Use a different random number for prize selection to avoid bias from the win roll
                // Or, if PRNG is good enough, can use a portion of the same roll or a subsequent one if available.
                // For simplicity, let's use a modulo of the win roll for now, assuming PRNG distribution is fine.
                // A more robust way would be another PRNG call or a hash-based selection.
                uint256 prizeSelectionIndex = rolls[i] % totalPrizesAvailable;
                PrizePackage memory pkg = p.prizes[prizeSelectionIndex];

                // Remove prize from pool by swapping with last and popping
                p.prizes[prizeSelectionIndex] = p.prizes[
                    totalPrizesAvailable - 1
                ];
                p.prizes.pop();

                totalPrizesAvailable--; // Decrement available prizes
                wins++;

                pending[msg.sender].push(
                    PendingPrize({poolId: poolId, prize: pkg, asNFT: false})
                );
            }
        }
    }

    function _claimPrize(uint256 pkgIdx) internal {
        PendingPrize[] memory userPending = pending[msg.sender];
        if (userPending.length == 0) {
            revert NoPendingPrizes();
        }

        // check the user has a pending prize at this index
        if (pkgIdx >= userPending.length) {
            revert BadParameters();
        }

        // get the prize from the array and remove it
        PendingPrize memory claimedPrize = userPending[pkgIdx];
        pending[msg.sender][pkgIdx] = pending[msg.sender][
            pending[msg.sender].length - 1
        ];
        pending[msg.sender].pop();

        emit PrizeClaimed(msg.sender, claimedPrize.prize);

        // update the ftTokensForPrizes
        ftTokensForPrizes[claimedPrize.prize.token] -= claimedPrize
            .prize
            .amount;

        // time to pay out the prize and update ftTokensForPrizes
        if (claimedPrize.prize.token == address(0)) {
            // transfer the HBAR to the user
            Address.sendValue(payable(msg.sender), claimedPrize.prize.amount);
        } else if (claimedPrize.prize.token == lazyToken) {
            // transfer the $LAZY to the user
            lazyGasStation.payoutLazy(msg.sender, claimedPrize.prize.amount, 0);
        } else {
            // attempt to transfer the token to the user
            IERC20(claimedPrize.prize.token).transfer(
                msg.sender,
                claimedPrize.prize.amount
            );
        }

        _bulkTransfer(
            TransferDirection.WITHDRAWAL,
            claimedPrize.prize.nftTokens,
            claimedPrize.prize.nftSerials,
            msg.sender
        );
    }

    /// --- HTS HELPER FUNCTIONS (inlined from HTSLottoUtils) ---

    /**
     * @dev Internal function to move a batch of NFTs (up to MAX_NFTS_PER_TX).
     * It constructs the necessary transfer lists for HBAR (tinybar dust for discovery) and NFTs,
     * then calls the cryptoTransfer precompile.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param _collectionAddress The address of the NFT collection.
     * @param _serials An array of serial numbers for the NFTs to transfer (max length MAX_NFTS_PER_TX).
     * @param _contractAddress The address of the contract (e.g., staking contract).
     * @param _eoaAddress The address of the EOA involved in the transfer.
     */
    function _moveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _contractAddress,
        address _eoaAddress
    ) internal {
        if (_serials.length > 8) revert BadParameters();
        address receiverAddress;
        address senderAddress;
        bool isHbarApproval;

        if (_direction == TransferDirection.STAKING) {
            receiverAddress = _contractAddress;
            senderAddress = _eoaAddress;
        } else {
            receiverAddress = _eoaAddress;
            senderAddress = _contractAddress;
            isHbarApproval = true;
        }

        // hbar moves sit separate from NFT moves (max 8 NFTs + 2 hbar legs +1/-1 tiny bar)
        IHederaTokenServiceLite.TokenTransferList[]
            memory _transfers = new IHederaTokenServiceLite.TokenTransferList[](
                _serials.length
            );

        // prep the hbar transfer
        IHederaTokenServiceLite.TransferList memory _hbarTransfer;
        _hbarTransfer.transfers = new IHederaTokenServiceLite.AccountAmount[](
            2
        );

        _hbarTransfer.transfers[0].accountID = receiverAddress;
        _hbarTransfer.transfers[0].amount = -1;
        _hbarTransfer.transfers[0].isApproval = isHbarApproval;

        _hbarTransfer.transfers[1].accountID = senderAddress;
        _hbarTransfer.transfers[1].amount = 1;

        // transfer NFT
        for (uint256 i = 0; i < _serials.length; i++) {
            IHederaTokenServiceLite.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = senderAddress;
            _nftTransfer.receiverAccountID = receiverAddress;
            _nftTransfer.isApproval = !isHbarApproval;

            if (_serials[i] == 0) {
                continue;
            }
            _transfers[i].token = _collectionAddress;

            _transfers[i]
                .nftTransfers = new IHederaTokenServiceLite.NftTransfer[](1);

            _nftTransfer.serialNumber = int256(_serials[i]).toInt64();
            _transfers[i].nftTransfers[0] = _nftTransfer;
        }

        int256 response = cryptoTransfer(_hbarTransfer, _transfers);

        if (response != SUCCESS) {
            revert NFTTransferFailed(_direction);
        }
    }

    /**
     * @dev Associates the calling contract with a token on the Hedera network.
     * @param tokenId The address of the token to associate with.
     * @return True if the association was successful or if the token was already associated, false otherwise.
     */
    function _tokenAssociate(address tokenId) internal returns (bool) {
        int256 response = associateToken(address(this), tokenId);

        if (
            !(response == SUCCESS ||
                response == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            return false;
        }
        return true;
    }

    /**
     * @dev Transfers multiple NFTs in bulk, either for staking or withdrawal.
     * If staking, it first associates the contract with the token if not already associated.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param nftTokens An array of NFT collection addresses.
     * @param nftSerials A 2D array where each inner array contains the serial numbers of NFTs from the corresponding collection in nftTokens.
     * @param _eoaAddress The address of the externally owned account (EOA) involved in the transfer.
     */
    function _bulkTransfer(
        TransferDirection _direction,
        address[] memory nftTokens,
        uint256[][] memory nftSerials,
        address _eoaAddress
    ) internal {
        if (address(this).balance < 20) {
            lazyGasStation.refillHbar(100);
        }

        uint256 _length = nftTokens.length;
        for (uint256 i = 0; i < _length; ) {
            if (_direction == TransferDirection.STAKING) {
                if (IERC721(nftTokens[i]).balanceOf(address(this)) == 0) {
                    bool success = _tokenAssociate(nftTokens[i]);
                    if (!success) {
                        revert AssociationFailed(nftTokens[i]);
                    }
                }
            }

            // now stake the NFTs for the prize
            _batchMoveNFTs(
                _direction,
                nftTokens[i],
                nftSerials[i],
                _eoaAddress
            );

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Internal function to move NFTs in batches, respecting MAX_NFTS_PER_TX.
     * It iterates through the provided serials and calls `moveNFTs` for each batch.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param _collectionAddress The address of the NFT collection.
     * @param _serials An array of serial numbers for all NFTs to transfer.
     * @param _eoaAddress The address of the EOA involved in the transfer.
     */
    function _batchMoveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _eoaAddress
    ) internal {
        // check the number of serials and send in batches of 8
        for (
            uint256 outer = 0;
            outer < _serials.length;
            outer += MAX_NFTS_PER_TX
        ) {
            uint256 batchSize = (_serials.length - outer) >= MAX_NFTS_PER_TX
                ? MAX_NFTS_PER_TX
                : (_serials.length - outer);
            uint256[] memory serials = new uint256[](batchSize);
            for (
                uint256 inner = 0;
                ((outer + inner) < _serials.length) &&
                    (inner < MAX_NFTS_PER_TX);
                inner++
            ) {
                if (outer + inner < _serials.length) {
                    serials[inner] = _serials[outer + inner];
                }
            }
            _moveNFTs(
                _direction,
                _collectionAddress,
                serials,
                address(this),
                _eoaAddress
            );
        }
    }

    /**
     * @dev Mints new NFTs and transfers them to a receiver.
     * @param token The address of the NFT collection.
     * @param sender The address of the sender (contract treasury).
     * @param receiver The address of the receiver.
     * @param metadata An array of metadata for the new NFTs.
     * @return responseCode The response code from the HTS precompile.
     * @return serialNumbers An array of serial numbers for the minted NFTs.
     */
    function _mintAndTransferNFT(
        address token,
        address sender,
        address receiver,
        bytes[] memory metadata
    ) internal returns (int32 responseCode, int64[] memory serialNumbers) {
        // 1. Mint NFT to contract (treasury)
        (responseCode, , serialNumbers) = mintToken(token, 0, metadata);

        if (responseCode != SUCCESS || serialNumbers.length == 0) {
            return (responseCode, serialNumbers);
        }

        // 2. Transfer the minted NFTs
        address[] memory senderAddresses = new address[](serialNumbers.length);
        address[] memory receiverAddresses = new address[](
            serialNumbers.length
        );

        for (uint256 i = 0; i < serialNumbers.length; i++) {
            senderAddresses[i] = sender;
            receiverAddresses[i] = receiver;
        }
        responseCode = transferNFTs(
            token,
            senderAddresses,
            receiverAddresses,
            serialNumbers
        );
    }

    /// --- Token Transfer Functions ---

    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external {
        _requireAdmin();
        if (receiverAddress == address(0) || amount == 0) {
            revert BadParameters();
        }

        if (address(this).balance < amount) {
            revert BalanceError(address(0), address(this).balance, amount);
        }

        // safe transfer of hbar to the receiver address
        Address.sendValue(receiverAddress, amount);

        emit ContractUpdate(MethodEnum.HBAR_TRANSFER, msg.sender, amount);
    }

    function transferFungible(
        address _tokenAddress,
        address _receiver,
        uint256 _amount
    ) external {
        _requireAdmin();
        if (
            _receiver == address(0) ||
            _amount == 0 ||
            _tokenAddress == address(0)
        ) {
            revert BadParameters();
        }

        if (IERC20(_tokenAddress).balanceOf(address(this)) < _amount) {
            revert BalanceError(
                _tokenAddress,
                IERC20(_tokenAddress).balanceOf(address(this)),
                _amount
            );
        }

        bool success = IERC20(_tokenAddress).transfer(_receiver, _amount);

        if (!success) {
            revert FungibleTokenTransferFailed();
        }

        emit ContractUpdate(MethodEnum.FT_TRANSFER, msg.sender, _amount);
    }

    receive() external payable {
        emit ContractUpdate(MethodEnum.RECEIVE, msg.sender, msg.value);
    }

    fallback() external payable {
        emit ContractUpdate(MethodEnum.FALLBACK, msg.sender, msg.value);
    }
}
