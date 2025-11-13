# LazyLotto - Business Logic & Use Cases Documentation

**Last Updated**: November 12, 2025
**Contract Version**: LazyLotto v2 (Split Pattern with LazyLottoStorage)
**Contract Sizes**: LazyLotto 23.612 KB | LazyLottoStorage 11.137 KB

## Overview

LazyLotto is a decentralized lottery system built on the Hedera network that allows users to purchase lottery tickets using various tokens (HBAR, $LAZY, or other HTS tokens) and win prizes through Hedera's verifiable random number generation (VRF) system. The contract implements sophisticated prize management, boost mechanisms, NFT-based ticket systems, and role-based access control for partnership enablement.

## Core Concepts

### 1. Lottery Pools
Each lottery pool represents an independent lottery with its own:
- **Entry Fee**: Cost to purchase a ticket (in specified token)
- **Win Rate**: Probability of winning (expressed in ten-thousandths of basis points)
- **Prize Pool**: Collection of available prizes (HBAR, tokens, NFTs)
- **Pool Token**: Unique NFT collection for ticket representation
- **Metadata**: IPFS CIDs for ticket artwork (winning/non-winning states)

### 2. Ticket System
The system supports two types of ticket ownership:
- **Memory Entries**: Tickets held in contract memory (gas efficient for rolling)
- **NFT Tickets**: Tickets minted as NFTs (transferable, tradeable)

Users can convert between these formats at will, enabling both efficient gameplay and secondary market trading.

### 3. Prize Management
Prizes are managed through a sophisticated system that supports:
- **HBAR Prizes**: Native Hedera currency
- **Fungible Token Prizes**: Any HTS token including $LAZY
- **NFT Prizes**: Collections of NFTs with specific serial numbers
- **Pending Prizes**: Won prizes awaiting claim
- **Prize NFTs**: Prizes can be converted to NFTs for trading before claiming

### 4. Boost System
Users can receive win rate bonuses through:
- **Time-Based Bonuses**: Active during specific time windows
- **NFT Holding Bonuses**: For holding specific NFT collections
- **$LAZY Balance Bonuses**: For maintaining minimum $LAZY holdings

## Primary Use Cases

### 1. Basic Lottery Participation

**User Story**: "As a user, I want to buy lottery tickets and try to win prizes"

**Flow**:
1. User calls `buyEntry(poolId, ticketCount)` with appropriate payment
2. Contract validates payment and pool status
3. Tickets are added to user's memory entries
4. User calls `rollAll(poolId)` or `rollBatch(poolId, count)` to play
5. Contract uses Hedera VRF to determine wins/losses
6. Winning tickets generate prizes added to user's pending collection
7. User calls `claimPrize(index)` or `claimAllPrizes()` to receive prizes

**Payment Methods**:
- HBAR: Send native currency with transaction
- $LAZY: Automatic burn percentage applied, drawn from LazyGasStation
- Other HTS Tokens: Standard ERC20 transfer with approval

### 2. NFT-Based Ticket Trading

**User Story**: "As a user, I want to buy tickets as NFTs to trade them before rolling"

**Flow**:
1. User calls `buyAndRedeemEntry(poolId, ticketCount)` 
2. Contract mints NFTs representing tickets to user's wallet
3. User can trade NFTs on secondary markets
4. When ready to play, user calls `rollWithNFT(poolId, serialNumbers)`
5. Contract burns the NFT tickets and processes rolls
6. Prizes are awarded as normal

### 3. Administrative Pool Management

**User Story**: "As an admin, I want to create and manage lottery pools"

**Pool Creation Flow**:
1. Admin calls `createPool()` with parameters:
   - Pool metadata (name, symbol, artwork CIDs)
   - Win rate and entry fee
   - Fee token specification
   - **Forwards msg.value** to cover HTS token creation costs
2. Contract creates new HTS NFT collection for tickets via `storageContract.createToken{value: msg.value}()`
3. Admin OR Prize Manager adds prizes using:
   - `addPrizePackage()` - Single package (HBAR/FT/NFT)
   - `addMultipleFungiblePrizes()` - Batch fungible prizes
4. Pool becomes available for user participation

**Pool Management**:
- `pausePool()` / `unpausePool()`: Control ticket sales
- `closePool()`: Permanently disable pool (requires no outstanding entries)
- `removePrizes()`: Recover prizes from closed pools (admin-only)

**Prize Manager Role** (NEW):
Enables partnerships without granting full admin privileges:
- `addPrizeManager(address)` - Admin grants prize addition rights
- `removePrizeManager(address)` - Admin revokes rights
- `isPrizeManager(address)` - Check role status
- Prize managers can ONLY add prizes, not manage pools or settings
- Prevents reputation risk from dubious/scam token prizes
- Revocable at any time by admin

**NFT Bonus Deduplication** (NEW):
When setting NFT bonuses, system prevents duplicate entries:
- `setNFTBonus(token, bps)` checks if token already exists in `nftBonusTokens` array
- If found, updates bonus amount without adding duplicate
- Prevents double-counting in `calculateBoost()` iterations
- Protects users from accidental misconfiguration

**Token Withdrawal Operations** (Admin Safety):

Admins can withdraw excess tokens from storage, but the system enforces safety checks to protect user prize obligations:

1. **Withdraw HBAR from Storage**: `transferHbarFromStorage(recipient, amount)`
   - Checks: `storageBalance - amount >= ftTokensForPrizes[address(0)]`
   - Use case: Withdraw royalty payments, excess HBAR accidentally sent to storage
   - Safety: Cannot withdraw if it would leave insufficient HBAR for prizes
   - Verification: Use `checkMirrorHbarBalance(env, storageContractId)` from mirror node

2. **Withdraw Fungible Tokens from Storage**: `transferFungible(token, recipient, amount)`
   - Checks: `storageBalance - amount >= ftTokensForPrizes[token]`
   - Use case: Withdraw excess tokens, recover accidentally sent tokens
   - Safety: Cannot withdraw if it would leave insufficient tokens for prizes
   - Verification: Use `checkMirrorBalance(env, storageContractId, tokenId)` from mirror node

3. **Withdraw HBAR from LazyLotto**: `transferHbar(recipient, amount)`
   - No safety check (LazyLotto doesn't hold prize funds)
   - Use case: Withdraw HBAR accidentally sent directly to LazyLotto contract
   - Note: Regular operations send HBAR to storage, not LazyLotto
   - Verification: Use `checkMirrorHbarBalance(env, contractId)` from mirror node

**Key Points**:
- All withdrawals from storage must go through LazyLotto facade methods
- `ftTokensForPrizes[token]` mapping tracks total token obligations for all prizes
- Storage methods (`withdrawHbar`, `withdrawFungible`) are `onlyContractUser` - cannot be called directly
- This ensures users always have certainty their prizes can be paid out
- **Mirror node methods provide independent balance verification**:
  - `checkMirrorBalance(env, accountId, tokenId)` - Fungible token balance
  - `checkMirrorHbarBalance(env, accountId)` - HBAR balance
  - `getSerialsOwned(env, accountId, tokenId)` - NFT serials owned

### 4. Prize Trading System

**User Story**: "As a user, I want to trade my won prizes before claiming them"

**Flow**:
1. User wins prizes through normal gameplay
2. User calls `redeemPrizeToNFT(indices)` to convert pending prizes to NFTs
3. Contract mints special prize NFTs representing the rewards
4. User can trade these prize NFTs on secondary markets
5. Final holder calls `claimPrizeFromNFT(tokenId, serialNumbers)` to claim actual prizes

**Prize Inspection Flow**:
1. User calls `getPendingPrizes(userAddress)` to see all won prizes
2. Each `PendingPrize` object contains a `poolId` and `prize` (PrizePackage)
3. To inspect prize details, user calls `getPrizePackage(poolId, prizeIndex)` 
4. Returns detailed breakdown: token address, amount, NFT collections, and serial numbers
5. Frontend can display: "Prize #1: 100 HBAR + 5 $LAZY + 3 NFTs from Collection X"
6. **Balance verification**: Use `checkMirrorBalance(env, userAddress, tokenId)` to verify balances independently

**Use Case**: Before claiming or converting to NFT, users can inspect exactly what prizes they've won, enabling informed decision-making about whether to claim immediately or trade the prize NFT.

### 5. Batch Operations & Gas Optimization

**User Story**: "As a user, I want to efficiently manage multiple tickets and prizes"

**Available Batch Operations**:
- `buyAndRollEntry()`: Purchase and immediately roll tickets
- `rollBatch()`: Roll specific number of tickets
- `rollWithNFT()`: Roll multiple NFT tickets at once
- `claimAllPrizes()`: Claim all pending prizes
- Automatic gas refilling through LazyGasStation integration

## Advanced Features

### 1. Boost Calculation System

The contract implements a sophisticated boost system that increases win rates based on user holdings:

```solidity
function calculateBoost(address _user) public view returns (uint32)
```

**Boost Types**:
- **Time Bonuses**: Active during configured time windows
- **NFT Bonuses**: For holding specific NFT collections  
- **$LAZY Balance Bonuses**: For maintaining minimum $LAZY balance

#### Bonus Stacking Mechanics

**Cumulative Calculation**: All applicable bonuses stack additively to create a total boost value. The system evaluates each bonus type independently and sums them together.

**Example Stacking Scenario**:
```
Base Win Rate: 1000 (10.00%)
+ Time Bonus: 500 (5.00%) [if currently in active time window]
+ NFT Bonus: 300 (3.00%) [if user holds required NFT collection]
+ LAZY Bonus: 200 (2.00%) [if user has sufficient $LAZY balance]
= Total Boost: 1000 (10.00% additional)
= Final Win Rate: 2000 (20.00%)
```

**Precision & Scaling**: Boosts are expressed in basis points scaled to ten-thousandths for maximum precision. This allows for fractional percentage bonuses while maintaining integer arithmetic.

**Overflow Protection**: The system includes built-in overflow protection with a maximum boost cap of 4,294,967,295 (uint32 maximum), preventing mathematical overflow errors even with extreme bonus combinations.

**Real-Time Evaluation**: Boost calculations are performed dynamically at the time of rolling, ensuring users always benefit from their current holdings and active time windows without needing to "refresh" their boost status.

**Bonus Configuration**:
- **Time Bonuses**: Set with `setTimeBonus(startTime, endTime, bps)` - up to 10,000 bps (100% bonus)
- **NFT Bonuses**: Set with `setNFTBonus(tokenAddress, bps)` - verified via real-time balance check
- **LAZY Bonuses**: Set with `setLazyBalanceBonus(threshold, bps)` - checked against current $LAZY balance

This stacking system enables sophisticated player strategies where users can optimize their timing, token holdings, and NFT collections to maximize their winning potential.

### 2. Automatic Resource Management

The contract includes automatic resource management through the `refill` modifier:
- Monitors contract $LAZY balance (refills at <20 tokens)
- Monitors contract HBAR balance (refills at <20 tinybars)
- Automatically requests refills from LazyGasStation

### 3. Security Features

**Access Control**:
- Multi-admin system with protected admin functions
- Prevention of removing the last admin
- Role-based permissions for all administrative functions

**Financial Security**:
- ReentrancyGuard on all state-changing functions
- Pausable functionality for emergency stops
- Careful tracking of token balances for prizes
- Validation of all user inputs and state transitions

**Operational Security**:
- Pool validation through `validPool` modifier
- Prevention of operations on closed pools
- Outstanding entry tracking to prevent premature pool closure

## Integration Points

### 1. External Dependencies

**LazyGasStation**: Provides automatic HBAR refilling and manages $LAZY burns
**LazyDelegateRegistry**: Handles delegation and permission management
**PrngSystemContract**: Provides verifiable random numbers for fair gameplay
**LazyLottoStorage**: Isolated storage contract handling all HTS token operations (transfers, burns, associations)

### 2. Storage Pattern Architecture

**LazyLotto** and **LazyLottoStorage** implement a split-contract architecture to stay within Hedera's 24 KB contract size limit while maintaining full functionality:

**LazyLotto (22.939 KB)**:
- Pure business logic (pools, tickets, prizes, gameplay)
- References `storageContract` (set once in constructor, immutable)
- Delegates all token operations to storage
- Maintains accounting state (`ftTokensForPrizes` mapping)
- **Acts as the sole interface for all operations** - users and admins interact only with LazyLotto

**LazyLottoStorage (11.218 KB)**:
- All HTS token operations (transfers, associations, burns, minting)
- Holds all prize tokens (HBAR, FT, NFT) as treasury
- Access controlled via `onlyContractUser` modifier (only LazyLotto can call)
- No direct user interaction - all operations delegated from LazyLotto
- Permanently paired 1:1 with its LazyLotto instance

**Deployment Flow**:
1. Deploy LazyLottoStorage with (lazyGasStation, lazyToken) - LAZY token auto-associated in constructor
2. Deploy LazyLotto with storage address and other dependencies
3. Call `storage.setContractUser(lazyLotto.address)` - locks permanently (one-time only)
4. Users approve tokens to storage address (query via `lazyLotto.storageContract()`)

**Token Flow Architecture**:
```
User → LazyLotto (validates & checks) → LazyLottoStorage (executes HTS operations)

Entry Fees:
  User.buyEntry{value: 100}() 
  → LazyLotto validates pool, refunds excess
  → storageContract.depositHbar{value: 100}() 
  → HBAR held in LazyLottoStorage

Prize Deposits:
  Admin.addPrizePackage{value: 500}()
  → LazyLotto tracks in ftTokensForPrizes[token]
  → storageContract.depositHbar{value: 500}()
  → HBAR held in LazyLottoStorage

Prize Payouts:
  User.claimPrize(index)
  → LazyLotto verifies prize, updates ftTokensForPrizes[token]
  → storageContract.withdrawHbar(user, amount)
  → User receives HBAR from storage
```

**Admin Withdrawal Safety Pattern**:

All admin withdrawals must go through LazyLotto's facade methods to ensure prize obligations are protected:

```solidity
// LazyLotto.transferHbarFromStorage() - Safe withdrawal from storage
1. Admin calls LazyLotto.transferHbarFromStorage(recipient, amount)
2. LazyLotto checks: storageBalance - amount >= ftTokensForPrizes[address(0)]
3. If safe: LazyLotto → storageContract.withdrawHbar(recipient, amount)
4. If unsafe: Reverts with BalanceError (insufficient for prize obligations)

// LazyLotto.transferFungible() - Safe withdrawal from storage  
1. Admin calls LazyLotto.transferFungible(token, recipient, amount)
2. LazyLotto checks: storageBalance - amount >= ftTokensForPrizes[token]
3. If safe: LazyLotto → storageContract.withdrawFungible(token, recipient, amount)
4. If unsafe: Reverts with BalanceError (insufficient for prize obligations)

// LazyLotto.transferHbar() - Direct withdrawal from LazyLotto itself
1. Admin calls LazyLotto.transferHbar(recipient, amount)
2. Only withdraws HBAR sent directly to LazyLotto contract (not prize funds)
3. No safety check needed (not prize obligations)
```

**Why This Matters**:
- **User Protection**: `ftTokensForPrizes` mapping ensures funds for all outstanding prizes remain in storage
- **No Direct Storage Access**: LazyLottoStorage methods are `onlyContractUser` - admins cannot bypass safety checks
- **Facade Pattern**: LazyLotto is the single point of entry for all operations, enforcing business rules
- **Accidental Deposits**: Any tokens accidentally sent to either contract can be safely recovered without affecting prizes

**Key Principle**: LazyLottoStorage never makes business logic decisions - it only executes HTS operations as instructed by LazyLotto after all safety checks pass.

### 3. Token Standards

**HTS Compatibility**: Full integration with Hedera Token Service
**ERC20/ERC721 Interfaces**: Standard token interactions for maximum compatibility
**Custom NFT Collections**: Each pool creates its own NFT collection for tickets

## Economic Model

### 1. Revenue Streams
- Entry fees collected in various tokens
- Burn mechanics on $LAZY transactions
- Prize funding from administrators

### 2. Cost Management
- Automatic gas refilling
- Efficient batch operations
- Optimized storage patterns

### 3. Prize Economics
- Flexible prize funding (admin-provided)
- Accurate tracking of prize obligations
- Support for cross-token prize pools

## User Interaction Patterns

### 1. Casual Player
- Buy tickets with HBAR/tokens
- Roll immediately for instant gratification
- Claim prizes directly

### 2. Strategic Player
- Monitor boost opportunities
- Time purchases for bonus windows
- Accumulate entries before rolling

### 3. Trader/Speculator
- Purchase tickets as NFTs
- Trade tickets on secondary markets
- Convert prizes to NFTs for trading

### 4. Prize Collector
- Focus on specific prize types
- Use boost system strategically
- Manage prize portfolio through NFT system

This business logic framework provides the foundation for comprehensive testing and ensures all stakeholders understand the system's capabilities and intended usage patterns.