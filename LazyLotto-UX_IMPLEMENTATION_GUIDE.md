# LazyLotto - UX Implementation Guide for Frontend Developers

**Version:** 2.1  
**Last Updated:** December 2, 2025  
**Contract Versions:** LazyLotto 23.782 KB | LazyLottoStorage 11.137 KB
**Target Audience:** Frontend Developers, UX Designers, Integration Engineers

---

## ⚠️ Breaking Changes Alert - December 2025

**API Version 2.1 contains breaking changes** due to contract size constraints (24 KB limit). Three view functions have been removed and replaced with paginated alternatives.

**📋 See [API Breaking Changes Guide](./LazyLotto-API_BREAKING_CHANGES.md) for complete migration instructions.**

**Quick Summary:**
- ❌ `getPoolDetails()` → ✅ `getPoolBasicInfo()` (returns prize count, not array)
- ❌ `getPendingPrizes()` → ✅ `getPendingPrizesPage()` + `getPendingPrizesCount()`
- ❌ `getUserEntries()` → ✅ `getUserEntriesPage()`

---

## Overview

This guide provides comprehensive instructions for building user-facing applications that interact with the LazyLotto smart contract. It covers all user flows, required contract method calls, data presentation patterns, error handling, gas estimation strategies, and best practices for creating an intuitive lottery experience.

### Key Updates in v2.1

- 🔴 **BREAKING CHANGES**: Three view functions replaced with paginated alternatives (see breaking changes guide)
- ✅ **Scalability**: Supports pools with 100+ prizes without response size failures
- ✅ **Performance**: Paginated queries reduce response times for large datasets
- ✅ **Reliability**: Never fails due to response size limits

### Key Updates in v2.0

- ✅ **Prize Manager Role**: Separate authorization for prize addition (partnerships)
- ✅ **NFT Bonus Deduplication**: Prevents duplicate bonus calculations
- ✅ **Gas Estimation Patterns**: Smart multipliers for roll operations (1.5x for PRNG uncertainty)
- ✅ **Mirror Node Integration**: Balance verification patterns for accuracy
- ✅ **Safety Checks**: Admin withdrawal protection for prize obligations
- ✅ **Entry Redemption**: New `redeemEntriesToNFT()` allows converting memory entries to tradeable NFT tickets

### Architecture Note

LazyLotto uses a **split-contract architecture** for size optimization:

- **LazyLotto** (23.612 KB): Your primary interface - handles all business logic, user interactions, and admin operations
- **LazyLottoStorage** (11.137 KB): Internal contract that holds tokens and executes HTS operations

**Important for Frontend Developers**:
1. **Only interact with LazyLotto** - all user and admin functions are exposed here
2. **Token approvals must go to the storage contract** - get the address via `contract.storageContract()`
3. **Never call LazyLottoStorage directly** - it's access-controlled and only accepts calls from LazyLotto
4. **Use mirror node for balance verification** - provides independent confirmation of token balances

```javascript
// STEP 1: Get storage address for token approvals
const storageAddress = await lazyLottoContract.storageContract();
console.log('Storage contract:', storageAddress);
// Example output: "0x0000000000000000000000000000000000123456"

// STEP 2: Approve tokens to storage (required before buying tickets with tokens)
// For fungible tokens (like custom prize tokens):
await tokenContract.approve(storageAddress, amount);

// For NFT operations (like redeeming ticket NFTs):
await nftContract.setApprovalForAll(storageAddress, true);

// STEP 3: Call LazyLotto methods (not storage)
// The LazyLotto contract will internally delegate to storage for token operations
await lazyLottoContract.buyEntry(poolId, ticketCount);
```

**Why This Architecture?**
- **Size Limit**: Hedera has a 24 KB contract size limit
- **Separation of Concerns**: Business logic (LazyLotto) separate from token operations (Storage)
- **User Experience**: Users only need to know about LazyLotto - storage is invisible
- **Safety**: Storage contract is permanently locked to LazyLotto (set once via `setContractUser()`)

**Critical Token Approval Pattern**:
```javascript
// ❌ WRONG - Approving to LazyLotto won't work for token transfers
await tokenContract.approve(lazyLottoAddress, amount);

// ✅ CORRECT - Approve to storage contract
const storageAddress = await lazyLottoContract.storageContract();
await tokenContract.approve(storageAddress, amount);
```

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core User Flows](#core-user-flows)
3. [Data Fetching Patterns](#data-fetching-patterns)
4. [Display Components](#display-components)
5. [Transaction Workflows](#transaction-workflows)
6. [Error Handling](#error-handling)
7. [Real-Time Updates](#real-time-updates)
8. [Best Practices](#best-practices)

---

## Quick Start

### Essential Contract Methods

**Read-Only (View) Methods:**
```solidity
// Pool information (UPDATED in v2.1)
totalPools() → uint256
getPoolBasicInfo(poolId) → (tuple of 10 values)  // 🆕 Replaces getPoolDetails()
getPrizePackage(poolId, prizeIndex) → PrizePackage

// User data (UPDATED in v2.1)
getUsersEntries(poolId, user) → uint256
getUserEntriesPage(user, startPoolId, count) → uint256[]  // 🆕 Replaces getUserEntries()
getPendingPrizesCount(user) → uint256  // 🆕 New function
getPendingPrizesPage(user, startIndex, count) → PendingPrize[]  // 🆕 Replaces getPendingPrizes()
getPendingPrize(user, index) → PendingPrize

// Bonus system
calculateBoost(user) → uint32
totalTimeBonuses() → uint256
totalNFTBonusTokens() → uint256

// Admin checks
isAdmin(address) → bool
isPrizeManager(address) → bool

// Storage contract reference (CRITICAL for token approvals)
storageContract() → address
```

**State-Changing Methods:**
```solidity
// Ticket purchase
buyEntry(poolId, ticketCount) payable
buyAndRedeemEntry(poolId, ticketCount) payable → int64[]
buyAndRollEntry(poolId, ticketCount) payable → (uint256, uint256)

// Rolling tickets
rollAll(poolId) → (uint256, uint256)
rollBatch(poolId, numberToRoll) → (uint256, uint256)
rollWithNFT(poolId, serialNumbers) → (uint256, uint256)

// Prize claiming
claimPrize(prizeIndex)
claimAllPrizes()
redeemPrizeToNFT(indices) → int64[]
claimPrizeFromNFT(tokenId, serialNumbers)
```

### Critical Gas Estimation Pattern

**Roll operations have variable gas costs due to PRNG** - use 1.5x multiplier:

```javascript
// ❌ WRONG - May fail if wins occur (needs extra PRNG + prize operations)
const gasEstimate = await estimateGas(contractId, 'rollAll', [poolId]);
await contract.rollAll(poolId, { gasLimit: gasEstimate });

// ✅ CORRECT - 1.5x multiplier accounts for worst-case wins
const gasEstimate = await estimateGas(contractId, 'rollAll', [poolId]);
await contract.rollAll(poolId, { gasLimit: Math.ceil(gasEstimate * 1.5) });
```

**Why 1.5x for Rolls?**
- Base estimate assumes no wins (single PRNG array)
- Actual execution may need:
  - Initial PRNG array for win determination
  - Secondary PRNG array for prize selection
  - Prize package operations (array manipulation)
- 1.5x provides safe buffer without excessive overhead

**Applies to these functions:**
- `rollAll()` - 1.5x multiplier
- `rollBatch()` - 1.5x multiplier  
- `rollWithNFT()` - 1.5x multiplier
- `buyAndRollEntry()` - 1.5x multiplier

**Standard operations** (use estimate directly):
- `buyEntry()` - no multiplier needed
- `claimPrize()` - no multiplier needed
- `buyAndRedeemEntry()` - no multiplier needed

### Mirror Node Balance Verification

**Always verify balances via mirror node for accuracy:**

```javascript
import { checkMirrorBalance, checkMirrorHbarBalance, getSerialsOwned } from './hederaMirrorHelpers';

// Check fungible token balance
const lazyBalance = await checkMirrorBalance(
    env,              // 'testnet' | 'mainnet'
    accountId,        // AccountId or string '0.0.12345'
    tokenId           // TokenId or string '0.0.67890'
);

// Check HBAR balance
const hbarBalance = await checkMirrorHbarBalance(
    env,              // 'testnet' | 'mainnet'  
    accountId         // AccountId or string '0.0.12345'
);

// Get NFT serials owned
const serials = await getSerialsOwned(
    env,              // 'testnet' | 'mainnet'
    accountId,        // AccountId or string '0.0.12345'
    nftTokenId        // TokenId or string '0.0.99999'
);

console.log('User NFT serials:', serials); // [1, 3, 5, 12]
```

**When to use mirror node verification:**
- After token transfers (tickets, prizes)
- Before/after prize claims
- Verifying pool prize balances
- Checking user ticket NFT ownership
- Admin balance checks before withdrawals

**Why mirror node?**
- Independent of contract state
- Real-time network state
- No gas costs for queries
- Reliable for UX confirmation

**Transaction Methods:**
```solidity
// Entry purchase
buyEntry(poolId, ticketCount) payable
buyAndRollEntry(poolId, ticketCount) payable
buyAndRedeemEntry(poolId, ticketCount) payable

// Entry redemption
redeemEntriesToNFT(poolId, ticketCount)

// Rolling
rollAll(poolId)
rollBatch(poolId, numberToRoll)
rollWithNFT(poolId, serialNumbers)

// Prize claiming
claimPrize(pkgIdx)
claimAllPrizes()
claimPrizeFromNFT(tokenId, serialNumbers)

// Prize trading
redeemPrizeToNFT(indices) → int64[]
```

---

## Core User Flows

### 1. Browse Available Lottery Pools

**Objective:** Display all active lottery pools with their details

**Implementation Steps:**

```javascript
// Step 1: Get total number of pools
const totalPools = await contract.totalPools();

// Step 2: Fetch basic info for each pool (v2.1 - using getPoolBasicInfo)
const pools = [];
for (let i = 0; i < totalPools; i++) {
    const poolInfo = await contract.getPoolBasicInfo(i);
    
    // Destructure the returned tuple
    const [
        ticketCID,
        winCID,
        winRateThousandthsOfBps,
        entryFee,
        prizeCount,              // Prize COUNT (not array)
        outstandingEntries,
        poolTokenId,
        paused,
        closed,
        feeToken
    ] = poolInfo;
    
    pools.push({
        id: i,
        ticketCID,
        winCID,
        winRate: winRateThousandthsOfBps,
        entryFee,
        prizeCount,              // Number of prizes
        outstandingEntries,
        poolTokenId,
        paused,
        closed,
        feeToken
    });
}

// Step 3: Filter and display (example: show only open pools)
const activePools = pools.filter(p => !p.closed && !p.paused);
console.log('Active Pools:', activePools);
  const poolDetails = await contract.getPoolDetails(i);
  
  // Check if pool is active (not paused and not closed)
  if (!poolDetails.paused && !poolDetails.closed) {
    pools.push({
      id: i,
      entryFee: poolDetails.entryFee,
      feeToken: poolDetails.feeToken, // 0x000...000 = HBAR
      winRate: poolDetails.winRateThousandthsOfBps,
      totalPrizes: poolDetails.prizes.length,
      poolTokenId: poolDetails.poolTokenId,
      ticketCID: poolDetails.ticketCID,
      winCID: poolDetails.winCID,
    });
  }
}
```

**Display Recommendations:**

```jsx
<PoolCard>
  <PoolTitle>Pool #{poolId}</PoolTitle>
  <EntryFee>
    {feeToken === ZERO_ADDRESS ? 
      `${formatHbar(entryFee)} HBAR` : 
      `${formatTokenAmount(entryFee)} ${getTokenSymbol(feeToken)}`
    }
  </EntryFee>
  <WinRate>
    Win Chance: {formatWinRate(winRate)}%
  </WinRate>
  <PrizeCount>
    {totalPrizes} Prizes Available
  </PrizeCount>
  <ActionButton>Enter Pool</ActionButton>
</PoolCard>
```

**Win Rate Formatting:**
```javascript
function formatWinRate(thousandthsOfBps) {
  // Convert from thousandths of basis points to percentage
  // 100,000,000 = 100%
  // 50,000,000 = 50%
  // 10,000,000 = 10%
  // 1,000,000 = 1%
  return (thousandthsOfBps / 1_000_000).toFixed(2);
}
```

---

### 2. View Pool Prize Details

**Objective:** Show users exactly what prizes they can win

**Implementation Steps:**

```javascript
// Step 1: Get pool details to know total prizes
const poolDetails = await contract.getPoolDetails(poolId);
const totalPrizes = poolDetails.prizes.length;

// Step 2: Fetch each individual prize package
const prizes = [];
for (let i = 0; i < totalPrizes; i++) {
  const prizePackage = await contract.getPrizePackage(poolId, i);
  
  prizes.push({
    index: i,
    token: prizePackage.token,
    amount: prizePackage.amount,
    nftTokens: prizePackage.nftTokens,
    nftSerials: prizePackage.nftSerials,
  });
}
```

**Display Recommendations:**

```jsx
<PrizeList>
  {prizes.map((prize, idx) => (
    <PrizeItem key={idx}>
      {prize.token === ZERO_ADDRESS && prize.amount > 0 && (
        <span>💰 {formatHbar(prize.amount)} HBAR</span>
      )}
      
      {prize.token !== ZERO_ADDRESS && prize.amount > 0 && (
        <span>🪙 {formatTokenAmount(prize.amount)} {getTokenSymbol(prize.token)}</span>
      )}
      
      {prize.nftTokens.length > 0 && (
        prize.nftTokens.map((nftToken, nftIdx) => (
          <div key={nftIdx}>
            🎨 {prize.nftSerials[nftIdx].length} NFT(s) from {truncateAddress(nftToken)}
            <NFTPreview serials={prize.nftSerials[nftIdx]} />
          </div>
        ))
      )}
    </PrizeItem>
  ))}
</PrizeList>
```

**Prize Categorization:**
```javascript
function categorizePrize(prizePackage) {
  const categories = [];
  
  // Fungible tokens
  if (prizePackage.amount > 0) {
    if (prizePackage.token === ZERO_ADDRESS) {
      categories.push({ type: 'HBAR', amount: prizePackage.amount });
    } else {
      categories.push({ 
        type: 'TOKEN', 
        token: prizePackage.token, 
        amount: prizePackage.amount 
      });
    }
  }
  
  // NFTs
  if (prizePackage.nftTokens.length > 0) {
    prizePackage.nftTokens.forEach((token, idx) => {
      categories.push({
        type: 'NFT',
        token: token,
        serials: prizePackage.nftSerials[idx],
      });
    });
  }
  
  return categories;
}
```

---

### 3. Calculate and Display User's Win Boost

**Objective:** Show users their current bonus multiplier

**Implementation Steps:**

```javascript
// Step 1: Calculate user's boost
const boostBps = await contract.calculateBoost(userAddress);

// Step 2: Get base win rate for pool
const poolDetails = await contract.getPoolDetails(poolId);
const baseWinRate = poolDetails.winRateThousandthsOfBps;

// Step 3: Calculate boosted win rate
const boostedWinRate = baseWinRate + boostBps; // boostBps already scaled to 10,000s

// Step 4: Check for maximum cap
const MAX_WIN_RATE = 100_000_000;
const finalWinRate = Math.min(boostedWinRate, MAX_WIN_RATE);
```

**Display Recommendations:**

```jsx
<BoostDisplay>
  <BaseWinRate>
    Base Win Rate: {formatWinRate(baseWinRate)}%
  </BaseWinRate>
  
  {boostBps > 0 && (
    <>
      <BoostAmount positive>
        + {formatBoost(boostBps)}% Boost
      </BoostAmount>
      <FinalWinRate highlighted>
        Your Win Rate: {formatWinRate(finalWinRate)}%
      </FinalWinRate>
    </>
  )}
  
  <BoostBreakdown>
    <BoostExplainer />
  </BoostBreakdown>
</BoostDisplay>
```

**Boost Formatting:**
```javascript
function formatBoost(boostBps) {
  // boostBps is already in ten-thousandths of bps
  // Convert to percentage: divide by 1,000,000
  return (boostBps / 1_000_000).toFixed(2);
}
```

**Boost Breakdown Component:**
```jsx
function BoostExplainer() {
  const [timeBonuses, setTimeBonuses] = useState([]);
  const [nftBonuses, setNftBonuses] = useState([]);
  const [lazyBonus, setLazyBonus] = useState(null);
  
  // Fetch bonus details
  useEffect(() => {
    const fetchBonuses = async () => {
      // Time bonuses
      const totalTime = await contract.totalTimeBonuses();
      for (let i = 0; i < totalTime; i++) {
        const bonus = await contract.timeBonuses(i);
        if (Date.now() / 1000 >= bonus.start && Date.now() / 1000 <= bonus.end) {
          setTimeBonuses(prev => [...prev, bonus]);
        }
      }
      
      // NFT bonuses (check if user holds each)
      const totalNFT = await contract.totalNFTBonusTokens();
      for (let i = 0; i < totalNFT; i++) {
        const token = await contract.nftBonusTokens(i);
        const bps = await contract.nftBonusBps(token);
        const balance = await getNFTBalance(userAddress, token);
        if (balance > 0) {
          setNftBonuses(prev => [...prev, { token, bps }]);
        }
      }
      
      // LAZY balance bonus
      const threshold = await contract.lazyBalanceThreshold();
      const bps = await contract.lazyBalanceBonusBps();
      const balance = await getLazyBalance(userAddress);
      if (balance >= threshold) {
        setLazyBonus({ threshold, bps });
      }
    };
    
    fetchBonuses();
  }, [userAddress]);
  
  return (
    <BonusDetails>
      {timeBonuses.map((bonus, idx) => (
        <BonusItem key={`time-${idx}`}>
          ⏰ Time Bonus: +{formatBoost(bonus.bonusBps)}%
        </BonusItem>
      ))}
      {nftBonuses.map((bonus, idx) => (
        <BonusItem key={`nft-${idx}`}>
          🎨 NFT Bonus: +{formatBoost(bonus.bps)}%
        </BonusItem>
      ))}
      {lazyBonus && (
        <BonusItem>
          🪙 $LAZY Holder Bonus: +{formatBoost(lazyBonus.bps)}%
        </BonusItem>
      )}
    </BonusDetails>
  );
}
```

---

### 4. Purchase Lottery Tickets

**Objective:** Allow users to buy entries and choose ticket format

**Implementation Steps:**

**Option A: Buy and Hold in Memory (Gas Efficient)**
```javascript
async function buyTickets(poolId, ticketCount) {
  const poolDetails = await contract.getPoolDetails(poolId);
  const totalCost = poolDetails.entryFee * BigInt(ticketCount);
  
  if (poolDetails.feeToken === ZERO_ADDRESS) {
    // HBAR payment
    const tx = await contract.buyEntry(poolId, ticketCount, {
      value: totalCost,
      gasLimit: estimateGas(1_000_000, ticketCount),
    });
    await tx.wait();
  } else {
    // Token payment - requires approval to STORAGE CONTRACT
    // Get storage contract address
    const storageAddress = await contract.storageContract();
    
    const tokenContract = new ethers.Contract(poolDetails.feeToken, ERC20_ABI, signer);
    
    // Check allowance to storage contract
    const allowance = await tokenContract.allowance(userAddress, storageAddress);
    if (allowance < totalCost) {
      // Approve storage contract (not LazyLotto!)
      const approveTx = await tokenContract.approve(storageAddress, totalCost);
      await approveTx.wait();
    }
    
    const tx = await contract.buyEntry(poolId, ticketCount, {
      gasLimit: estimateGas(1_000_000, ticketCount),
    });
    await tx.wait();
  }
}
```

**Option B: Buy and Mint as NFTs (Tradeable)**
```javascript
async function buyTicketsAsNFTs(poolId, ticketCount) {
  const poolDetails = await contract.getPoolDetails(poolId);
  const totalCost = poolDetails.entryFee * BigInt(ticketCount);
  
  // Similar payment logic as above...
  
  const tx = await contract.buyAndRedeemEntry(poolId, ticketCount, {
    value: poolDetails.feeToken === ZERO_ADDRESS ? totalCost : 0,
    gasLimit: estimateGas(1_200_000, ticketCount),
  });
  
  const receipt = await tx.wait();
  
  // Extract minted NFT serial numbers from events
  const ticketEvent = receipt.events.find(e => e.event === 'TicketEvent');
  const serialNumbers = ticketEvent.args.serialNumber;
  
  return serialNumbers;
}
```

**Option C: Buy and Roll Immediately (Instant Play)**
```javascript
async function buyAndPlayNow(poolId, ticketCount) {
  const poolDetails = await contract.getPoolDetails(poolId);
  const totalCost = poolDetails.entryFee * BigInt(ticketCount);
  
  const tx = await contract.buyAndRollEntry(poolId, ticketCount, {
    value: poolDetails.feeToken === ZERO_ADDRESS ? totalCost : 0,
    gasLimit: estimateGas(1_500_000, ticketCount),
  });
  
  const receipt = await tx.wait();
  
  // Parse roll events to determine wins
  const rollEvents = receipt.events.filter(e => e.event === 'Rolled');
  const wins = rollEvents.filter(e => e.args.won).length;
  
  return { totalRolls: ticketCount, wins };
}
```

**Display Recommendations:**

```jsx
<PurchaseFlow>
  <TicketCountSelector
    value={ticketCount}
    onChange={setTicketCount}
    max={100}
  />
  
  <TotalCost>
    Total: {formatCost(entryFee * ticketCount, feeToken)}
  </TotalCost>
  
  <PurchaseOptions>
    <OptionButton onClick={() => buyTickets(poolId, ticketCount)}>
      💾 Buy Tickets (Memory)
      <Hint>Gas efficient, roll later</Hint>
    </OptionButton>
    
    <OptionButton onClick={() => buyTicketsAsNFTs(poolId, ticketCount)}>
      🎫 Buy as NFTs
      <Hint>Tradeable, higher gas cost</Hint>
    </OptionButton>
    
    <OptionButton onClick={() => buyAndPlayNow(poolId, ticketCount)}>
      🎲 Buy & Play Now
      <Hint>Instant results</Hint>
    </OptionButton>
  </PurchaseOptions>
</PurchaseFlow>
```

**User Guidance:**
- **Memory Tickets**: Best for users who want to accumulate entries and roll in batches (most gas efficient)
- **NFT Tickets**: Best for traders who want to sell tickets on secondary markets
- **Buy & Roll**: Best for instant gratification players who want immediate results

---

### 5. View User's Ticket Holdings

**Objective:** Show users their current ticket inventory

**Implementation Steps:**

```javascript
async function getUserTickets(userAddress) {
  const totalPools = await contract.totalPools();
  const holdings = [];
  
  for (let poolId = 0; poolId < totalPools; poolId++) {
    // Memory entries
    const memoryEntries = await contract.getUsersEntries(poolId, userAddress);
    
    // NFT tickets
    const poolDetails = await contract.getPoolDetails(poolId);
    const nftBalance = await getNFTBalance(userAddress, poolDetails.poolTokenId);
    
    if (memoryEntries > 0 || nftBalance > 0) {
      holdings.push({
        poolId,
        memoryEntries: Number(memoryEntries),
        nftTickets: nftBalance,
        poolDetails,
      });
    }
  }
  
  return holdings;
}
```

**Display Recommendations:**

```jsx
<TicketInventory>
  <SectionTitle>Your Tickets</SectionTitle>
  
  {holdings.map(holding => (
    <PoolTickets key={holding.poolId}>
      <PoolInfo>Pool #{holding.poolId}</PoolInfo>
      
      {holding.memoryEntries > 0 && (
        <TicketGroup>
          <TicketIcon>💾</TicketIcon>
          <TicketCount>{holding.memoryEntries} Memory Entries</TicketCount>
          <ActionButton onClick={() => rollTickets(holding.poolId, holding.memoryEntries)}>
            Roll All
          </ActionButton>
        </TicketGroup>
      )}
      
      {holding.nftTickets > 0 && (
        <TicketGroup>
          <TicketIcon>🎫</TicketIcon>
          <TicketCount>{holding.nftTickets} NFT Tickets</TicketCount>
          <ActionButton onClick={() => viewNFTTickets(holding.poolTokenId)}>
            View NFTs
          </ActionButton>
        </TicketGroup>
      )}
    </PoolTickets>
  ))}
</TicketInventory>
```

---

### 6. Convert Memory Entries to NFT Tickets

**Objective:** Allow users to convert existing memory entries to tradeable NFT tickets

**Use Cases:**
- User accumulated entries and now wants to trade some on secondary markets
- User wants to gift tickets to friends
- User prefers NFT format for portfolio management
- Strategic timing: convert to NFT when market demand is high

**Implementation Steps:**

```javascript
async function redeemEntriesToNFT(poolId, ticketCount) {
  // Step 1: Verify user has enough memory entries
  const memoryEntries = await contract.getUsersEntries(poolId, userAddress);
  if (memoryEntries < ticketCount) {
    throw new Error(`Not enough entries. You have ${memoryEntries} but tried to redeem ${ticketCount}`);
  }
  
  // Step 2: Get pool details for display
  const poolDetails = await contract.getPoolDetails(poolId);
  
  // Step 3: Estimate gas (NFT minting operations are more expensive)
  const gasEstimate = await contract.estimateGas.redeemEntriesToNFT(poolId, ticketCount);
  const gasLimit = Math.floor(gasEstimate.toNumber() * 1.2); // 20% buffer
  
  // Step 4: Execute redemption
  const tx = await contract.redeemEntriesToNFT(poolId, ticketCount, {
    gasLimit,
  });
  
  const receipt = await tx.wait();
  
  // Step 5: Extract minted NFT serial numbers from events
  const ticketEvents = receipt.events.filter(e => e.event === 'TicketEvent');
  const serialNumbers = ticketEvents.map(event => event.args.serialNumber);
  
  return {
    poolTokenId: poolDetails.poolTokenId,
    serialNumbers,
    ticketCID: poolDetails.ticketCID,
  };
}
```

**Display Recommendations:**

```jsx
<RedemptionFlow>
  <TicketInventory>
    <InventoryItem>
      💾 Memory Entries: {memoryEntries}
      <Hint>Gas efficient, not tradeable</Hint>
    </InventoryItem>
    <InventoryItem>
      🎫 NFT Tickets: {nftTickets}
      <Hint>Tradeable on secondary markets</Hint>
    </InventoryItem>
  </TicketInventory>
  
  <ConversionSection>
    <SectionTitle>Convert to NFT Tickets</SectionTitle>
    <Description>
      Convert your memory entries to tradeable NFT tickets. 
      This operation uses more gas but gives you ownership flexibility.
    </Description>
    
    <QuantitySelector>
      <Label>How many to convert?</Label>
      <Input
        type="number"
        min={1}
        max={memoryEntries}
        value={convertCount}
        onChange={(e) => setConvertCount(Math.min(e.target.value, memoryEntries))}
      />
      <QuickSelect>
        <Button onClick={() => setConvertCount(memoryEntries)}>All</Button>
        <Button onClick={() => setConvertCount(Math.floor(memoryEntries / 2))}>Half</Button>
      </QuickSelect>
    </QuantitySelector>
    
    <GasEstimate>
      Estimated gas: ~{formatGas(estimatedGas)}
    </GasEstimate>
    
    <ConvertButton 
      onClick={() => redeemEntriesToNFT(poolId, convertCount)}
      disabled={convertCount === 0 || convertCount > memoryEntries}
    >
      Convert {convertCount} to NFT Tickets
    </ConvertButton>
  </ConversionSection>
</RedemptionFlow>
```

**Success Feedback:**

```jsx
<ConversionSuccess>
  <SuccessIcon>🎨</SuccessIcon>
  <SuccessMessage>
    Successfully converted {serialNumbers.length} entries to NFT tickets!
  </SuccessMessage>
  
  <MintedNFTs>
    <NFTGrid>
      {serialNumbers.map(serial => (
        <NFTCard key={serial}>
          <NFTImage src={`ipfs://${ticketCID}`} />
          <NFTSerial>#{serial}</NFTSerial>
          <NFTActions>
            <ViewButton href={`https://hashscan.io/token/${poolTokenId}/${serial}`}>
              View on HashScan
            </ViewButton>
          </NFTActions>
        </NFTCard>
      ))}
    </NFTGrid>
  </MintedNFTs>
  
  <NextSteps>
    <h4>What you can do now:</h4>
    <StepsList>
      <Step>🎲 Roll your NFT tickets with rollWithNFT()</Step>
      <Step>💱 Trade them on secondary marketplaces</Step>
      <Step>🎁 Transfer them to friends</Step>
      <Step>📦 Hold them for later use</Step>
    </StepsList>
  </NextSteps>
</ConversionSuccess>
```

**User Guidance Messages:**

```javascript
// Before conversion
const guidance = {
  title: "Should you convert to NFT?",
  considerations: [
    {
      pro: "✅ Can trade on secondary markets",
      con: "❌ Higher gas cost for conversion and rolling",
    },
    {
      pro: "✅ Can gift or transfer to others",
      con: "❌ Must approve NFT contract before rolling",
    },
    {
      pro: "✅ Shows in your NFT wallet",
      con: "❌ Can't convert back to memory format",
    },
  ],
  recommendation: "Convert when you want trading flexibility. Keep as memory for gas efficiency.",
};
```

**Error Handling:**

```javascript
try {
  await redeemEntriesToNFT(poolId, ticketCount);
} catch (error) {
  // Handle specific errors
  if (error.message.includes('NotEnoughTickets')) {
    showError('You don\'t have enough memory entries to convert.');
  } else if (error.message.includes('BadParameters')) {
    showError('Invalid conversion quantity. Must be greater than zero.');
  } else if (error.message.includes('PoolIsClosed')) {
    showError('This pool is closed and no longer accepting operations.');
  } else if (error.message.includes('ContractPaused')) {
    showError('The lottery is temporarily paused. Please try again later.');
  } else {
    showError(`Conversion failed: ${error.message}`);
  }
}
```

**Gas Optimization Tips for Users:**

```jsx
<GasOptimizationTips>
  <Tip>
    💡 <strong>Batch conversions:</strong> Converting multiple entries at once 
    is more gas-efficient than multiple small conversions.
  </Tip>
  <Tip>
    💡 <strong>Plan ahead:</strong> If you plan to trade tickets, buy directly 
    as NFTs with buyAndRedeemEntry() to avoid double conversion costs.
  </Tip>
  <Tip>
    💡 <strong>Keep some in memory:</strong> If rolling yourself, memory entries 
    use ~30% less gas than NFT tickets.
  </Tip>
</GasOptimizationTips>
```

**Integration with Existing Purchase Flow:**

Update the purchase flow (Section 4) to mention this option:

```jsx
<PurchaseFlow>
  {/* Existing purchase options */}
  
  <InfoBox>
    <InfoIcon>ℹ️</InfoIcon>
    <InfoText>
      Not sure which format? Buy as memory entries (cheapest) and convert 
      to NFTs later if needed using <Code>redeemEntriesToNFT()</Code>.
    </InfoText>
  </InfoBox>
</PurchaseFlow>
```

---

### 7. Roll Tickets and See Results

**Objective:** Execute lottery rolls and display outcomes

**Implementation Steps:**

**Rolling Memory Entries:**
```javascript
async function rollMemoryTickets(poolId, count) {
  // Option 1: Roll all tickets
  const rollAllTx = await contract.rollAll(poolId, {
    gasLimit: estimateGas(1_500_000, count),
  });
  
  // Option 2: Roll specific batch
  const rollBatchTx = await contract.rollBatch(poolId, count, {
    gasLimit: estimateGas(1_500_000, count),
  });
  
  const receipt = await rollAllTx.wait();
  
  // Parse events
  const rollEvents = receipt.events.filter(e => e.event === 'Rolled');
  const results = rollEvents.map(event => ({
    won: event.args.won,
    rollValue: Number(event.args.rollBps),
  }));
  
  const wins = results.filter(r => r.won).length;
  const losses = results.filter(r => !r.won).length;
  
  return { wins, losses, results };
}
```

**Rolling NFT Tickets:**
```javascript
async function rollNFTTickets(poolId, serialNumbers) {
  const tx = await contract.rollWithNFT(poolId, serialNumbers, {
    gasLimit: estimateGas(1_500_000, serialNumbers.length),
  });
  
  const receipt = await tx.wait();
  
  // NFTs are burned on roll, parse results
  const rollEvents = receipt.events.filter(e => e.event === 'Rolled');
  const results = rollEvents.map(event => ({
    won: event.args.won,
    rollValue: Number(event.args.rollBps),
  }));
  
  return { results };
}
```

**Display Recommendations:**

```jsx
<RollingResults>
  <ResultsSummary>
    <WinCount highlight>{wins} Wins</WinCount>
    <LossCount>{losses} Losses</LossCount>
  </ResultsSummary>
  
  <ResultsBreakdown>
    {results.map((result, idx) => (
      <ResultItem key={idx} won={result.won}>
        {result.won ? '🎉 WIN' : '❌ LOSS'}
        <RollValue>
          Roll: {formatWinRate(result.rollValue)}%
        </RollValue>
      </ResultItem>
    ))}
  </ResultsBreakdown>
  
  {wins > 0 && (
    <NextStepCTA>
      View your prizes and claim them!
      <Link to="/prizes">Go to Prizes</Link>
    </NextStepCTA>
  )}
</RollingResults>
```

**Animated Rolling Experience:**
```jsx
function AnimatedRoll({ onComplete }) {
  const [rolling, setRolling] = useState(true);
  const [currentRoll, setCurrentRoll] = useState(0);
  
  useEffect(() => {
    if (rolling) {
      // Animate through random numbers
      const interval = setInterval(() => {
        setCurrentRoll(Math.floor(Math.random() * 100_000_000));
      }, 50);
      
      // Stop after transaction completes
      setTimeout(() => {
        clearInterval(interval);
        setRolling(false);
        onComplete();
      }, 3000);
      
      return () => clearInterval(interval);
    }
  }, [rolling]);
  
  return (
    <RollingAnimation>
      <SlotMachine>{formatWinRate(currentRoll)}%</SlotMachine>
      {rolling && <Spinner />}
    </RollingAnimation>
  );
}
```

---

### 8. View and Inspect Won Prizes

**Objective:** Show users their pending prizes with full details

**Implementation Steps:**

```javascript
async function getUserPendingPrizes(userAddress) {
  // Get all pending prizes
  const pendingPrizes = await contract.getPendingPrizes(userAddress);
  
  // Enrich with detailed prize package information
  const enrichedPrizes = await Promise.all(
    pendingPrizes.map(async (pending, idx) => {
      const poolId = pending.poolId;
      
      // Get detailed prize package (this is the NEW getter!)
      // Note: We get the prize from the pending object directly
      // But if we need to cross-reference or verify, we could use:
      // const prizePackage = await contract.getPrizePackage(poolId, prizeIndex);
      
      const prize = pending.prize;
      
      return {
        index: idx,
        poolId,
        asNFT: pending.asNFT,
        prize: {
          token: prize.token,
          amount: prize.amount,
          nftTokens: prize.nftTokens,
          nftSerials: prize.nftSerials,
        },
        displayInfo: formatPrizeDisplay(prize),
      };
    })
  );
  
  return enrichedPrizes;
}

function formatPrizeDisplay(prize) {
  const items = [];
  
  // Fungible prizes
  if (prize.amount > 0) {
    if (prize.token === ZERO_ADDRESS) {
      items.push(`${formatHbar(prize.amount)} HBAR`);
    } else {
      items.push(`${formatTokenAmount(prize.amount)} ${getTokenSymbol(prize.token)}`);
    }
  }
  
  // NFT prizes
  if (prize.nftTokens.length > 0) {
    prize.nftTokens.forEach((token, idx) => {
      const serialCount = prize.nftSerials[idx].length;
      items.push(`${serialCount} NFT(s) from ${truncateAddress(token)}`);
    });
  }
  
  return items.join(' + ');
}
```

**Display Recommendations:**

```jsx
<PendingPrizes>
  <SectionTitle>Your Prizes ({prizes.length})</SectionTitle>
  
  <PrizeGrid>
    {prizes.map(prizeData => (
      <PrizeCard key={prizeData.index}>
        <PrizeHeader>
          Prize #{prizeData.index + 1}
          <PoolBadge>Pool {prizeData.poolId}</PoolBadge>
        </PrizeHeader>
        
        <PrizeDetails>
          {prizeData.displayInfo}
        </PrizeDetails>
        
        <PrizeBreakdown>
          {prizeData.prize.amount > 0 && (
            <FungiblePrize>
              💰 {formatPrize(prizeData.prize.token, prizeData.prize.amount)}
            </FungiblePrize>
          )}
          
          {prizeData.prize.nftTokens.map((nftToken, nftIdx) => (
            <NFTPrize key={nftIdx}>
              🎨 {prizeData.prize.nftSerials[nftIdx].length} NFT(s)
              <NFTCollection>{truncateAddress(nftToken)}</NFTCollection>
              <NFTSerials>
                Serials: {prizeData.prize.nftSerials[nftIdx].join(', ')}
              </NFTSerials>
            </NFTPrize>
          ))}
        </PrizeBreakdown>
        
        <PrizeActions>
          <ActionButton primary onClick={() => claimPrize(prizeData.index)}>
            Claim Prize
          </ActionButton>
          
          {!prizeData.asNFT && (
            <ActionButton secondary onClick={() => convertToNFT(prizeData.index)}>
              Convert to NFT (Trade)
            </ActionButton>
          )}
        </PrizeActions>
      </PrizeCard>
    ))}
  </PrizeGrid>
  
  {prizes.length > 1 && (
    <BulkActions>
      <ActionButton onClick={claimAllPrizes}>
        Claim All Prizes
      </ActionButton>
    </BulkActions>
  )}
</PendingPrizes>
```

**Prize Preview Component:**
```jsx
function PrizePreview({ prize }) {
  return (
    <PreviewContainer>
      {/* Visual representation of prize contents */}
      <PreviewIcons>
        {prize.amount > 0 && (
          prize.token === ZERO_ADDRESS ? 
            <HbarIcon size="large" /> : 
            <TokenIcon address={prize.token} />
        )}
        
        {prize.nftTokens.map((token, idx) => (
          <NFTPreviewGrid key={idx}>
            {prize.nftSerials[idx].map(serial => (
              <NFTThumbnail
                key={serial}
                token={token}
                serial={serial}
              />
            ))}
          </NFTPreviewGrid>
        ))}
      </PreviewIcons>
      
      <PreviewValue>
        Estimated Value: {calculatePrizeValue(prize)}
      </PreviewValue>
    </PreviewContainer>
  );
}
```

---

### 8. Claim Prizes

**Objective:** Allow users to receive their won prizes

**Implementation Steps:**

**Claim Single Prize:**
```javascript
async function claimPrize(prizeIndex) {
  const tx = await contract.claimPrize(prizeIndex, {
    gasLimit: 1_000_000,
  });
  
  const receipt = await tx.wait();
  
  // Parse PrizeClaimed event
  const claimEvent = receipt.events.find(e => e.event === 'PrizeClaimed');
  const claimedPrize = claimEvent.args.prize;
  
  return claimedPrize;
}
```

**Claim All Prizes:**
```javascript
async function claimAllPrizes() {
  const pendingCount = await contract.getPendingPrizes(userAddress).length;
  
  const tx = await contract.claimAllPrizes({
    gasLimit: estimateGas(1_000_000, pendingCount),
  });
  
  const receipt = await tx.wait();
  
  // Parse all PrizeClaimed events
  const claimEvents = receipt.events.filter(e => e.event === 'PrizeClaimed');
  const claimedPrizes = claimEvents.map(e => e.args.prize);
  
  return claimedPrizes;
}
```

**Display Recommendations:**

```jsx
<ClaimingFlow>
  <ConfirmationDialog>
    <DialogTitle>Confirm Prize Claim</DialogTitle>
    
    <PrizePreview prize={selectedPrize} />
    
    <ClaimDetails>
      <DetailRow>
        <Label>Gas Estimate:</Label>
        <Value>{estimatedGas} gas</Value>
      </DetailRow>
      
      <DetailRow>
        <Label>You will receive:</Label>
        <PrizeBreakdown prize={selectedPrize} />
      </DetailRow>
    </ClaimDetails>
    
    <ActionButtons>
      <Button onClick={confirmClaim}>Confirm Claim</Button>
      <Button variant="secondary" onClick={cancel}>Cancel</Button>
    </ActionButtons>
  </ConfirmationDialog>
</ClaimingFlow>
```

**Success Animation:**
```jsx
function ClaimSuccessAnimation({ prize }) {
  return (
    <SuccessScreen>
      <Confetti />
      <SuccessIcon>🎉</SuccessIcon>
      <SuccessMessage>Prize Claimed!</SuccessMessage>
      
      <ClaimedItems>
        {prize.amount > 0 && (
          <ClaimedItem>
            ✅ {formatPrize(prize.token, prize.amount)} added to your wallet
          </ClaimedItem>
        )}
        
        {prize.nftTokens.map((token, idx) => (
          <ClaimedItem key={idx}>
            ✅ {prize.nftSerials[idx].length} NFT(s) transferred
          </ClaimedItem>
        ))}
      </ClaimedItems>
      
      <ActionButton onClick={viewWallet}>View in Wallet</ActionButton>
    </SuccessScreen>
  );
}
```

---

### 9. Convert Prizes to NFTs for Trading

**Objective:** Allow users to trade won prizes on secondary markets

**Implementation Steps:**

```javascript
async function convertPrizesToNFTs(prizeIndices) {
  const tx = await contract.redeemPrizeToNFT(prizeIndices, {
    gasLimit: estimateGas(1_200_000, prizeIndices.length),
  });
  
  const receipt = await tx.wait();
  
  // Extract minted NFT serial numbers
  const ticketEvent = receipt.events.find(e => e.event === 'TicketEvent' && e.args.mint);
  const serialNumbers = ticketEvent.args.serialNumber;
  const tokenId = ticketEvent.args.tokenId;
  
  return { tokenId, serialNumbers };
}
```

**Display Recommendations:**

```jsx
<ConversionFlow>
  <SectionTitle>Convert Prizes to Tradeable NFTs</SectionTitle>
  
  <InfoBox>
    <InfoIcon>ℹ️</InfoIcon>
    <InfoText>
      Converting prizes to NFTs allows you to trade them on secondary markets.
      The NFT represents your prize claim rights.
    </InfoText>
  </InfoBox>
  
  <PrizeSelection>
    {pendingPrizes.map((prize, idx) => (
      <SelectablePrize
        key={idx}
        selected={selectedIndices.includes(idx)}
        onClick={() => toggleSelection(idx)}
      >
        <Checkbox checked={selectedIndices.includes(idx)} />
        <PrizePreview prize={prize} />
      </SelectablePrize>
    ))}
  </PrizeSelection>
  
  <ConversionActions>
    <Button
      disabled={selectedIndices.length === 0}
      onClick={() => convertPrizesToNFTs(selectedIndices)}
    >
      Convert {selectedIndices.length} Prize(s) to NFT
    </Button>
  </ConversionActions>
</ConversionFlow>
```

**Post-Conversion Display:**
```jsx
<ConversionSuccess>
  <SuccessMessage>Prizes Converted Successfully!</SuccessMessage>
  
  <NFTVouchers>
    {serialNumbers.map(serial => (
      <NFTVoucherCard key={serial}>
        <NFTImage tokenId={tokenId} serial={serial} />
        <NFTDetails>
          <TokenID>{tokenId}</TokenID>
          <Serial>Serial #{serial}</Serial>
        </NFTDetails>
        <TradeActions>
          <Button onClick={() => listOnMarketplace(tokenId, serial)}>
            List on Marketplace
          </Button>
          <Button variant="secondary" onClick={() => viewNFT(tokenId, serial)}>
            View NFT
          </Button>
        </TradeActions>
      </NFTVoucherCard>
    ))}
  </NFTVouchers>
</ConversionSuccess>
```

---

## Data Fetching Patterns

### Polling vs. Event Listening

**Polling Pattern (Simple):**
```javascript
function useLottoData(poolId, userAddress) {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    const fetchData = async () => {
      const poolDetails = await contract.getPoolDetails(poolId);
      const userEntries = await contract.getUsersEntries(poolId, userAddress);
      const pendingPrizes = await contract.getPendingPrizes(userAddress);
      
      setData({ poolDetails, userEntries, pendingPrizes });
    };
    
    fetchData();
    
    // Poll every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [poolId, userAddress]);
  
  return data;
}
```

**Event Listening Pattern (Efficient):**
```javascript
function useRealtimeLottoUpdates(userAddress) {
  const [updates, setUpdates] = useState([]);
  
  useEffect(() => {
    // Listen for user-specific events
    const entryFilter = contract.filters.EntryPurchased(userAddress);
    const rollFilter = contract.filters.Rolled(userAddress);
    const claimFilter = contract.filters.PrizeClaimed(userAddress);
    
    const handleEntry = (user, poolId, count, event) => {
      setUpdates(prev => [...prev, {
        type: 'ENTRY_PURCHASED',
        poolId: Number(poolId),
        count: Number(count),
        timestamp: Date.now(),
      }]);
    };
    
    const handleRoll = (user, poolId, won, rollBps, event) => {
      setUpdates(prev => [...prev, {
        type: 'ROLLED',
        poolId: Number(poolId),
        won,
        rollValue: Number(rollBps),
        timestamp: Date.now(),
      }]);
    };
    
    const handleClaim = (user, prize, event) => {
      setUpdates(prev => [...prev, {
        type: 'PRIZE_CLAIMED',
        prize,
        timestamp: Date.now(),
      }]);
    };
    
    contract.on(entryFilter, handleEntry);
    contract.on(rollFilter, handleRoll);
    contract.on(claimFilter, handleClaim);
    
    return () => {
      contract.off(entryFilter, handleEntry);
      contract.off(rollFilter, handleRoll);
      contract.off(claimFilter, handleClaim);
    };
  }, [userAddress]);
  
  return updates;
}
```

### Batch Data Fetching

```javascript
async function fetchAllUserData(userAddress) {
  // Batch multiple calls efficiently
  const [
    totalPools,
    pendingPrizes,
    currentBoost,
  ] = await Promise.all([
    contract.totalPools(),
    contract.getPendingPrizes(userAddress),
    contract.calculateBoost(userAddress),
  ]);
  
  // Fetch pool-specific data
  const poolPromises = [];
  for (let i = 0; i < totalPools; i++) {
    poolPromises.push(
      Promise.all([
        contract.getPoolDetails(i),
        contract.getUsersEntries(i, userAddress),
      ])
    );
  }
  
  const poolData = await Promise.all(poolPromises);
  
  return {
    totalPools,
    pendingPrizes,
    currentBoost,
    pools: poolData.map(([details, entries], idx) => ({
      id: idx,
      details,
      userEntries: Number(entries),
    })),
  };
}
```

---

## Display Components

### Prize Package Display Component

```jsx
function PrizePackageDisplay({ poolId, prizeIndex }) {
  const [prizePackage, setPrizePackage] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function fetchPrize() {
      try {
        const prize = await contract.getPrizePackage(poolId, prizeIndex);
        setPrizePackage(prize);
      } catch (error) {
        console.error('Failed to fetch prize package:', error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchPrize();
  }, [poolId, prizeIndex]);
  
  if (loading) return <LoadingSpinner />;
  if (!prizePackage) return <ErrorMessage>Prize not found</ErrorMessage>;
  
  return (
    <PrizeCard>
      {/* Fungible Token Display */}
      {prizePackage.amount > 0 && (
        <FungibleSection>
          <TokenIcon address={prizePackage.token} />
          <Amount>
            {prizePackage.token === ZERO_ADDRESS ? 
              formatHbar(prizePackage.amount) : 
              formatTokenAmount(prizePackage.amount, prizePackage.token)
            }
          </Amount>
          <TokenSymbol>
            {getTokenSymbol(prizePackage.token)}
          </TokenSymbol>
        </FungibleSection>
      )}
      
      {/* NFT Display */}
      {prizePackage.nftTokens.length > 0 && (
        <NFTSection>
          {prizePackage.nftTokens.map((token, idx) => (
            <NFTCollection key={idx}>
              <CollectionHeader>
                <CollectionName>{getCollectionName(token)}</CollectionName>
                <SerialCount>
                  {prizePackage.nftSerials[idx].length} NFT(s)
                </SerialCount>
              </CollectionHeader>
              
              <SerialGrid>
                {prizePackage.nftSerials[idx].map(serial => (
                  <NFTPreview
                    key={serial}
                    token={token}
                    serial={serial}
                  />
                ))}
              </SerialGrid>
            </NFTCollection>
          ))}
        </NFTSection>
      )}
    </PrizeCard>
  );
}
```

### Win Rate Calculator Widget

```jsx
function WinRateCalculator({ poolId, userAddress }) {
  const [poolDetails, setPoolDetails] = useState(null);
  const [userBoost, setUserBoost] = useState(0);
  
  useEffect(() => {
    async function fetchData() {
      const details = await contract.getPoolDetails(poolId);
      const boost = await contract.calculateBoost(userAddress);
      
      setPoolDetails(details);
      setUserBoost(Number(boost));
    }
    
    fetchData();
  }, [poolId, userAddress]);
  
  if (!poolDetails) return null;
  
  const baseWinRate = Number(poolDetails.winRateThousandthsOfBps);
  const boostedRate = baseWinRate + userBoost;
  const finalRate = Math.min(boostedRate, 100_000_000);
  
  return (
    <WinRateWidget>
      <BaseRate>
        <Label>Base Win Rate:</Label>
        <Value>{formatWinRate(baseWinRate)}%</Value>
      </BaseRate>
      
      {userBoost > 0 && (
        <>
          <BoostDisplay>
            <Label>Your Boost:</Label>
            <Value positive>+{formatBoost(userBoost)}%</Value>
          </BoostDisplay>
          
          <Divider />
          
          <FinalRate highlighted>
            <Label>Your Win Rate:</Label>
            <Value large>{formatWinRate(finalRate)}%</Value>
          </FinalRate>
        </>
      )}
      
      <WinProbability>
        <Progressbar value={finalRate / 1_000_000} max={100} />
        <Hint>
          You have a {formatWinRate(finalRate)}% chance to win each roll
        </Hint>
      </WinProbability>
    </WinRateWidget>
  );
}
```

---

## Transaction Workflows

### Complete Purchase Flow with Error Handling

```javascript
async function completePurchaseFlow(poolId, ticketCount, purchaseType) {
  const steps = [
    { name: 'Validating pool', action: validatePool },
    { name: 'Checking balance', action: checkBalance },
    { name: 'Approving tokens', action: approveIfNeeded },
    { name: 'Purchasing tickets', action: executePurchase },
    { name: 'Confirming transaction', action: waitForConfirmation },
  ];
  
  let currentStep = 0;
  
  try {
    // Step 1: Validate pool
    updateProgress(currentStep++, 'Validating pool...');
    const poolDetails = await contract.getPoolDetails(poolId);
    
    if (poolDetails.paused) {
      throw new Error('Pool is currently paused');
    }
    if (poolDetails.closed) {
      throw new Error('Pool is closed');
    }
    
    // Step 2: Check balance
    updateProgress(currentStep++, 'Checking balance...');
    const totalCost = poolDetails.entryFee * BigInt(ticketCount);
    
    if (poolDetails.feeToken === ZERO_ADDRESS) {
      const hbarBalance = // get from the mirror node
      if (hbarBalance < totalCost) {
        throw new Error(`Insufficient HBAR. Need ${formatHbar(totalCost)}`);
      }
    } else {
      const tokenBalance = // from the mirror node
      if (tokenBalance < totalCost) {
        throw new Error(`Insufficient tokens. Need ${formatTokenAmount(totalCost)}`);
      }
    }
    
    // Step 3: Approve tokens if needed
    if (poolDetails.feeToken !== ZERO_ADDRESS) {
      updateProgress(currentStep++, 'Approving token spend...');
      
      // Get storage contract address
      const storageAddress = await contract.storageContract();
      
      const tokenContract = new ethers.Contract(
        poolDetails.feeToken,
        ERC20_ABI,
        signer
      );
      
      // Check allowance to storage contract
      const allowance = await tokenContract.allowance(userAddress, storageAddress);
      
      if (allowance < totalCost) {
        // Approve storage contract (not LazyLotto!)
        const approveTx = await tokenContract.approve(storageAddress, totalCost);
        await approveTx.wait();
      }
    } else {
      currentStep++; // Skip approval step for HBAR
    }
    
    // Step 4: Execute purchase
    updateProgress(currentStep++, 'Purchasing tickets...');
    
    let tx;
    const gasLimit = estimateGas(
      purchaseType === 'memory' ? 1_000_000 : 
      purchaseType === 'nft' ? 1_200_000 : 
      1_500_000,
      ticketCount
    );
    
    if (purchaseType === 'memory') {
      tx = await contract.buyEntry(poolId, ticketCount, {
        value: poolDetails.feeToken === ZERO_ADDRESS ? totalCost : 0,
        gasLimit,
      });
    } else if (purchaseType === 'nft') {
      tx = await contract.buyAndRedeemEntry(poolId, ticketCount, {
        value: poolDetails.feeToken === ZERO_ADDRESS ? totalCost : 0,
        gasLimit,
      });
    } else if (purchaseType === 'instant') {
      tx = await contract.buyAndRollEntry(poolId, ticketCount, {
        value: poolDetails.feeToken === ZERO_ADDRESS ? totalCost : 0,
        gasLimit,
      });
    }
    
    // Step 5: Wait for confirmation
    updateProgress(currentStep++, 'Confirming transaction...');
    const receipt = await tx.wait();
    
    // Parse results
    const result = parseTransactionResults(receipt, purchaseType);
    
    updateProgress(currentStep, 'Complete!');
    
    return {
      success: true,
      receipt,
      result,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      step: steps[currentStep - 1]?.name || 'Unknown',
    };
  }
}
```

### Transaction Progress Display

```jsx
function TransactionProgress({ steps, currentStep, error }) {
  return (
    <ProgressContainer>
      <ProgressHeader>
        {error ? (
          <ErrorIcon>❌</ErrorIcon>
        ) : currentStep === steps.length ? (
          <SuccessIcon>✅</SuccessIcon>
        ) : (
          <LoadingIcon>⏳</LoadingIcon>
        )}
        
        <ProgressTitle>
          {error ? 'Transaction Failed' : 
           currentStep === steps.length ? 'Transaction Complete' : 
           'Processing Transaction'}
        </ProgressTitle>
      </ProgressHeader>
      
      <StepsList>
        {steps.map((step, idx) => (
          <Step
            key={idx}
            completed={idx < currentStep}
            active={idx === currentStep}
            failed={error && idx === currentStep}
          >
            <StepIcon>
              {idx < currentStep ? '✅' : 
               idx === currentStep && error ? '❌' : 
               idx === currentStep ? '⏳' : '⭕'}
            </StepIcon>
            <StepName>{step.name}</StepName>
          </Step>
        ))}
      </StepsList>
      
      {error && (
        <ErrorMessage>
          <ErrorText>{error}</ErrorText>
          <RetryButton onClick={retry}>Retry</RetryButton>
        </ErrorMessage>
      )}
    </ProgressContainer>
  );
}
```

---

## Error Handling

### Common Error Scenarios

```javascript
function handleContractError(error) {
  // Parse revert reasons
  if (error.message.includes('LottoPoolNotFound')) {
    return {
      title: 'Pool Not Found',
      message: 'The requested lottery pool does not exist.',
      action: 'Return to pool selection',
    };
  }
  
  if (error.message.includes('PoolIsClosed')) {
    return {
      title: 'Pool Closed',
      message: 'This lottery pool is no longer accepting entries.',
      action: 'Browse other active pools',
    };
  }
  
  if (error.message.includes('PoolOnPause')) {
    return {
      title: 'Pool Paused',
      message: 'This pool is temporarily paused. Try again later.',
      action: 'Check back soon',
    };
  }
  
  if (error.message.includes('NotEnoughHbar')) {
    return {
      title: 'Insufficient HBAR',
      message: 'You don\'t have enough HBAR to purchase tickets.',
      action: 'Add HBAR to your wallet',
    };
  }
  
  if (error.message.includes('NotEnoughTickets')) {
    return {
      title: 'Insufficient Tickets',
      message: 'You don\'t have enough tickets to perform this action.',
      action: 'Purchase more tickets',
    };
  }
  
  if (error.message.includes('NoPendingPrizes')) {
    return {
      title: 'No Prizes Available',
      message: 'You don\'t have any prizes to claim.',
      action: 'Play more rounds to win prizes',
    };
  }
  
  if (error.message.includes('NoPrizesAvailable')) {
    return {
      title: 'Prize Pool Empty',
      message: 'This pool has no prizes left.',
      action: 'Wait for pool to be refilled',
    };
  }
  
  // Generic error
  return {
    title: 'Transaction Failed',
    message: error.message || 'An unexpected error occurred.',
    action: 'Try again',
  };
}
```

### Error Display Component

```jsx
function ErrorDisplay({ error, onRetry, onDismiss }) {
  const errorInfo = handleContractError(error);
  
  return (
    <ErrorContainer>
      <ErrorIcon>⚠️</ErrorIcon>
      <ErrorTitle>{errorInfo.title}</ErrorTitle>
      <ErrorMessage>{errorInfo.message}</ErrorMessage>
      
      <ErrorActions>
        {onRetry && (
          <Button onClick={onRetry}>
            Retry
          </Button>
        )}
        <Button variant="secondary" onClick={onDismiss}>
          {errorInfo.action}
        </Button>
      </ErrorActions>
    </ErrorContainer>
  );
}
```

---

## Real-Time Updates

### Live Prize Pool Updates

```javascript
function useLivePrizePoolUpdates(poolId) {
  const [prizeCount, setPrizeCount] = useState(0);
  
  useEffect(() => {
    // Initial fetch
    const fetchPrizeCount = async () => {
      const poolDetails = await contract.getPoolDetails(poolId);
      setPrizeCount(poolDetails.prizes.length);
    };
    
    fetchPrizeCount();
    
    // Listen for prize additions/removals
    const filter = contract.filters.PoolCreated(); // Adjust to appropriate events
    
    contract.on(filter, () => {
      fetchPrizeCount();
    });
    
    return () => {
      contract.off(filter);
    };
  }, [poolId]);
  
  return prizeCount;
}
```

### Live User Ticket Count

```javascript
function useLiveTicketCount(poolId, userAddress) {
  const [memoryEntries, setMemoryEntries] = useState(0);
  const [nftTickets, setNftTickets] = useState(0);
  
  useEffect(() => {
    const updateCounts = async () => {
      const entries = await contract.getUsersEntries(poolId, userAddress);
      setMemoryEntries(Number(entries));
      
      const poolDetails = await contract.getPoolDetails(poolId);
      const nftBalance = await getNFTBalance(userAddress, poolDetails.poolTokenId);
      setNftTickets(nftBalance);
    };
    
    updateCounts();
    
    // Listen for entry purchases and rolls
    const entryFilter = contract.filters.EntryPurchased(userAddress, poolId);
    const rollFilter = contract.filters.Rolled(userAddress, poolId);
    
    contract.on(entryFilter, updateCounts);
    contract.on(rollFilter, updateCounts);
    
    return () => {
      contract.off(entryFilter, updateCounts);
      contract.off(rollFilter, updateCounts);
    };
  }, [poolId, userAddress]);
  
  return { memoryEntries, nftTickets };
}
```

---

## Best Practices

### 1. Gas Estimation

Always estimate gas before transactions:

```javascript
function estimateGas(baseGas, multiplier = 1) {
  // Add 20% buffer for safety
  return Math.floor(baseGas * multiplier * 1.2);
}

// Usage examples:
// Simple operations: estimateGas(300_000)
// Medium operations: estimateGas(800_000)
// Complex operations with batch: estimateGas(1_500_000, batchSize)
```

### 2. User Feedback

Provide clear feedback at every step:

```jsx
function TransactionFeedback({ status, message }) {
  const icons = {
    pending: '⏳',
    success: '✅',
    error: '❌',
    warning: '⚠️',
  };
  
  return (
    <FeedbackBanner type={status}>
      <Icon>{icons[status]}</Icon>
      <Message>{message}</Message>
    </FeedbackBanner>
  );
}
```

### 3. Caching Strategy

Cache frequently accessed data:

```javascript
const prizeCache = new Map();

async function getPrizePackageWithCache(poolId, prizeIndex) {
  const cacheKey = `${poolId}-${prizeIndex}`;
  
  if (prizeCache.has(cacheKey)) {
    return prizeCache.get(cacheKey);
  }
  
  const prizePackage = await contract.getPrizePackage(poolId, prizeIndex);
  prizeCache.set(cacheKey, prizePackage);
  
  // Cache expires after 5 minutes
  setTimeout(() => {
    prizeCache.delete(cacheKey);
  }, 5 * 60 * 1000);
  
  return prizePackage;
}
```

### 4. Mobile Responsiveness

Optimize for mobile users:

```jsx
function MobileOptimizedPrizeCard({ prize }) {
  return (
    <ResponsiveCard>
      {/* Stack vertically on mobile */}
      <MobileStack>
        <PrizeIcon large />
        <PrizeAmount>{formatPrize(prize)}</PrizeAmount>
        <ActionButton fullWidth>Claim</ActionButton>
      </MobileStack>
    </ResponsiveCard>
  );
}
```

### 5. Accessibility

Ensure accessibility for all users:

```jsx
<Button
  onClick={claimPrize}
  aria-label="Claim prize package containing 100 HBAR"
  disabled={claiming}
>
  {claiming ? (
    <>
      <Spinner aria-hidden="true" />
      <span>Claiming...</span>
    </>
  ) : (
    'Claim Prize'
  )}
</Button>
```

### 6. Loading States

Always show loading states:

```jsx
function PrizeDisplay({ prizeIndex }) {
  const { data: prize, loading, error } = usePrizePackage(poolId, prizeIndex);
  
  if (loading) {
    return <SkeletonLoader />;
  }
  
  if (error) {
    return <ErrorDisplay error={error} />;
  }
  
  return <PrizeCard prize={prize} />;
}
```

### 7. Split-Contract Architecture Best Practices

**Critical Understanding for Developers:**

The LazyLotto system uses a split-contract architecture where:
- **LazyLotto** = Public-facing contract (all user/admin interactions)
- **LazyLottoStorage** = Internal contract (token custody and HTS operations)

**Common Pitfalls to Avoid:**

```javascript
// ❌ WRONG - Approving tokens to LazyLotto
const lazyLottoAddress = "0x...";
await tokenContract.approve(lazyLottoAddress, amount);
// This will FAIL because LazyLotto doesn't hold tokens

// ✅ CORRECT - Approve to storage contract
const storageAddress = await lazyLottoContract.storageContract();
await tokenContract.approve(storageAddress, amount);
```

**Correct Token Approval Workflow:**

```javascript
async function setupTokenApprovals(tokenAddress, amount) {
  // 1. Query storage contract address from LazyLotto
  const storageAddress = await lazyLottoContract.storageContract();
  console.log('Storage contract:', storageAddress);
  
  // 2. Get token contract instance
  const tokenContract = new ethers.Contract(
    tokenAddress,
    ERC20_ABI,
    signer
  );
  
  // 3. Check current allowance to STORAGE (not LazyLotto)
  const currentAllowance = await tokenContract.allowance(
    userAddress,
    storageAddress  // ✅ Check allowance to storage
  );
  
  // 4. Approve if needed
  if (currentAllowance < amount) {
    const tx = await tokenContract.approve(
      storageAddress,  // ✅ Approve storage contract
      amount
    );
    await tx.wait();
    console.log('Token approved to storage contract');
  }
  
  // 5. Now call LazyLotto methods
  // LazyLotto will internally delegate to storage for token transfers
  await lazyLottoContract.buyEntry(poolId, ticketCount);
}
```

**Why This Matters:**

1. **Token Transfers**: All HTS token operations (transfers, burns, mints) happen in storage
2. **Allowances**: Users approve storage contract to spend their tokens
3. **Facade Pattern**: LazyLotto validates business rules, then delegates to storage
4. **Safety**: Storage only accepts calls from LazyLotto (locked via `setContractUser()`)

**NFT Allowances Work the Same Way:**

```javascript
// For NFT operations (ticket redemption, prize claiming)
const storageAddress = await lazyLottoContract.storageContract();

// Approve all NFTs of this collection to storage
await nftContract.setApprovalForAll(storageAddress, true);

// Now can redeem NFT tickets
await lazyLottoContract.rollWithNFT(poolId, serialNumbers);
```

**Debugging Token Approval Issues:**

```javascript
async function debugTokenApprovals(tokenAddress) {
  const storageAddress = await lazyLottoContract.storageContract();
  const lazyLottoAddress = await lazyLottoContract.address;
  
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  
  // Check both allowances
  const allowanceToLazyLotto = await tokenContract.allowance(
    userAddress,
    lazyLottoAddress
  );
  
  const allowanceToStorage = await tokenContract.allowance(
    userAddress,
    storageAddress
  );
  
  console.log('Allowance to LazyLotto:', allowanceToLazyLotto);
  console.log('Allowance to Storage:', allowanceToStorage);
  
  if (allowanceToLazyLotto > 0 && allowanceToStorage === 0) {
    console.warn('⚠️ WRONG: Tokens approved to LazyLotto instead of storage!');
    console.log('Fix: Approve to storage contract:', storageAddress);
  }
}
```

---

## Appendix: Contract Addresses Reference

**Query at Runtime (Recommended):**
```javascript
// Always query storage address dynamically
const storageAddress = await lazyLottoContract.storageContract();
```

**Why Not Hardcode Storage Address?**
- Storage contract is immutable once set
- But different deployments have different storage addresses
- Always query from LazyLotto for safety
  
  return <PrizeCard prize={prize} />;
}
```

### 7. Transaction Receipts

Save and display transaction history:

```javascript
function saveTransactionReceipt(receipt, type, details) {
  const record = {
    hash: receipt.transactionHash,
    timestamp: Date.now(),
    type, // 'purchase', 'roll', 'claim', etc.
    details,
    status: receipt.status === 1 ? 'success' : 'failed',
  };
  
  // Save to local storage or state management
  const history = JSON.parse(localStorage.getItem('txHistory') || '[]');
  history.push(record);
  localStorage.setItem('txHistory', JSON.stringify(history));
}
```

---

## Conclusion

This guide provides the foundation for building a comprehensive, user-friendly frontend for LazyLotto. Key takeaways:

1. **Use `getPrizePackage()`** to inspect prize details before displaying to users
2. **Implement proper error handling** for all contract interactions
3. **Show real-time updates** using event listeners
4. **Optimize gas usage** with proper estimation
5. **Provide clear visual feedback** at every step
6. **Cache frequently accessed data** to improve performance
7. **Test thoroughly** on mobile devices

For additional support or questions, refer to:
- [LazyLotto Business Logic Documentation](./LazyLotto-BUSINESS_LOGIC.md)
- [LazyLotto Testing Plan](./LazyLotto-TESTING_PLAN.md)
- Contract source code and inline documentation

Happy building! 🎰✨
