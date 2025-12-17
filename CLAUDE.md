# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hedera smart contract project implementing two lottery systems: **LazyLotto** (multi-pool lottery with flexible prize management) and **LazyTradeLotto** (trade-based reward system). Built on Hedera network using Solidity 0.8.18, with extensive JavaScript testing and interaction scripts.

## Development Commands

### Build and Compilation
```bash
npx hardhat compile              # Compile all contracts (with optimizer + viaIR)
node scripts/deployments/extractABI.js  # Extract ABIs after compilation
```

### Testing
```bash
npm test                         # Run all test suites
npm run test-lotto               # LazyLotto.test.js only
npm run test-trade-lotto         # LazyTradeLotto.test.js only
npm run test-lotto-pool-manager  # LazyLottoPoolManager.test.js only
npm run test-delegate            # LazyDelegateRegistry.test.js only
npm run test-lazy                # LAZYTokenCreator.test.js only

REPORT_GAS=true npx hardhat test # Run with gas reporting
npx hardhat coverage             # Generate coverage report
```

### Code Quality
```bash
npx solhint 'contracts/**/*.sol' # Lint Solidity contracts
npx eslint scripts/ test/ utils/ # Lint JavaScript files
```

### Deployment
```bash
# Deploy to testnet (requires .env configuration)
npx hardhat run scripts/deployments/deployLazyTradeLotto.js --network testnet

# Note: LazyLotto deployment handled via specialized scripts
# See scripts/deployments/ for full deployment procedures
```

### Interaction Scripts
```bash
# Query operations (no gas cost)
node scripts/interactions/LazyLotto/queries/masterInfo.js 0.0.CONTRACT_ID
node scripts/interactions/LazyTradeLotto/queries/getLottoInfo.js 0.0.CONTRACT_ID

# Admin operations (requires owner private key in .env)
node scripts/interactions/LazyLotto/admin/createPool.js 0.0.CONTRACT_ID [params]
node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js 0.0.CONTRACT_ID [amount]

# User operations
node scripts/interactions/LazyLotto/user/buyEntry.js 0.0.CONTRACT_ID [poolId] [count]
```

See `scripts/interactions/README.md` for complete script documentation (41 scripts organized by contract).

## Architecture Overview

### Core Contract Hierarchy

**LazyLotto System** (Multi-Pool Lottery):
- `LazyLotto.sol` - Main lottery contract (23.7KB, near size limit)
- `LazyLottoPoolManager.sol` - Community pool creation and management
- `LazyLottoStorage.sol` - Handles all HTS (Hedera Token Service) operations
- Supports two ticket modes: memory-based (gas efficient) and NFT-based (tradeable)
- Uses paginated queries for scalability (100+ prizes/pools)
- Prize types: HBAR, HTS tokens, NFTs (convertible to prize NFTs)

**LazyTradeLotto System** (Trade-Based Rewards):
- `LazyTradeLotto.sol` - Signature-gated lottery triggered by NFT trades
- Progressive jackpot with automatic growth
- Cryptographic validation via system wallet signature
- Anti-replay protection with trade fingerprinting

**Supporting Infrastructure**:
- `LazyGasStation.sol` - Automatic HBAR/$LAZY refills for contract operations
- `LazyDelegateRegistry.sol` - NFT delegation for bonus calculations
- `PrngSystemContract.sol` - Hedera's verifiable random number generation
- `HederaTokenService.sol` / `HederaTokenServiceLite.sol` - HTS integration wrappers

### Key Architectural Patterns

1. **Library Separation for Size Management**: LazyLotto delegates HTS operations to LazyLottoStorage to stay under 24KB contract size limit

2. **Storage Contract Pattern**: Users approve tokens to LazyLottoStorage address, not the main contract

3. **Dual-Layer Pool Management**: LazyLotto creates "global pools" (team-owned), LazyLottoPoolManager enables "community pools" (user-created with fees)

4. **Signature-Gated Design**: LazyTradeLotto requires systemWallet signature for roll parameters to prevent gaming (signature includes trade details + entropy)

5. **Multi-Admin with Last-Admin Protection**: LazyLotto uses role-based access control with safeguards against removing the last admin

6. **Paginated Queries**: All large-array queries use offset/limit parameters to handle 100+ items without gas issues

## Critical Implementation Details

### Hedera-Specific Considerations

1. **HTS Token Operations**: Use `HederaTokenService` precompile (0x167) for native token operations. All HTS calls return status codes from `HederaResponseCodes.sol`.

2. **PRNG Integration**: Random numbers obtained via `PrngSystemContract` at 0x169. Returns pseudo-random seed that must be processed for game mechanics.

3. **Token Association**: Users must associate tokens before receiving them. Scripts use `associateToken()` via Hedera SDK before transfers.

4. **Allowance System**: HTS tokens require explicit allowances. Scripts must set allowances to LazyLottoStorage address (not LazyLotto).

5. **Gas Optimization**: Batch operations critical due to Hedera's gas model. Use `batchMintNFT`, `batchTransferNFT` from LazyLottoStorage.

### Smart Contract Constraints

1. **Contract Size Limit**: Hedera enforces 24KB limit. LazyLotto at 23.782KB required library extraction and optimizer tuning (`viaIR: true`, `runs: 200`).

2. **ReentrancyGuard**: Applied to ALL state-changing functions in both LazyLotto and LazyLottoPoolManager.

3. **Pausability**: Both lottery contracts inherit OpenZeppelin's Pausable. Prize claims allowed even when paused.

4. **Fee Immutability**: Platform fee % locked at pool creation (stored per-pool) to prevent retroactive changes.

### JavaScript Utilities Architecture

**Location**: `utils/` folder contains shared helpers used across scripts and tests

Key modules:
- `hederaHelpers.js` - Account creation, token operations, NFT minting
- `hederaMirrorHelpers.js` - Mirror node API queries for events/transactions
- `transactionHelpers.js` - Transaction building and execution wrappers
- `solidityHelpers.js` - ABI encoding/decoding, contract interaction
- `gasHelpers.js` - Gas estimation and management
- `nodeHelpers.js` - Hedera node connection and client setup
- `LazyNFTStakingHelper.js` / `LazyFarmingHelper.js` - Legacy staking system utilities

**Pattern**: Scripts in `scripts/interactions/` import from utils, initialize Hedera client, load contract ABIs, and execute contract calls using Hedera SDK's `ContractExecuteTransaction`.

## Testing Architecture

### Test Structure

All tests in `test/` use Hardhat's local Hedera node with Hardhat Chai matchers:
- `LazyLotto.test.js` - 50+ test cases covering pools, tickets, prizes, bonuses, pagination
- `LazyTradeLotto.test.js` - Signature validation, jackpot mechanics, LSH NFT benefits
- `LazyLottoPoolManager.test.js` - Community pool creation, ownership, fee handling
- `LazyDelegateRegistry.test.js` - NFT delegation and registry operations

**Mocha Config**: 100-second timeout per test, 100-second slow threshold (in hardhat.config.js)

### Testing Pattern

1. Deploy contracts in `beforeEach` hook
2. Create test accounts via `accountCreator()` from utils
3. Associate tokens using Hedera SDK's `TokenAssociateTransaction`
4. Execute contract calls via `ContractExecuteTransaction`
5. Verify state via contract queries and event emissions
6. Use deterministic PRNG for predictable test outcomes

**Important**: Tests mock PRNG responses for deterministic behavior. Production uses Hedera's PRNG (0x169 precompile).

## Environment Configuration

### Required .env Variables

```env
ENVIRONMENT=testnet              # testnet, mainnet, preview, or local
ACCOUNT_ID=0.0.xxxxx            # Your Hedera account ID
PRIVATE_KEY=302e...             # ED25519 private key (hex format)

# Contract addresses (post-deployment)
LAZY_LOTTO_CONTRACT_ID=0.0.xxxxx
LAZY_LOTTO_STORAGE=0.0.xxxxx
LAZY_TRADE_LOTTO_CONTRACT_ID=0.0.xxxxx
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.xxxxx
LAZY_GAS_STATION_CONTRACT_ID=0.0.xxxxx
LAZY_SCT_CONTRACT_ID=0.0.xxxxx  # LazySecureTrade (triggers TradeLotto)

# Token configuration
LAZY_TOKEN_ID=0.0.xxxxx         # $LAZY token ID
LAZY_DECIMALS=8
LSH_GEN1_TOKEN_ID=0.0.xxxxx     # LSH NFT collections for benefits
LSH_GEN2_TOKEN_ID=0.0.xxxxx
LSH_GEN1_MUTANT_TOKEN_ID=0.0.xxxxx

# System configuration
PRNG_CONTRACT_ID=0.0.8257116    # Hedera PRNG precompile
SIGNING_KEY=...                  # ECDSA key for LazyTradeLotto signature validation

# Deployment parameters
INITIAL_LOTTO_JACKPOT=2000      # In whole $LAZY units
LOTTO_LOSS_INCREMENT=50         # Jackpot increment on losses
```

Copy from `.env.example` and populate with your credentials.

## Security and Admin Powers

### What Admins Can Do
- Pause/unpause system for emergencies
- Create global pools with no creation fees
- Set platform fee % (capped at 25% maximum)
- Configure bonus systems (time windows, NFT holdings, $LAZY balance)
- Close malicious/abandoned pools (only if no outstanding entries)
- Withdraw platform fees (default 5% of pool proceeds)

### What Admins Cannot Do
- Steal prizes (enforced by contract math: `storageBalance - withdrawal >= prizesOwed`)
- Change fees retroactively (fee % frozen at pool creation)
- Withdraw prize-obligated tokens (safety checks prevent this)
- Access users' NFT tickets (users maintain custody)
- Prevent prize claims (claimable even when paused)

### Security Features
- ReentrancyGuard on all state-changing functions
- Multi-admin support with last-admin protection
- Platform fee cap (25% maximum)
- Prize obligation tracking prevents rug-pulls
- Signature validation in LazyTradeLotto prevents unauthorized rolls
- Anti-replay protection via trade fingerprinting

See `LazyLotto-SECURITY_ANALYSIS.md` for comprehensive security analysis.

## Breaking Changes and Migrations

**December 2025 - LazyLotto API v2.1**: Contract updated with paginated query functions to handle 100+ prizes/pools without gas issues. See `LazyLotto-API_BREAKING_CHANGES.md` for migration guide.

**Key Changes**:
- All large-array queries now accept `offset` and `limit` parameters
- `getUserPendingPrizes()` → paginated version required for users with 50+ prizes
- `getPoolPrizes()` → paginated for pools with 100+ prize packages
- Scripts updated to handle pagination automatically

## Documentation Structure

**Business/Product Docs** (root directory):
- `README.md` - Comprehensive project overview
- `LazyLotto-BUSINESS_LOGIC.md` - Game mechanics and use cases
- `LazyTradeLotto-BUSINESS_LOGIC.md` - Trade lottery design
- `LazyLotto-UX_IMPLEMENTATION_GUIDE.md` - User experience flows
- `LazyLotto-TESTING_PLAN.md` - Test strategy and coverage
- `LazyLotto-SECURITY_ANALYSIS.md` - Security analysis
- `LazyLotto-API_BREAKING_CHANGES.md` - Migration guide

**Technical Docs** (inline):
- NatSpec comments in all contract files
- README.md in `scripts/interactions/` (41 scripts documented)
- README.md in `scripts/deployments/`
- Generated HTML docs in `docs/` folder

**Testing Docs**:
- `LazyLotto-CODE_COVERAGE_ANALYSIS.md` - Line-by-line coverage analysis

## Common Pitfalls

1. **Allowances**: Users must approve LazyLottoStorage address (NOT LazyLotto address) for token spending
2. **Token Association**: Always associate tokens before attempting transfers on Hedera
3. **Contract Size**: When modifying LazyLotto, watch contract size (23.782KB / 24KB). May need to extract more logic to libraries.
4. **Signature Validation**: LazyTradeLotto rolls require valid systemWallet signature with correct nonce + trade parameters
5. **Pagination**: When querying large datasets, always use offset/limit parameters to avoid gas issues
6. **HTS Response Codes**: Check return values from HTS operations (don't assume success). Use HederaResponseCodes mapping.
7. **PRNG Seed Processing**: Raw PRNG seed must be hashed with nonces for different random values (see LazyLotto's `_processPRNG()`)
8. **Pool Fee Lock-In**: Platform fee % cannot be changed after pool creation (per-pool immutable field)

## Quick Reference

### Contract Addresses
All contract IDs use Hedera's format: `0.0.XXXXXX` (e.g., `0.0.123456`)

### Token Standards
- HBAR represented as `address(0)` in contracts
- HTS tokens identified by their Hedera token address (converted from 0.0.X format)
- NFTs: serialNumber + token address identifies unique NFT

### Script Organization
```
scripts/interactions/
├── LazyLotto/              # 22 scripts
│   ├── admin/              # Pool management, configuration
│   ├── queries/            # Read-only queries
│   └── user/               # User actions (buy, roll, claim)
├── LazyTradeLotto/         # 12 scripts
│   ├── admin/              # Jackpot, configuration
│   └── queries/            # Contract state queries
├── LazyDelegateRegistry/   # 2 scripts
├── LazyGasStation/         # 1 script
├── LazySecureTrade/        # 3 scripts
└── Utilities/              # 1 script
```

### Hardhat Network Configuration
- Local Hedera node for testing (no external network config in hardhat.config.js)
- Optimizer: enabled with 200 runs, viaIR mode for size optimization
- Contract size checking enabled (strict mode)
- Auto-generate documentation on compile
