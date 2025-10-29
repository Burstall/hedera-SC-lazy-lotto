# LazyLotto - Business Logic & Use Cases Documentation

## Overview

LazyLotto is a decentralized lottery system built on the Hedera network that allows users to purchase lottery tickets using various tokens (HBAR, $LAZY, or other HTS tokens) and win prizes through a verifiable random number generation system. The contract implements sophisticated prize management, boost mechanisms, and NFT-based ticket systems.

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
2. Contract creates new HTS NFT collection for tickets
3. Admin adds prizes using `addPrizePackage()` or `addMultipleFungiblePrizes()`
4. Pool becomes available for user participation

**Pool Management**:
- `pausePool()` / `unpausePool()`: Control ticket sales
- `closePool()`: Permanently disable pool (requires no outstanding entries)
- `removePrizes()`: Recover prizes from closed pools

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

**LazyGasStation**: Provides automatic HBAR/$LAZY refilling and manages $LAZY burns
**LazyDelegateRegistry**: Handles delegation and permission management
**PrngSystemContract**: Provides verifiable random numbers for fair gameplay
**HTSLazyLottoLibrary**: Handles complex HTS operations (NFT minting, transfers, burns)

### 2. Token Standards

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