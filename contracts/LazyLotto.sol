// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Farming mission
/// @author stowerling.eth / stowerling.hbar
/// @notice Degens going to degen - this contract allows users to spend their $LAZY in the hope
/// of getting prizes from the lotto.
/// @dev now uses hbar for royalty handling currently

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";
import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {ExpiryHelper} from "./ExpiryHelper.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";

import {TokenStaker} from "./TokenStaker.sol";

/// @title  LazyLottoV2
/// @notice On-chain lotto pools with Hedera VRF randomness, multi-roll batching, burn on entry, and transparent prize management.
contract LazyLotto is TokenStaker, ExpiryHelper, ReentrancyGuard, Pausable {
    using SafeCast for uint256;
    using SafeCast for int256;
    using SafeCast for int64;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    // --- DATA STRUCTURES ---
    struct PrizePackage {
        address token; // HTS token address (0 = HBAR)
        uint256 amount; // amount for fungible prizes
        address[] nftTokens; // NFT addresses
        uint256[][] nftSerials; // NFT serials
    }
    struct LottoPool {
        string ticketCID;
        string winCID;
        address poolTokenId;
        uint256 winRateThousandthsOfBps;
        uint256 entryFee;
        address feeToken;
        PrizePackage[] prizes;
        uint256 outstandingEntries;
        EnumerableSet.UintSet winningTickets;
        bool paused;
        bool closed;
    }
    struct PendingPrize {
        uint256 poolId; // pool ID
        PrizePackage prize; // prize package
    }
    struct TimeWindow {
        uint256 start;
        uint256 end;
        uint16 bonusBps;
    }
    struct NFTFeeObject {
        uint32 numerator;
        uint32 denominator;
        uint32 fallbackfee;
        address account;
    }

    /// --- CONSTANTS ---
    /// @notice Maximum possible threshold for winning (100%)
    /// @dev Expressed as integer from 0-100,000,000 where 100,000,000 represents 100%
    uint256 public constant MAX_WIN_RATE_THRESHOLD = 100_000_000;
    uint256 public constant NFT_BATCH_SIZE = 10;

    // --- ENUMS ---
    enum MethodEnum {
        FALLBACK,
        RECEIVE,
        FT_TRANSFER,
        HBAR_TRANSFER
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
    error PoolDoesNotExist();
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
    error FailedNFTMint();
    error FailedNFTWipe();
    error CannotRollWinningTicket();
    error PoolOnPause();
    error EntriesOutstanding(uint256 _outstanding, uint256 _tokensOutstanding);
    error NoPrizesAvailable();

    /// --- EVENTS ---
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event PoolCreated(uint256 indexed poolId);
    event PoolPaused(uint256 indexed poolId);
    event PoolClosed(uint256 indexed poolId);
    event PoolOpened(uint256 indexed poolId);
    event EntryPurchased(address indexed user, uint256 indexed poolId);
    event Rolled(
        address indexed user,
        uint256 indexed poolId,
        bool won,
        uint256 rollBps
    );
    event PrizeAssigned(
        address indexed user,
        uint256 indexed poolId,
        uint256 pkgIdx
    );
    event PrizeClaimed(address indexed user, PrizePackage prize);
    event TicketMintEvent(
        uint256 indexed poolId,
        address indexed tokenId,
        address indexed user,
        int64 serialNumber
    );
    event TicketBurnEvent(
        uint256 indexed poolId,
        address indexed tokenId,
        address indexed user,
        int64 serialNumber
    );
    event PrizeRemoved(
        address indexed user,
        uint256 indexed poolId,
        PrizePackage prize
    );
    event TimeBonusAdded(uint256 start, uint256 end, uint16 bonusBps);
    event NFTBonusSet(address indexed token, uint16 bonusBps);
    event LazyBalanceBonusSet(uint256 threshold, uint16 bonusBps);
    event ContractUpdate(MethodEnum method, address _sender, uint256 _amount);

    // --- STATE ---
    EnumerableSet.AddressSet private admins;
    IPrngSystemContract public prng;
    uint256 public burnPercentage;

    LottoPool[] private pools;
    // allow a lookup of prizes available to a user

    mapping(address => PendingPrize[]) private pending;
    // switched to the hash of tokenId + serialNumber when redeemed to NFT
    mapping(bytes32 => PendingPrize) private pendingNFTs;
    // need to track how much of an FT the contract needs for prizes (won and pledged to pools)
    mapping(address => uint256) private ftTokensForPrizes;

    // Bonus config
    uint16 public timeBonusBps;
    mapping(address => uint16) public nftBonusBps;
    address[] public nftBonusTokens;
    uint256 public lazyBalanceThreshold;
    uint16 public lazyBalanceBonusBps;
    TimeWindow[] public timeBonuses;
    // mapping of poolId -> User -> entries in state
    mapping(uint256 => mapping(address => uint256)) public userEntries;

    // --- MODIFIERS ---
    modifier onlyAdmin() {
        if (!admins.contains(msg.sender)) {
            revert NotAdmin();
        }
        _;
    }
    modifier validPool(uint256 id) {
        if (id >= pools.length) {
            revert LottoPoolNotFound(id);
        }

        if (pools[id].closed) {
            revert PoolIsClosed();
        }
        _;
    }

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

        initContracts(_lazyToken, _lazyGasStation, _lazyDelegateRegistry);
        prng = IPrngSystemContract(_prng);

        burnPercentage = _burnPercentage;

        // Initialize the admins set with the deployer
        admins.add(msg.sender);
    }

    // --- ADMIN FUNCTIONS ---
    function addAdmin(address a) external onlyAdmin {
        admins.add(a);
        emit AdminAdded(a);
    }
    function removeAdmin(address a) external onlyAdmin {
        if (admins.length() <= 1) {
            revert LastAdminError();
        }
        admins.remove(a);
        emit AdminRemoved(a);
    }

    function setBurnPercentage(uint256 _burnPercentage) external onlyAdmin {
        if (_burnPercentage > 100) {
            revert BadParameters();
        }
        burnPercentage = _burnPercentage;
    }

    function setLazyBalanceBonus(
        uint256 _threshold,
        uint16 _bonusBps
    ) external onlyAdmin {
        if (_threshold == 0 || _bonusBps > 10000) {
            revert BadParameters();
        }
        lazyBalanceThreshold = _threshold;
        lazyBalanceBonusBps = _bonusBps;
        emit LazyBalanceBonusSet(_threshold, _bonusBps);
    }

    function setNFTBonus(address _token, uint16 _bonusBps) external onlyAdmin {
        if (_token == address(0) || _bonusBps > 10000) {
            revert BadParameters();
        }
        nftBonusTokens.push(_token);
        nftBonusBps[_token] = _bonusBps;
        emit NFTBonusSet(_token, _bonusBps);
    }

    function setTimeBonus(
        uint256 _start,
        uint256 _end,
        uint16 _bonusBps
    ) external onlyAdmin {
        if (_start == 0 || _end == 0 || _bonusBps > 10000) {
            revert BadParameters();
        }
        timeBonuses.push(TimeWindow(_start, _end, _bonusBps));
        emit TimeBonusAdded(_start, _end, _bonusBps);
    }

    function removeTimeBonus(uint256 index) external onlyAdmin {
        if (index >= timeBonuses.length) {
            revert BadParameters();
        }
        timeBonuses[index] = timeBonuses[timeBonuses.length - 1];
        timeBonuses.pop();
    }

    function removeNFTBonus(uint256 index) external onlyAdmin {
        if (index >= nftBonusTokens.length) {
            revert BadParameters();
        }
        nftBonusTokens[index] = nftBonusTokens[nftBonusTokens.length - 1];
        delete nftBonusBps[nftBonusTokens[index]];
        nftBonusTokens.pop();
    }

    /// Initializes a fresh Lotto pool with the given parameters
    /// @param _name The name of the Pool (for the token)
    /// @param _symbol The symbol of the pool token
    /// @param _memo The memo for the token
    /// @param _royalties The royalties for the token (NFT)
    /// @param _ticketCID The CID for the (unrolled) ticket metadata
    /// @param _winCID The CID for the winning metadata
    /// @param _winRateTenThousandthsOfBps The winning rate in basis points (0-100_000_000)
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
    ) external onlyAdmin {
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
        if (_feeToken != address(0) && _feeToken != lazyToken) {
            tokenAssociate(_feeToken);
        }

        // now mint the token for the pool making the SC the treasury
        IHederaTokenService.TokenKey[]
            memory _keys = new IHederaTokenService.TokenKey[](1);

        // make the contract the sole supply / wipe key
        _keys[0] = getSingleKey(
            KeyType.SUPPLY,
            KeyType.WIPE,
            KeyValueType.CONTRACT_ID,
            address(this)
        );

        IHederaTokenService.HederaToken memory _token;
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
            defaultAutoRenewPeriod
        );

        IHederaTokenService.RoyaltyFee[]
            memory _fees = new IHederaTokenService.RoyaltyFee[](
                _royalties.length
            );

        uint256 _length = _royalties.length;
        for (uint256 f = 0; f < _length; ) {
            IHederaTokenService.RoyaltyFee memory _fee;
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
            int256 responseCode,
            address tokenAddress
        ) = createNonFungibleTokenWithCustomFees(
                _token,
                new IHederaTokenService.FixedFee[](0),
                _fees
            );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedNFTMint();
        }

        // now create the pool and add it to the list of pools;
        LottoPool storage newPool = pools.push();
        newPool.ticketCID = _ticketCID;
        newPool.winCID = _winCID;
        newPool.poolTokenId = tokenAddress;
        newPool.winRateThousandthsOfBps = _winRateTenThousandthsOfBps;
        newPool.entryFee = _entryFee;
        newPool.feeToken = _feeToken;
        // prizes is already an empty array by default
        newPool.outstandingEntries = 0;
        // winningTickets is already initialized by default
        newPool.paused = false;
        newPool.closed = false;

        emit PoolCreated(pools.length - 1);
    }

    function addPrizePackage(
        uint256 poolId,
        address token,
        uint256 amount,
        address[] memory nftTokens,
        uint256[][] memory nftSerials
    ) external payable validPool(poolId) {
        if (nftTokens.length != nftSerials.length) {
            revert BadParameters();
        }

        _checkAndPullFungible(token, amount);

        // check the NFTs are associated to the contract
        uint256 _length = nftTokens.length;
        for (uint256 i = 0; i < _length; ) {
            if (IERC721(nftTokens[i]).balanceOf(address(this)) == 0) {
                tokenAssociate(nftTokens[i]);
            }

            // now stake the NFTs for the prize
            batchMoveNFTs(
                TransferDirection.STAKING,
                nftTokens[i],
                nftSerials[i],
                msg.sender,
                false
            );

            unchecked {
                ++i;
            }
        }

        LottoPool storage p = pools[poolId];
        p.prizes.push(
            PrizePackage({
                token: token,
                amount: amount,
                nftTokens: nftTokens,
                nftSerials: nftSerials
            })
        );

        emit PrizeAssigned(msg.sender, poolId, p.prizes.length - 1);
    }

    function addMultipleFungiblePrizes(
        uint256 poolId,
        address tokenId,
        uint256[] memory amounts
    ) external payable validPool(poolId) {
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

            emit PrizeAssigned(msg.sender, poolId, p.prizes.length - 1);

            unchecked {
                ++i;
            }
        }
    }

    /// Admin can pause a pool preventing the purchase of further tickets
    function pausePool(uint256 poolId) external onlyAdmin validPool(poolId) {
        LottoPool storage p = pools[poolId];
        p.paused = true;
        emit PoolPaused(poolId);
    }

    /// Admin can unpause a pool allowing the purchase of further tickets
    function unpausePool(uint256 poolId) external onlyAdmin validPool(poolId) {
        LottoPool storage p = pools[poolId];
        p.paused = false;
        emit PoolOpened(poolId);
    }

    /// Admin can permanently close a pool preventing any further actions
    /// Required to be able to remove prizes from the pool
    function closePool(uint256 poolId) external onlyAdmin validPool(poolId) {
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
    function removePrizes(
        uint256 poolId,
        uint256 prizeIndex
    ) external onlyAdmin {
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
        uint256 _length = prize.nftTokens.length;
        for (uint256 i = 0; i < _length; ) {
            // now stake the NFTs for the prize
            batchMoveNFTs(
                TransferDirection.WITHDRAWAL,
                prize.nftTokens[i],
                prize.nftSerials[i],
                msg.sender,
                false
            );

            unchecked {
                ++i;
            }
        }

        // emit the event for the prize removal
        emit PrizeRemoved(msg.sender, poolId, prize);
    }

    // PAUSE
    function pause() external onlyAdmin {
        _pause();
    }
    function unpause() external onlyAdmin {
        _unpause();
    }

    // --- USER ACTIONS ---
    function buyEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused validPool(poolId) nonReentrant {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        _buyEntry(poolId, ticketCount, false);
    }

    /// Helper function to allow the user to buy and roll in one transaction
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    function buyAndRollEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused validPool(poolId) nonReentrant {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        _buyEntry(poolId, ticketCount, false);
        _roll(poolId, ticketCount);
    }

    function buyAndRedeemEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused validPool(poolId) nonReentrant {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        _buyEntry(poolId, ticketCount, false);
        _redeemEntriesToNFT(poolId, ticketCount, msg.sender);
    }

    function adminBuyEntry(
        uint256 poolId,
        uint256 ticketCount,
        address onBehalfOf
    ) external whenNotPaused onlyAdmin validPool(poolId) nonReentrant {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        _buyEntry(poolId, ticketCount, false);
        _redeemEntriesToNFT(poolId, ticketCount, onBehalfOf);
    }

    /// User rolls all tickets in the pool (in memory not any NFT entries)
    function rollAll(
        uint256 poolId
    )
        external
        whenNotPaused
        validPool(poolId)
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        if (userEntries[poolId][msg.sender] == 0) {
            revert NoTickets(poolId, msg.sender);
        }
        return _roll(poolId, userEntries[poolId][msg.sender]);
    }

    function rollBatch(
        uint256 poolId,
        uint256 numberToRoll
    )
        external
        whenNotPaused
        validPool(poolId)
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
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

    function rollWithNFT(
        uint256 poolId,
        int64[] memory serialNumbers
    )
        external
        whenNotPaused
        validPool(poolId)
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        if (serialNumbers.length == 0) {
            revert BadParameters();
        }

        // redeem the tickets for the user and credit the entries
        _redeemEntriesFromNFT(poolId, serialNumbers);
        return _roll(poolId, serialNumbers.length);
    }

    function redeemPrizeToNFT(
        uint256[] memory indices
    ) external nonReentrant returns (int64[] memory serials) {
        return _redeemPendingPrizeToNFT(indices);
    }

    function claimPrizeFromNFT(
        address tokenId,
        int64[] memory serialNumbers
    ) external nonReentrant {
        uint256[] memory prizeSlots = _redeemPendingPrizeFromNFT(
            tokenId,
            serialNumbers
        );
        uint256 _length = prizeSlots.length;
        for (uint256 i = 0; i < _length; ) {
            _claimPrize(prizeSlots[i]);
        }
    }

    function claimPrize(uint256 pkgIdx) external nonReentrant {
        _claimPrize(pkgIdx);
    }

    function claimAllPrizes() external nonReentrant {
        uint256 _length = pending[msg.sender].length;
        if (_length == 0) {
            revert NoPendingPrizes();
        }
        for (uint256 i = 0; i < _length; ) {
            _claimPrize(i);
            unchecked {
                ++i;
            }
        }
    }

    /// --- VIEWS (Getters) ---
    function totalPools() external view returns (uint256) {
        return pools.length;
    }
    function getPoolDetails(
        uint256 id
    )
        external
        view
        returns (
            string memory ticketCID,
            string memory winCID,
            address poolTokenId,
            uint256 winRateThousandthsOfBps,
            uint256 entryFee,
            address feeToken,
            uint256 prizesLength,
            uint256 outstandingEntries,
            bool paused,
            bool closed,
            uint256[] memory winningTickets
        )
    {
        if (id < pools.length) {
            LottoPool storage p = pools[id];
            ticketCID = p.ticketCID;
            winCID = p.winCID;
            poolTokenId = p.poolTokenId;
            winRateThousandthsOfBps = p.winRateThousandthsOfBps;
            entryFee = p.entryFee;
            feeToken = p.feeToken;
            prizesLength = p.prizes.length;
            outstandingEntries = p.outstandingEntries;
            paused = p.paused;
            closed = p.closed;
            winningTickets = p.winningTickets.values();
        } else {
            revert PoolDoesNotExist();
        }
    }
    function getPoolPrizes(
        uint256 poolId
    ) external view returns (PrizePackage[] memory) {
        return pools[poolId].prizes;
    }
    function getUsersEntries(
        uint256 poolId,
        address user
    ) external view returns (uint256) {
        return userEntries[poolId][user];
    }
    function getUserEntries(
        address user
    ) external view returns (uint256[] memory) {
        uint256[] memory entries = new uint256[](pools.length);
        for (uint256 i = 0; i < pools.length; i++) {
            entries[i] = userEntries[i][user];
        }
        return entries;
    }
    function getPendingPrizes(
        address user
    ) external view returns (PendingPrize[] memory) {
        return pending[user];
    }
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
    function getPendingPrizes(
        address tokenId,
        uint256 serialNumber
    ) external view returns (PendingPrize memory) {
        return pendingNFTs[keccak256(abi.encode(tokenId, serialNumber))];
    }
    function isAdmin(address a) external view returns (bool) {
        return admins.contains(a);
    }
    function totalTimeBonuses() external view returns (uint256) {
        return timeBonuses.length;
    }
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
        ftTokensForPrizes[tokenId] += amount;

        if (tokenId == address(0)) {
            if (address(this).balance < ftTokensForPrizes[tokenId]) {
                revert BalanceError(address(0), address(this).balance, amount);
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
                    tokenAssociate(tokenId);
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
                    p.winningTickets.contains(
                        serialNumbers[outer + inner].toUint256()
                    )
                ) {
                    revert CannotRollWinningTicket();
                }

                batchSerialsForBurn[inner] = serialNumbers[outer + inner];
                emit TicketBurnEvent(
                    _poolId,
                    p.poolTokenId,
                    msg.sender,
                    batchSerialsForBurn[inner]
                );
                unchecked {
                    ++inner;
                }
            }

            int256 response = wipeTokenAccountNFT(
                p.poolTokenId,
                msg.sender,
                batchSerialsForBurn
            );

            if (response != HederaResponseCodes.SUCCESS) {
                revert FailedNFTWipe();
            }

            // now credit the entries to the user
            userEntries[_poolId][msg.sender] += thisBatch;
            p.outstandingEntries += thisBatch;
        }
    }

    function _redeemPendingPrizeToNFT(
        uint256[] memory _idxs
    ) internal returns (int64[] memory mintedSerials) {
        uint256 count = _idxs.length;
        if (count == 0) {
            revert BadParameters();
        }
        mintedSerials = new int64[](count);

        // To avoid issues with shifting indices as we pop, we process highest indices first
        // Sort _idxs descending (simple selection sort for small arrays)
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
            uint256 _idx = _idxs[k];
            if (_idx >= pending[msg.sender].length) {
                revert BadParameters();
            }

            PendingPrize memory prize = pending[msg.sender][_idx];
            // remove the prize from the pending list
            pending[msg.sender][_idx] = pending[msg.sender][
                pending[msg.sender].length - 1
            ];
            pending[msg.sender].pop();

            // find the pool
            LottoPool storage p = pools[prize.poolId];

            bytes[] memory batchMetadataForMint = new bytes[](1);
            batchMetadataForMint[0] = bytes(p.winCID);

            // mint the NFT for the prize
            (int256 response, , int64[] memory serialNumbers) = mintToken(
                p.poolTokenId,
                0,
                batchMetadataForMint
            );

            if (response != HederaResponseCodes.SUCCESS) {
                revert FailedNFTMint();
            }

            // transfer the token to the user
            address[] memory senderList = new address[](1);
            address[] memory receiverList = new address[](1);
            emit TicketMintEvent(
                prize.poolId,
                p.poolTokenId,
                msg.sender,
                serialNumbers[0]
            );

            senderList[0] = address(this);
            receiverList[0] = msg.sender;
            mintedSerials[k] = serialNumbers[0];

            // add the winning serial to the Pool winning tickets
            p.winningTickets.add(uint256(uint64(mintedSerials[k])));

            response = transferNFTs(
                p.poolTokenId,
                senderList,
                receiverList,
                serialNumbers
            );

            if (response != HederaResponseCodes.SUCCESS) {
                revert NFTTransferFailed(TransferDirection.WITHDRAWAL);
            }

            unchecked {
                ++k;
            }
        }

        return mintedSerials;
    }

    function _redeemPendingPrizeFromNFT(
        address tokenId,
        int64[] memory serialNumbers
    ) internal returns (uint256[] memory prizeSlots) {
        uint256 length = serialNumbers.length;
        prizeSlots = new uint256[](length);
        for (uint256 outer = 0; outer < length; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (length - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (length - outer);
            int64[] memory batchSerialsForBurn = new int64[](thisBatch);
            for (
                uint256 inner = 0;
                ((outer + inner) < length) && (inner < thisBatch);

            ) {
                // check the token has a pending prize
                bytes32 key = keccak256(
                    abi.encode(tokenId, serialNumbers[outer + inner])
                );

                PendingPrize memory pendingPrize = pendingNFTs[key];
                if (pendingPrize.prize.token == address(0)) {
                    revert BadParameters();
                }

                // move the pending prize to the user
                pending[msg.sender].push(pendingPrize);
                // remove the prize from the pending list
                delete pendingNFTs[key];

                // remove the serial from the winning tickets
                LottoPool storage p = pools[pendingPrize.poolId];
                p.winningTickets.remove(
                    serialNumbers[outer + inner].toUint256()
                );

                prizeSlots[outer + inner] = pending[msg.sender].length - 1;

                batchSerialsForBurn[inner] = serialNumbers[outer + inner];
                emit TicketBurnEvent(
                    pendingPrize.poolId,
                    tokenId,
                    msg.sender,
                    batchSerialsForBurn[inner]
                );
                unchecked {
                    ++inner;
                }
            }

            int256 response = wipeTokenAccountNFT(
                tokenId,
                msg.sender,
                batchSerialsForBurn
            );

            if (response != HederaResponseCodes.SUCCESS) {
                revert FailedNFTWipe();
            }
        }
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
        mintedSerials = new int64[](_numTickets);
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

            (int256 response, , int64[] memory serialNumbers) = mintToken(
                p.poolTokenId,
                0,
                batchMetadataForMint
            );

            if (response != HederaResponseCodes.SUCCESS) {
                revert FailedNFTMint();
            }

            // transfer the token to the user
            address[] memory senderList = new address[](serialNumbers.length);
            address[] memory receiverList = new address[](serialNumbers.length);
            uint256 length = serialNumbers.length;
            for (uint256 s = 0; s < length; ) {
                emit TicketMintEvent(
                    _poolId,
                    p.poolTokenId,
                    msg.sender,
                    serialNumbers[s]
                );
                senderList[s] = address(this);
                receiverList[s] = _onBehalfOf;
                mintedSerials[s + outer] = serialNumbers[s];

                unchecked {
                    ++s;
                }
            }

            response = transferNFTs(
                p.poolTokenId,
                senderList,
                receiverList,
                serialNumbers
            );

            if (response != HederaResponseCodes.SUCCESS) {
                revert NFTTransferFailed(TransferDirection.WITHDRAWAL);
            }
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
        for (uint256 i = 0; i < ticketCount; i++) {
            emit EntryPurchased(msg.sender, poolId);
        }
    }

    function _roll(
        uint256 poolId,
        uint256 numberToRoll
    ) internal returns (uint256 wins, uint256 offset) {
        uint32 boostBps = calculateBoost(msg.sender);

        LottoPool storage p = pools[poolId];

        // ensure we know the total number of prizes available
        uint256 totalPrizes = p.prizes.length;
        if (totalPrizes == 0) {
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

        uint256 winRateThreshold = p.winRateThousandthsOfBps +
            boostBps *
            10_000;
        // check we are below the threshold for the win rate
        if (winRateThreshold > MAX_WIN_RATE_THRESHOLD) {
            winRateThreshold = MAX_WIN_RATE_THRESHOLD;
        }

        // check the offset of the users current pending prizes
        // this is the number of prizes that have been assigned to the user already
        // this makes it easier to see what the user has won
        offset = pending[msg.sender].length;

        // roll the whole list with getPseudorandomNumberArray
        uint256[] memory rolls = prng.getPseudorandomNumberArray(
            0,
            100_000_000,
            uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))),
            numberToRoll
        );

        // roll the tickets and check if the user won
        for (uint256 i = 0; i < numberToRoll; i++) {
            bool won = rolls[i] < p.winRateThousandthsOfBps;
            // if people roll more than the number of prizes and they win rest will be burnt
            // that's the downside of luck!
            if (won && totalPrizes > 0) {
                // randomly select a prize package and remove it from the pool
                uint256 pkgIdx = rolls[i] % totalPrizes;
                PrizePackage memory pkg = p.prizes[pkgIdx];
                p.prizes[pkgIdx] = p.prizes[totalPrizes - 1];
                p.prizes.pop();

                totalPrizes--;
                wins++;

                // add the prize to the pending list for the user
                // tie it back to the poolId so we can mint to NFT later
                pending[msg.sender].push(
                    PendingPrize({poolId: poolId, prize: pkg})
                );

                emit PrizeAssigned(msg.sender, poolId, pkgIdx);
            }
            emit Rolled(msg.sender, poolId, won, rolls[i]);
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

        // now claim the NFTs for the prize
        uint256 _length = claimedPrize.prize.nftTokens.length;
        for (uint256 i = 0; i < _length; i++) {
            // use batchMoveNFTs to move the NFTs
            batchMoveNFTs(
                TransferDirection.WITHDRAWAL,
                claimedPrize.prize.nftTokens[i],
                claimedPrize.prize.nftSerials[i],
                msg.sender,
                false
            );
        }
    }

    /// --- Token Transfer Functions ---

    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyAdmin {
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
    ) external onlyAdmin {
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
