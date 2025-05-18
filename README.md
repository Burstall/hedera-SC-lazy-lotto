# hedera-SC-lazy-lotto

## LazyLotto Smart Contract

### Overview

**LazyLotto** is an on-chain lottery contract for Hedera, supporting:
- Multiple pools with configurable prizes (fungible and NFT).
- Randomness via Hedera VRF.
- Batch operations for efficiency.
- Prize management, including NFT redemption.
- Admin controls for pool and prize management.

### Key Methods

#### Admin-Only Functions
- `addAdmin`, `removeAdmin`: Manage admin set.
- `createPool`: Create a new lottery pool.
- `addPrizePackage`, `addMultipleFungiblePrizes`: Add prizes to pools.
- `pausePool`, `unpausePool`, `closePool`: Control pool state.
- `removePrizes`: Remove prizes from closed pools.
- `setBurnPercentage`, `setLazyBalanceBonus`, `setNFTBonus`, `setTimeBonus`, `removeTimeBonus`, `removeNFTBonus`: Configure bonuses and fees.
- `transferHbar`, `transferFungible`: Withdraw tokens/HBAR.

#### User Functions
- `buyEntry`, `buyAndRollEntry`, `buyAndRedeemEntry`: Purchase tickets and optionally roll/redeem.
- `adminBuyEntry`: Admin can buy on behalf of a user.
- `rollAll`, `rollBatch`, `rollWithNFT`: Roll tickets for prizes.
- `redeemPrizeToNFT`, `claimPrizeFromNFT`, `claimPrize`, `claimAllPrizes`: Claim prizes in various ways.

#### Getters (Views)
- `totalPools`, `getPoolDetails`, `getPoolPrizes`, `getUsersEntries`, `getUserEntries`, `getPendingPrizes`, `getPendingPrize`, `isAdmin`, `totalTimeBonuses`, `totalNFTBonusTokens`, `calculateBoost`: Query contract state.

### Usage & Interactions

- **Admins**: Deploy contract, create pools, add prizes (including packages with both fungible and multiple NFTs), manage bonuses, pause/unpause/close pools, and withdraw tokens.
- **Users**: Buy tickets, roll for prizes, claim prizes (directly or as NFTs), and interact with NFT prize vouchers.
- **Prize Claiming**: Prizes can be claimed directly or redeemed as NFT vouchers, with batch operations supported for efficiency.
- **Bonuses**: Time-based, NFT-holding, and $LAZY balance-based bonuses can increase win rates.
- **Pool State**: Pools can be paused (no new entries) or closed (no further actions except prize removal). Prizes can only be removed from closed pools.

### Token Allowance & Association Requirements

- **NFT Allowance**: When adding NFTs as prizes, the sender must grant NFT allowance to the contract.
- **HBAR Allowance**: When claiming NFT prizes out, the user must grant a small HBAR allowance (10 tinybar) to the contract.
- **Fungible Token Association**: Users must associate any fungible token (FT) they may receive as a prize with their account before claiming.

### Important Notes

- **Error Checking**: Extensive use of custom errors (e.g., `BadParameters()`, `NotAdmin()`, etc.) for safety and clarity.
- **ReentrancyGuard**: Protects against reentrancy attacks.
- **Pausable**: Admins can pause/unpause the contract and individual pools.
- **Event Emissions**: All major actions emit events for off-chain tracking and transparency.

---