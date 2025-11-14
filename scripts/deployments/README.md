# LazyLotto Deployment Scripts

This directory contains deployment scripts for the LazyLotto lottery system on Hedera.

## Main Deployment Script

### `deployLazyLotto.js`

Interactive deployment script that handles the complete deployment of LazyLotto and all its dependencies.

#### Features

✅ **Interactive** - Prompts for confirmation on mainnet deployment  
✅ **Reusable** - Checks for existing contracts and allows reuse  
✅ **Safe** - Saves deployment addresses for future reference  
✅ **Comprehensive** - Deploys all dependencies in correct order  
✅ **Verified** - Validates deployment after completion

#### Deployment Order

1. **LAZY Token & SCT** - Native project token and token creator contract
2. **LazyGasStation** - Automatic HBAR/LAZY refill system
3. **LazyDelegateRegistry** - NFT delegation tracking
4. **PRNG** - Pseudo-random number generator for fair lottery draws
5. **LazyLottoStorage** - Token custody and HTS operations handler
6. **LazyLotto** - Main lottery contract
7. **Configuration** - Sets contract users and permissions
8. **Funding** - Optional LazyGasStation funding
9. **Verification** - Validates all deployments

#### Prerequisites

1. **Environment Setup**

Create a `.env` file in the project root with:

```env
# Required
CONTRACT_NAME=LazyLotto
STORAGE_CONTRACT_NAME=LazyLottoStorage
ACCOUNT_ID=0.0.xxxxx
PRIVATE_KEY=302...
ENVIRONMENT=test

# Optional (reuse existing contracts)
LAZY_TOKEN_ID=0.0.xxxxx
LAZY_SCT_CONTRACT_ID=0.0.xxxxx
LAZY_GAS_STATION_CONTRACT_ID=0.0.xxxxx
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.xxxxx
PRNG_CONTRACT_ID=0.0.xxxxx
LAZY_LOTTO_STORAGE=0.0.xxxxx
LAZY_LOTTO_CONTRACT_ID=0.0.xxxxx
```

2. **Compiled Contracts**

Ensure all contracts are compiled:

```bash
npx hardhat compile
```

3. **Sufficient Balance**

Ensure deployer account has sufficient HBAR:
- Testnet: ~50 HBAR recommended
- Mainnet: ~100 HBAR recommended (plus gas costs)

#### Usage

**Option 1: NPM Script** (recommended)

Add to `package.json`:

```json
{
  "scripts": {
    "deploy:lazylotto": "node scripts/deployments/deployLazyLotto.js"
  }
}
```

Then run:

```bash
npm run deploy:lazylotto
```

**Option 2: Direct Execution**

```bash
node scripts/deployments/deployLazyLotto.js
```

#### Deployment Flow

```
┌─────────────────────────────────────────┐
│  1. Initialize Client (TEST/MAIN/PREVIEW) │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  2. Deploy/Reuse LAZY Token & SCT        │
│     → Check .env for existing            │
│     → Deploy if not found                │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  3. Deploy/Reuse LazyGasStation          │
│     → Requires LAZY Token & SCT          │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  4. Deploy/Reuse LazyDelegateRegistry    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  5. Deploy/Reuse PRNG Generator          │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  6. Deploy/Reuse LazyLottoStorage        │
│     → Requires LazyGasStation + LAZY     │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  7. Deploy/Reuse LazyLotto               │
│     → Requires all dependencies          │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  8. Set Contract User on Storage         │
│     → Allows LazyLotto to use storage    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  9. Add to LazyGasStation                │
│     → Storage + LazyLotto as users       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  10. Fund LazyGasStation (Optional)      │
│      → Prompt for HBAR amount            │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  11. Verify Deployment                   │
│      → Check immutable variables         │
│      → Verify admin status               │
│      → Validate configuration            │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  12. Save Deployment Addresses           │
│      → deployment-{env}-{timestamp}.json │
└─────────────────────────────────────────┘
```

#### Output

The script generates a JSON file with all deployed contract addresses:

**Format:** `deployment-{environment}-{timestamp}.json`

**Example:** `deployment-test-1713542400000.json`

```json
{
  "timestamp": "2025-04-19T14:00:00.000Z",
  "environment": "TEST",
  "contracts": {
    "lazyToken": "0.0.12345",
    "lazySCT": "0.0.12346",
    "lazyGasStation": "0.0.12347",
    "lazyDelegateRegistry": "0.0.12348",
    "prng": "0.0.12349",
    "lazyLottoStorage": "0.0.12350",
    "lazyLotto": "0.0.12351"
  }
}
```

#### Example Console Output

```
🚀 LazyLotto Deployment Script
=====================================

📍 Environment: TEST
   Network: TESTNET
👤 Operator: 0.0.xxxxx

📦 Step 1: LAZY Token & SCT
----------------------------
✅ Using existing LAZY Token: 0.0.12345
✅ Using existing LAZY SCT: 0.0.12346

📦 Step 2: LazyGasStation
-------------------------
🔨 Deploying LazyGasStation...
✅ LazyGasStation deployed: 0.0.12347

📦 Step 3: LazyDelegateRegistry
--------------------------------
🔨 Deploying LazyDelegateRegistry...
✅ LazyDelegateRegistry deployed: 0.0.12348

📦 Step 4: PRNG Generator
-------------------------
🔨 Deploying PRNG Generator...
✅ PRNG deployed: 0.0.12349

📦 Step 5: LazyLottoStorage
---------------------------
🔨 Deploying LazyLottoStorage...
✅ LazyLottoStorage deployed: 0.0.12350

📦 Step 6: LazyLotto
--------------------
🔨 Deploying LazyLotto main contract...
✅ LazyLotto deployed: 0.0.12351

⚙️  Step 7: Configure Storage Contract User
-------------------------------------------
🔨 Setting LazyLotto as contract user on storage...
✅ LazyLotto set as contract user on storage

⚙️  Step 8: Configure LazyGasStation Contract Users
--------------------------------------------------
🔨 Adding LazyLottoStorage to LazyGasStation...
✅ LazyLottoStorage added to LazyGasStation
🔨 Adding LazyLotto to LazyGasStation...
✅ LazyLotto added to LazyGasStation

⚙️  Step 9: Fund LazyGasStation (Optional)
-----------------------------------------
Enter HBAR amount to fund LazyGasStation (or press Enter to skip): 10
🔨 Sending 10 HBAR to LazyGasStation...
✅ Sent 10 HBAR to LazyGasStation

✅ Deployment Verification
===========================

🔍 Verifying LazyLotto configuration...
   lazyToken: ✅ 0.0.12345
   lazyGasStation: ✅ 0.0.12347
   storageContract: ✅ 0.0.12350
   Deployer is admin: ✅

✅ All verifications passed!

✅ Deployment addresses saved to: ./scripts/deployments/deployment-test-1713542400000.json

🎉 LazyLotto Deployment Complete!
===================================

📝 Deployed Contracts:
   LAZY Token:          0.0.12345
   LAZY SCT:            0.0.12346
   LazyGasStation:      0.0.12347
   LazyDelegateRegistry: 0.0.12348
   PRNG:                0.0.12349
   LazyLottoStorage:    0.0.12350
   LazyLotto:           0.0.12351

📋 Next Steps:
   1. Update .env with deployed contract IDs
   2. Create lottery pools using admin functions
   3. Add prize packages to pools
   4. Test with small amounts before production use
   5. Consider setting up monitoring for contract events
```

#### Post-Deployment Steps

1. **Update .env**

Add all deployed contract IDs to `.env` for future operations:

```env
LAZY_TOKEN_ID=0.0.12345
LAZY_SCT_CONTRACT_ID=0.0.12346
LAZY_GAS_STATION_CONTRACT_ID=0.0.12347
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.12348
PRNG_CONTRACT_ID=0.0.12349
LAZY_LOTTO_STORAGE=0.0.12350
LAZY_LOTTO_CONTRACT_ID=0.0.12351
```

2. **Create Lottery Pool**

Use admin functions to create first pool:

```javascript
await lazyLotto.createPool(
  ticketCID,    // IPFS CID for ticket metadata
  winCID,       // IPFS CID for win message metadata
  winRate,      // e.g., 1000 = 10% win rate
  entryFee,     // Fee in smallest token unit
  feeToken,     // Token address (HBAR = 0x0)
  poolTokenId   // NFT collection for tickets (optional)
);
```

3. **Add Prize Packages**

Add prizes to the pool:

```javascript
await lazyLotto.addPrizePackage(
  poolId,
  prizeToken,      // Token address for prize
  prizeAmount,     // Amount in smallest unit
  nftTokens,       // Array of NFT token addresses (optional)
  nftSerials       // Array of NFT serial numbers (optional)
);
```

4. **Configure Bonuses (Optional)**

Set up LAZY balance bonus, NFT bonuses, or time-based bonuses:

```javascript
// LAZY balance bonus
await lazyLotto.setLazyBalanceBonus(
  thresholdAmount,  // Minimum LAZY balance
  bonusBps          // Bonus in basis points (100 = 1%)
);

// NFT bonus
await lazyLotto.setNFTBonus(
  nftTokenAddress,  // NFT collection address
  bonusBps          // Bonus in basis points
);

// Time bonus
await lazyLotto.setTimeBonus(
  startTimestamp,   // Unix timestamp
  endTimestamp,     // Unix timestamp
  bonusBps          // Bonus in basis points
);
```

5. **Test Operations**

Before production use:
- Buy test entry with small amount
- Roll test entry
- Claim test prize
- Verify all operations work correctly

#### Troubleshooting

**Issue: "Environment required, please specify..."**
- **Solution:** Check `.env` file exists and contains required variables (ACCOUNT_ID, PRIVATE_KEY, ENVIRONMENT)

**Issue: "Deployment failed: INSUFFICIENT_TX_FEE"**
- **Solution:** Ensure deployer account has sufficient HBAR balance

**Issue: "setContractUser failed"**
- **Solution:** Verify LazyLottoStorage was deployed and address is correct

**Issue: "Verification failed"**
- **Solution:** Check mirror node delay (wait 30s and try verification again)

**Issue: "addContractUser failed"**
- **Solution:** Ensure you are the admin of LazyGasStation

#### Safety Checks

The script includes multiple safety mechanisms:

✅ **Environment Validation** - Verifies required environment variables  
✅ **Mainnet Confirmation** - Requires explicit "MAINNET" confirmation  
✅ **Deployment Verification** - Validates all immutable variables  
✅ **Admin Verification** - Confirms deployer has admin rights  
✅ **Address Persistence** - Saves all addresses for recovery  
✅ **Error Handling** - Exits gracefully on any failure

#### Gas Estimates

Approximate gas costs for deployment on testnet:

| Contract | Gas Limit | Estimated Cost (HBAR) |
|----------|-----------|----------------------|
| LAZY SCT | 3,500,000 | ~2-3 |
| LAZY Token Creation | 800,000 | ~20 (mint payment) |
| LazyGasStation | 4,000,000 | ~3-4 |
| LazyDelegateRegistry | 2,100,000 | ~1-2 |
| PRNG | 1,800,000 | ~1-2 |
| LazyLottoStorage | 3,500,000 | ~2-3 |
| LazyLotto | 6,000,000 | ~4-5 |
| Configuration | ~1,000,000 | ~1 |
| **Total** | | **~35-40 HBAR** |

*Note: Mainnet costs may vary based on network congestion*

#### Advanced Usage

**Partial Deployment**

Reuse existing contracts by setting environment variables:

```env
# Reuse existing LAZY ecosystem
LAZY_TOKEN_ID=0.0.12345
LAZY_SCT_CONTRACT_ID=0.0.12346
LAZY_GAS_STATION_CONTRACT_ID=0.0.12347

# Only deploy new contracts
# (script will skip existing ones)
```

**Custom Configuration**

Modify constants in `deployLazyLotto.js`:

```javascript
// Deployment configuration
const LAZY_BURN_PERCENT = 0;      // Change burn percentage
const LAZY_MAX_SUPPLY = 1_000_000_000;  // Change max supply
const LAZY_DECIMAL = 8;            // Change decimals
const MINT_PAYMENT = 20;           // Change mint payment
```

**Network Selection**

Set `ENVIRONMENT` in `.env`:

```env
ENVIRONMENT=test      # Testnet
ENVIRONMENT=main      # Mainnet (requires confirmation)
ENVIRONMENT=preview   # Previewnet
```

#### References

- [LazyLotto Documentation](../../docs/)
- [LazyLotto Testing Plan](../../LazyLotto-TESTING_PLAN.md)
- [LazyLotto Business Logic](../../LazyLotto-BUSINESS_LOGIC.md)
- [LazyLotto UX Implementation Guide](../../LazyLotto-UX_IMPLEMENTATION_GUIDE.md)
- [Code Coverage Analysis](../../LazyLotto-CODE_COVERAGE_ANALYSIS.md)
- [Hedera SDK Documentation](https://docs.hedera.com/hedera/sdks-and-apis/sdks)

---

**Last Updated:** 2025-04-19  
**Script Version:** 1.0.0  
**Compatibility:** LazyLotto v2.0
