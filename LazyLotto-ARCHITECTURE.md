# LazyLotto Architecture - Community Pools Edition

**Version**: 3.0  
**Date**: December 10, 2025  
**Status**: Production Ready  
**Contract Sizes**: LazyLotto 23.816 KB | PoolManager 9.327 KB | Storage 11.137 KB

---

## System Overview

LazyLotto is a decentralized lottery platform on Hedera featuring community-created pools, provably fair VRF randomness, flexible prize structures, and transparent proceeds management. The system uses a three-contract architecture designed to maximize functionality within Hedera's 24 KB contract size limit.

### Design Principles

1. **Separation of Concerns**: LazyLotto handles execution, PoolManager handles authorization, Storage handles HTS
2. **LazyLotto as Guardian**: All token operations flow through LazyLotto for safety
3. **Single Approval Model**: Users approve Storage (gameplay) and GasStation (LAZY), nothing else
4. **Immutable Deployment**: No upgrade paths - must be correct on first deployment
5. **Size Optimization**: Careful function placement to stay under 24 KB limits

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                      USER INTERACTIONS                        │
│  • Create pools • Buy entries • Roll tickets • Claim prizes   │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│                      LAZYLOTTO (23.816 KB)                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ EXECUTION LAYER                                        │  │
│  │ • Pool creation & gameplay                             │  │
│  │ • Prize management & distribution                      │  │
│  │ • Entry purchases & rolling                            │  │
│  │ • Token withdrawal execution                           │  │
│  │ • NFT ticket minting & redemption                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                                │
│  Delegates to PoolManager:                                    │
│  • canManagePool(poolId, user)                                │
│  • canAddPrizes(poolId, user)                                 │
│  • recordPoolCreation(poolId, creator, isAdmin)               │
│  • recordProceeds(poolId, token, amount)                      │
│  • requestWithdrawal(poolId, token, caller)                   │
│  • calculateBoost(user)                                       │
└────────────┬────────────────────────┬───────────────────────┘
             │                        │
             ▼                        ▼
┌────────────────────────┐  ┌────────────────────────────────┐
│  POOLMANAGER (9.327 KB)│  │     STORAGE (11.137 KB)        │
│  ┌──────────────────┐  │  │  ┌──────────────────────────┐  │
│  │ AUTHORIZATION    │  │  │  │ HTS OPERATIONS           │  │
│  │ • Pool ownership │  │  │  │ • Token minting          │  │
│  │ • Prize managers │  │  │  │ • Token transfers        │  │
│  │ • Admin checks   │  │  │  │ • Token burns            │  │
│  └──────────────────┘  │  │  │ • Token associations     │  │
│  ┌──────────────────┐  │  │  │ • Token custody          │  │
│  │ FEE MANAGEMENT   │  │  │  └──────────────────────────┘  │
│  │ • Creation fees  │  │  │                                 │
│  │ • Proceeds split │  │  │  Access Control:                │
│  │ • Platform cut   │  │  │  • Only LazyLotto can call     │
│  └──────────────────┘  │  │  • Set once via setContractUser│
│  ┌──────────────────┐  │  └────────────────────────────────┘
│  │ BONUS SYSTEM     │  │
│  │ • Time windows   │  │
│  │ • NFT holdings   │  │
│  │ • LAZY balance   │  │
│  └──────────────────┘  │
│  ┌──────────────────┐  │
│  │ ENUMERATION      │  │
│  │ • Global pools   │  │
│  │ • Community pools│  │
│  │ • Owner tracking │  │
│  └──────────────────┘  │
└────────────────────────┘
```

---

## Contract Responsibilities

### LazyLotto (Execution Engine)

**Primary Role**: Execute all business logic and financial operations

**Core Functions**:
- Pool creation with fee collection
- Entry purchase with proceeds recording
- Ticket rolling with bonus application
- Prize claims and NFT redemption
- Token withdrawal validation and execution
- Pool management (pause, close, prize addition/removal)

**Key Characteristics**:
- User-facing contract (all UI interactions happen here)
- Financial guardian (validates all token movements)
- Delegates authorization to PoolManager
- Calls Storage for HTS operations
- Size: 23.816 KB (332 bytes under 24 KB limit)

**Critical Path**: User → LazyLotto → [PoolManager for auth] → [Storage for tokens] → Back to user

### LazyLottoPoolManager (Authorization Layer)

**Primary Role**: Track ownership, permissions, fees, and calculate bonuses

**Core Functions**:
- Pool ownership tracking (address(0) = global, address = community)
- Authorization validation (canManagePool, canAddPrizes)
- Creation fee collection (HBAR + LAZY)
- Proceeds tracking with per-pool platform fee percentage
- Withdrawal split calculation (95/5 at pool creation time)
- Bonus system (time windows, NFT holdings, LAZY balance)
- Pool enumeration (global vs community, pagination support)

**Key Characteristics**:
- Never holds tokens (only tracks obligations)
- Called by LazyLotto for validation
- Returns authorization decisions
- Stores bonus configuration
- Size: 9.327 KB (ample room for future features)

**Critical Path**: LazyLotto → PoolManager → [validation/calculation] → Return to LazyLotto

### LazyLottoStorage (HTS Operations)

**Primary Role**: Execute all Hedera Token Service operations

**Core Functions**:
- Token minting (NFT tickets, prize NFTs)
- Token transfers (prizes, proceeds, withdrawals)
- Token burns (LAZY burn on entry)
- Token associations (auto-associate functionality)
- Token custody (holds all tokens in system)

**Key Characteristics**:
- Access controlled (only LazyLotto can call)
- Pre-existing contract (unchanged in this upgrade)
- Users approve Storage for gameplay tokens
- Size: 11.137 KB (stable)

**Critical Path**: LazyLotto → Storage → [HTS operation] → Blockchain state change

---

## Data Flow Patterns

### Pool Creation Flow

```
User Decision
     │
     ▼
Frontend: getCreationFees() from PoolManager
     │
     ▼
Frontend: Check user balances (HBAR + LAZY)
     │
     ▼
Frontend: Approve LAZY to LazyGasStation (if needed)
     │
     ▼
User Transaction: LazyLotto.createPool{value: hbarFee}(...)
     │
     ├──> LazyLotto: Validate parameters
     │
     ├──> LazyGasStation: drawLazyFromPayTo(user, lazyFee, 0, poolManager)
     │        └──> LAZY tokens transferred to PoolManager
     │
     ├──> Storage: createToken{value: remaining HBAR}(...)
     │        └──> NFT ticket token created
     │
     ├──> LazyLotto: Create pool struct, add to pools[]
     │
     ├──> PoolManager: recordPoolCreation{value: hbarFee}(poolId, user, false)
     │        ├──> Capture platformProceedsPercentage (locked for this pool)
     │        ├──> Validate HBAR fee (if not admin)
     │        ├──> Track totalHbarCollected
     │        ├──> Set poolOwners[poolId] = user
     │        ├──> Add to userOwnedPools[user]
     │        └──> Add to communityPools[]
     │
     └──> Emit PoolCreated(poolId)
```

### Entry Purchase & Proceeds Flow

```
User Transaction: LazyLotto.buyEntry(poolId, ticketCount)
     │
     ├──> LazyLotto: Validate pool not paused/closed
     │
     ├──> LazyLotto: Calculate totalFee = entryFee * ticketCount
     │
     ├──> LazyLotto: _pullPayment(feeToken, totalFee, burnPercentage)
     │        ├──> If HBAR: Validate msg.value
     │        ├──> If LAZY: LazyGasStation.drawLazyFrom(user, amount, burn%)
     │        │         ├──> Burn portion sent to 0x0...0
     │        │         └──> Rest sent to Storage
     │        └──> If Other Token: Storage.transferFromCustomToken(user, Storage, amount)
     │
     ├──> LazyLotto: Calculate actualCollected (totalFee - burned)
     │
     ├──> PoolManager: recordProceeds(poolId, feeToken, actualCollected)
     │        ├──> Get poolFeePercentage = poolPlatformFeePercentage[poolId]
     │        ├──> Calculate ownerShare = actualCollected * (100 - poolFeePercentage) / 100
     │        ├──> Track poolProceeds[poolId].totalProceeds[token] += actualCollected
     │        └──> Track pendingWithdrawals[token] += ownerShare
     │
     ├──> LazyLotto: Update pool.outstandingEntries += ticketCount
     │
     ├──> LazyLotto: Update userEntries[poolId][user] += ticketCount
     │
     └──> Emit EntryPurchased(user, poolId, ticketCount)
```

### Rolling & Bonus Flow

```
User Transaction: LazyLotto.rollAll(poolId)
     │
     ├──> LazyLotto: Get user entries count
     │
     ├──> LazyLotto: _roll(poolId, entryCount)
     │        │
     │        ├──> PoolManager: calculateBoost(user)
     │        │        ├──> Check time bonuses (start <= now <= end)
     │        │        ├──> Check NFT bonuses (balanceOf > 0 or delegated)
     │        │        ├──> Check LAZY balance bonus (balance >= threshold)
     │        │        └──> Return: sum(bps) * 10_000
     │        │
     │        ├──> LazyLotto: For each entry:
     │        │        ├──> Get random number from PRNG
     │        │        ├──> Apply boost to win rate
     │        │        ├──> Compare random vs adjusted win rate
     │        │        └──> If win: Add prize to pending[user]
     │        │
     │        ├──> LazyLotto: Update pool.outstandingEntries -= rolled
     │        │
     │        └──> LazyLotto: Update userEntries[poolId][user] -= rolled
     │
     └──> Return (winCount, offsetInPendingArray)
```

### Withdrawal Flow

```
User Transaction: LazyLotto.withdrawPoolProceeds(poolId, token)
     │
     ├──> PoolManager: requestWithdrawal(poolId, token, msg.sender)
     │        │
     │        ├──> Get owner = poolOwners[poolId]
     │        ├──> Validate owner != address(0) (not global pool)
     │        ├──> Validate msg.sender == owner OR isAdmin(msg.sender)
     │        ├──> Get total = poolProceeds[poolId].totalProceeds[token]
     │        ├──> Get withdrawn = poolProceeds[poolId].withdrawnProceeds[token]
     │        ├──> Calculate available = total - withdrawn
     │        ├──> Get poolFeePercentage = poolPlatformFeePercentage[poolId]
     │        ├──> Calculate ownerShare = available * (100 - poolFeePercentage) / 100
     │        ├──> Calculate platformCut = available - ownerShare
     │        ├──> Update poolProceeds[poolId].withdrawnProceeds[token] += available
     │        ├──> Update pendingWithdrawals[token] -= ownerShare
     │        ├──> Update platformProceedsBalance[token] += platformCut
     │        └──> Return ownerShare
     │
     ├──> LazyLotto: Get owner from PoolManager
     │
     ├──> LazyLotto: Transfer ownerShare to owner
     │        ├──> If HBAR: Storage.withdrawHbar(owner, ownerShare)
     │        ├──> If LAZY: LazyGasStation.payoutLazy(owner, ownerShare, 0)
     │        └──> If Other: Storage.withdrawFungible(token, owner, ownerShare)
     │
     └──> Platform cut remains in PoolManager tracking (withdrawn by admin later)
```

---

## Authorization Matrix

| Action | Global Admin | Pool Owner | Global Prize Mgr | Pool Prize Mgr |
|--------|-------------|------------|------------------|----------------|
| Create Pool (Free) | ✅ | ❌ | ❌ | ❌ |
| Create Pool (Paid) | ❌ | ✅ | ❌ | ❌ |
| Pause/Unpause Pool | ✅ (any) | ✅ (own) | ❌ | ❌ |
| Close Pool | ✅ (any) | ✅ (own) | ❌ | ❌ |
| Add Prizes | ✅ (any) | ✅ (own) | ✅ (any) | ✅ (specific) |
| Remove Prizes | ✅ (any, if closed) | ✅ (own, if closed) | ❌ | ❌ |
| Withdraw Proceeds | ✅ (any) | ✅ (own) | ❌ | ❌ |
| Transfer Ownership | ✅ (any) | ✅ (own) | ❌ | ❌ |
| Set Prize Manager | ✅ (any) | ✅ (own) | ❌ | ❌ |
| Withdraw Platform Fees | ✅ | ❌ | ❌ | ❌ |
| Set Creation Fees | ✅ | ❌ | ❌ | ❌ |
| Configure Bonuses | ✅ | ❌ | ❌ | ❌ |

**Authorization Flow**:
```
LazyLotto Function Called
     │
     ▼
Check: poolManager.canManagePool(poolId, msg.sender)
  OR: poolManager.canAddPrizes(poolId, msg.sender)
     │
     ├──> If false: revert NotAuthorized()
     └──> If true: Continue execution
```

---

## Financial Safety Model

### Token Flow Rules

1. **Users approve tokens to Storage** (for gameplay)
2. **Users approve LAZY to GasStation** (for fees)
3. **All tokens held by Storage** (custody)
4. **All withdrawals validated by LazyLotto** (guardian)
5. **PoolManager never holds tokens** (tracking only)

### Proceeds Safety Guarantees

```
Entry Purchase Revenue Flow:
┌────────────────────────────────────────────────────┐
│ User pays 100 LAZY for entries (5% burn)          │
└────────────┬───────────────────────────────────────┘
             │
             ├──> 5 LAZY burned (sent to 0x0)
             └──> 95 LAZY to Storage
                  │
                  ├──> PoolManager.recordProceeds(poolId, LAZY, 95)
                  │    │
                  │    ├──> Get poolFeePercentage (e.g., 5%)
                  │    ├──> ownerShare = 95 * 0.95 = 90.25 LAZY
                  │    ├──> platformCut = 95 - 90.25 = 4.75 LAZY
                  │    │
                  │    ├──> poolProceeds[poolId].total += 95
                  │    └──> pendingWithdrawals[LAZY] += 90.25
                  │
                  └──> Tokens remain in Storage until withdrawal

On Withdrawal:
┌────────────────────────────────────────────────────┐
│ Owner calls withdrawPoolProceeds(poolId, LAZY)    │
└────────────┬───────────────────────────────────────┘
             │
             ├──> PoolManager.requestWithdrawal() validates
             │    ├──> ownerShare = 90.25 LAZY (calculated)
             │    ├──> platformCut = 4.75 LAZY (calculated)
             │    ├──> poolProceeds[poolId].withdrawn += 95
             │    ├──> pendingWithdrawals[LAZY] -= 90.25
             │    └──> platformProceedsBalance[LAZY] += 4.75
             │
             ├──> LazyLotto transfers 90.25 LAZY to owner
             │    └──> Storage.withdrawFungible() or GasStation.payoutLazy()
             │
             └──> 4.75 LAZY remains in Storage
                  └──> Tracked in PoolManager.platformProceedsBalance[LAZY]
                       └──> Withdrawn by admin via withdrawPlatformFees()
```

### Platform Fee Lock-In

**Problem**: Changing `platformProceedsPercentage` globally could create "bait and switch" scenario

**Solution**: Each pool locks in the percentage at creation time

```solidity
// In PoolManager.recordPoolCreation():
poolPlatformFeePercentage[poolId] = platformProceedsPercentage;

// In PoolManager.recordProceeds():
uint256 poolFeePercentage = poolPlatformFeePercentage[poolId]; // Use locked value

// In PoolManager.requestWithdrawal():
uint256 poolFeePercentage = poolPlatformFeePercentage[poolId]; // Use locked value
```

**Result**: 
- Pool created at 5% fee always uses 5% split
- Changing global percentage to 10% only affects NEW pools
- Existing pools unaffected (no retroactive changes)

---

## Size Optimization Strategy

### Problem

Hedera enforces 24 KB deployed bytecode limit. LazyLotto v2 exceeded this limit.

### Solution

Split authorization and bonus logic into companion contract:

**Moved to PoolManager** (~2 KB saved):
- Bonus system (calculateBoost, time/NFT/LAZY bonuses)
- Pool ownership tracking (poolOwners, userOwnedPools)
- Prize manager functionality (global and per-pool)
- Creation fee management
- Proceeds tracking and split calculation
- Pool enumeration (global vs community)

**Kept in LazyLotto**:
- All execution logic (entries, rolling, claims)
- All token operations (via Storage)
- Pool management (create, pause, close)
- Prize addition/removal
- Financial validation
- User-facing interface

**Critical Facade**:
```solidity
// In LazyLotto (backward compatibility)
function calculateBoost(address _user) external view returns (uint32 boost) {
    return poolManager.calculateBoost(_user);
}
```

**Result**:
- LazyLotto: 23.816 KB ✅ (332 bytes under limit)
- PoolManager: 9.327 KB ✅ (plenty of headroom)
- Total: 33.143 KB (split across two contracts)

---

## Deployment & Initialization

### Deployment Sequence

```javascript
// 1. Deploy LazyLottoPoolManager
const PoolManager = await deploy('LazyLottoPoolManager', [
  lazyTokenAddress,
  lazyGasStationAddress,
  lazyDelegateRegistryAddress
]);

// 2. Link bidirectionally
await poolManager.setLazyLotto(lazyLottoAddress); // One-time only
await lazyLotto.setPoolManager(poolManager.address); // One-time only

// 3. Configure initial settings
await poolManager.setCreationFees(hbarFee, lazyFee);
await poolManager.setPlatformProceedsPercentage(5); // 5%

// 4. (Optional) Configure bonuses
await poolManager.setTimeBonus(start, end, bonusBps);
await poolManager.setNFTBonus(nftAddress, bonusBps);
await poolManager.setLazyBalanceBonus(threshold, bonusBps);

// System ready for use
```

### Immutability Guarantees

- `LazyLotto.poolManager`: Set once via `setPoolManager()` (admin only)
- `PoolManager.lazyLotto`: Set once via `setLazyLotto()` (anyone first caller)
- `Storage.contractUser`: Set once via `setContractUser()` (already deployed)

**No upgrade paths** - contracts are immutable after deployment

---

## Testing Strategy

### Unit Tests (Per Contract)

**LazyLotto**:
- Pool creation (admin free, user paid)
- Entry purchase (HBAR, LAZY, other tokens)
- Rolling mechanics (batch, all, NFT)
- Prize claims (fungible, NFT)
- Pool management (pause, close, remove prizes)
- Withdrawal validation

**PoolManager**:
- Pool registration (global vs community)
- Authorization (canManagePool, canAddPrizes)
- Fee collection and tracking
- Proceeds recording and withdrawal calculation
- Bonus calculations (time, NFT, LAZY)
- Pool enumeration (pagination, global/community split)
- Ownership transfer

**Integration Tests**:
- Full gameplay flow (create → buy → roll → claim)
- Community pool creation with fees
- Proceeds withdrawal with 95/5 split
- Platform fee accumulation and withdrawal
- Bonus application during rolling
- NFT ticket redemption
- Pool ownership transfer
- Authorization across contracts

### Edge Cases

- [ ] Pool creation with insufficient fees
- [ ] Withdrawal with no proceeds available
- [ ] Transfer ownership of global pool (should fail)
- [ ] Withdraw from global pool (should fail)
- [ ] Platform fee percentage change (old pools unaffected)
- [ ] Duplicate NFT bonus tokens
- [ ] Bonus calculation with multiple active bonuses
- [ ] Large batch rolling (gas limits)
- [ ] Pool with 100+ prizes (pagination handling)

---

## Migration from v2 to v3

### Backward Compatibility

**Existing Deployments**:
- LazyLotto v2 contracts continue functioning
- No forced migration required
- Admin-only mode supported (`poolManager == address(0)`)

**New Deployments**:
- Deploy LazyLotto v3 + PoolManager together
- Link bidirectionally
- Configure initial settings
- Existing users can interact immediately

**API Changes**:
- `calculateBoost()` remains in LazyLotto (facade)
- All other bonus/ownership functions move to PoolManager
- Users need PoolManager address for admin operations

### Data Migration

**Not Required**: Separate deployments, no state migration needed

---

## Security Considerations

### Access Control

- **Admin Functions**: Protected by `_requireAdmin()` check
- **Pool Management**: Validated by PoolManager.canManagePool()
- **Prize Addition**: Validated by PoolManager.canAddPrizes()
- **Withdrawals**: Owner check in PoolManager.requestWithdrawal()
- **Storage Calls**: Only LazyLotto can call (immutable)

### Financial Safety

- **Prize Obligations**: Tracked in `ftTokensForPrizes` mapping
- **Withdrawal Validation**: Cannot withdraw tokens needed for prizes
- **Proceeds Tracking**: Separate from prize pool
- **Platform Fees**: Only available after owner withdrawal
- **No Reentrancy**: ReentrancyGuard on all state-changing functions

### Hedera-Specific

- **HTS Integration**: All token ops through Storage contract
- **VRF Randomness**: Hedera PRNG for provably fair results
- **Gas Estimation**: Rolling requires buffer for PRNG variability
- **Mirror Node**: Independent balance verification

---

## Future Considerations

### Potential Enhancements

**PoolManager** (9.327 KB, room available):
- Multi-tier platform fees (based on pool size)
- Time-limited community pools
- Pool templates/presets
- Partnership revenue sharing
- Batch prize addition optimization

**LazyLotto** (23.816 KB, 332 bytes remaining):
- **Limited space** - any additions require careful measurement
- Consider moving more functions to PoolManager if needed

### Upgrade Path

**Not Supported**: Contracts are immutable

**Alternative**: Deploy new contracts, keep old ones running

---

## Glossary

**Global Pool**: Pool created by admin (poolOwner = address(0)), free creation  
**Community Pool**: Pool created by user (poolOwner = address), paid creation  
**Pool Manager**: Authorization and proceeds tracking contract  
**Storage**: HTS operations contract (pre-existing)  
**LazyGasStation**: LAZY token payment intermediary  
**Prize Manager**: User authorized to add prizes (global or per-pool)  
**Proceeds**: Revenue from entry purchases (95/5 split)  
**Platform Fee**: Percentage taken from proceeds (locked at pool creation)  
**Boost**: Bonus percentage applied to win rate (time/NFT/LAZY based)

---

**End of Architecture Document**
