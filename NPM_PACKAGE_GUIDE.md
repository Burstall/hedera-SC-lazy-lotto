# LazyLotto NPM Package Guide

**Purpose:** This document outlines the NPM package structure for the LazyLotto smart contracts, enabling dApp integration and providing contract ABIs, utilities, and types for frontend development.

---

## Package Overview

**Proposed Package Name:** `@lazysuperheroes/lazy-lotto-contracts`

**What This Package Provides:**
- Contract ABIs for all LazyLotto system contracts
- TypeScript type definitions (generated via TypeChain)
- Utility functions for common operations
- Reference patterns from interaction scripts

---

## Package Structure

```
@lazysuperheroes/lazy-lotto-contracts/
├── dist/                          # Compiled output
│   ├── abi/                       # Contract ABIs
│   ├── types/                     # Generated TypeScript types
│   └── utils/                     # Compiled utility functions
├── src/
│   ├── abi/                       # Source ABI JSON files
│   │   ├── LazyLotto.json
│   │   ├── LazyLottoStorage.json
│   │   ├── LazyLottoPoolManager.json
│   │   ├── LazyTradeLotto.json
│   │   ├── LazyDelegateRegistry.json
│   │   ├── LazyGasStation.json
│   │   └── HederaTokenService.json
│   ├── types/                     # TypeChain generated types
│   │   ├── LazyLotto.ts
│   │   ├── LazyLottoStorage.ts
│   │   ├── LazyTradeLotto.ts
│   │   └── index.ts
│   ├── utils/                     # Utility functions
│   │   ├── hederaMirrorHelpers.ts
│   │   ├── solidityHelpers.ts
│   │   ├── transactionHelpers.ts
│   │   └── index.ts
│   └── index.ts                   # Main entry point
├── examples/                      # Integration examples
│   ├── user-flows/
│   │   ├── buyEntry.ts
│   │   ├── rollTickets.ts
│   │   └── claimPrize.ts
│   └── admin-flows/
│       ├── createPool.ts
│       └── addPrizes.ts
├── docs/                          # Package documentation
│   ├── USER_UX_GUIDE.md          # → LazyLotto-UX_IMPLEMENTATION_GUIDE.md
│   └── ADMIN_UX_GUIDE.md         # → LazyLotto-ADMIN_UX_IMPLEMENTATION_GUIDE.md
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## Contract ABIs Included

### Core Contracts

| Contract | ABI File | Size | Purpose |
|----------|----------|------|---------|
| **LazyLotto** | LazyLotto.json | ~51KB | Main lottery contract - all user/admin interactions |
| **LazyLottoStorage** | LazyLottoStorage.json | ~21KB | Token custody (internal, not called directly) |
| **LazyLottoPoolManager** | LazyLottoPoolManager.json | ~34KB | Community pool management |
| **LazyTradeLotto** | LazyTradeLotto.json | ~20KB | Trade-triggered lottery |
| **LazyDelegateRegistry** | LazyDelegateRegistry.json | ~17KB | NFT delegation |
| **LazyGasStation** | LazyGasStation.json | ~24KB | Gas fee sponsorship |

### Supporting Contracts

| Contract | Purpose |
|----------|---------|
| HederaTokenService | HTS precompile interface |
| PrngSystemContract | Hedera VRF interface |

---

## Exported Utilities

### Mirror Node Helpers (`hederaMirrorHelpers`)

```typescript
// Balance queries
export function checkMirrorBalance(env: string, accountId: string, tokenId: string): Promise<bigint>;
export function checkMirrorHbarBalance(env: string, accountId: string): Promise<bigint>;
export function checkMirrorAllowance(env: string, owner: string, spender: string, tokenId: string): Promise<bigint>;

// NFT queries
export function getSerialsOwned(env: string, accountId: string, tokenId: string): Promise<number[]>;
export function getNFTInfo(env: string, tokenId: string, serial: number): Promise<NFTInfo>;

// Token queries
export function getTokenDetails(env: string, tokenId: string): Promise<TokenDetails>;

// Transaction queries
export function getContractResultWithRetry(env: string, transactionId: string): Promise<ContractResult>;
export function getTransactionStatusWithRetry(env: string, transactionId: string): Promise<TransactionStatus>;
```

### Solidity Helpers (`solidityHelpers`)

```typescript
// Error handling
export function parseError(error: unknown, iface: Interface): ParsedError;
export function parseErrorTransactionId(error: unknown): string | null;

// Contract execution
export function contractExecuteQuery(client: Client, contractId: string, encoded: string): Promise<string>;
export function contractExecuteFunction(client: Client, contractId: string, gas: number, encoded: string): Promise<TransactionResponse>;

// Gas estimation
export function estimateGas(env: string, contractId: string, encoded: string, operatorId: string): Promise<number>;
```

### Transaction Helpers (`transactionHelpers`)

```typescript
// Transaction analysis
export function parseTransactionRecord(record: TransactionRecord): ParsedRecord;
export function analyzeTransactionFailure(receipt: TransactionReceipt): FailureAnalysis;
export function formatTransactionAnalysis(analysis: FailureAnalysis): string;
```

---

## TypeScript Types

### Generated via TypeChain

```typescript
// Pool types
export interface Pool {
  ticketCID: string;
  winCID: string;
  winRateThousandthsOfBps: bigint;
  entryFee: bigint;
  feeToken: string;
  poolTokenId: string;
  paused: boolean;
  closed: boolean;
}

// Prize types
export interface PrizePackage {
  token: string;
  amount: bigint;
  nftTokens: string[];
  nftSerials: bigint[][];
}

// Pending prize types
export interface PendingPrize {
  poolId: bigint;
  prize: PrizePackage;
  asNFT: boolean;
}

// Bonus types
export interface TimeBonus {
  start: bigint;
  end: bigint;
  bonusBps: number;
}
```

---

## Usage Examples

### Installation

```bash
npm install @lazysuperheroes/lazy-lotto-contracts
# or
yarn add @lazysuperheroes/lazy-lotto-contracts
```

### Basic Usage

```typescript
import {
  LazyLottoABI,
  LazyLottoPoolManagerABI,
  checkMirrorBalance,
  parseError
} from '@lazysuperheroes/lazy-lotto-contracts';
import { ethers } from 'ethers';

// Create contract instance
const lazyLotto = new ethers.Contract(
  LAZY_LOTTO_ADDRESS,
  LazyLottoABI,
  signer
);

// Query pool info
const poolInfo = await lazyLotto.getPoolBasicInfo(0);

// Check user balance via mirror node
const balance = await checkMirrorBalance(
  'testnet',
  userAccountId,
  tokenId
);

// Handle errors
try {
  await lazyLotto.buyEntry(poolId, ticketCount, { value: cost });
} catch (error) {
  const parsed = parseError(error, lazyLotto.interface);
  console.error(`Transaction failed: ${parsed.reason}`);
}
```

### User Flow: Buy and Roll

```typescript
import {
  LazyLottoABI,
  checkMirrorHbarBalance,
  estimateGas
} from '@lazysuperheroes/lazy-lotto-contracts';

async function buyAndRoll(poolId: number, ticketCount: number) {
  const lazyLotto = new ethers.Contract(address, LazyLottoABI, signer);

  // Get pool info
  const poolInfo = await lazyLotto.getPoolBasicInfo(poolId);
  const totalCost = poolInfo.entryFee * BigInt(ticketCount);

  // Check balance
  const balance = await checkMirrorHbarBalance('testnet', userAccount);
  if (balance < totalCost) {
    throw new Error('Insufficient HBAR');
  }

  // Estimate gas with 1.5x multiplier for roll operations
  const gasEstimate = await estimateGas('testnet', contractId, encodedCall, operatorId);
  const gasLimit = Math.ceil(gasEstimate * 1.5 * 1.2); // 1.5x for PRNG + 20% buffer

  // Execute
  const tx = await lazyLotto.buyAndRollEntry(poolId, ticketCount, {
    value: totalCost,
    gasLimit
  });

  const receipt = await tx.wait();
  return parseRollResults(receipt);
}
```

### Admin Flow: Create Pool

```typescript
import {
  LazyLottoABI,
  LazyLottoPoolManagerABI
} from '@lazysuperheroes/lazy-lotto-contracts';

async function createPool(config: PoolConfig) {
  const lazyLotto = new ethers.Contract(address, LazyLottoABI, signer);
  const poolManager = new ethers.Contract(pmAddress, LazyLottoPoolManagerABI, signer);

  // Check if global admin (no fees) or community creator (pays fees)
  const isAdmin = await lazyLotto.isAdmin(userAddress);
  const [hbarFee, lazyFee] = await poolManager.getCreationFees();

  const tx = await lazyLotto.createPool(
    config.ticketCID,
    config.winCID,
    config.winRate,
    config.entryFee,
    config.feeToken,
    config.prizes,
    config.tokenName,
    config.tokenSymbol,
    config.tokenMemo,
    { value: isAdmin ? 0 : hbarFee }
  );

  const receipt = await tx.wait();
  return parsePoolCreatedEvent(receipt);
}
```

---

## Integration with dApp

### Recommended Architecture

```
dApp Project/
├── src/
│   ├── contracts/              # Contract interaction layer
│   │   ├── lazyLotto.ts       # Uses @lazysuperheroes/lazy-lotto-contracts
│   │   └── poolManager.ts
│   ├── hooks/                  # React hooks for contract calls
│   │   ├── useLazyLotto.ts
│   │   └── usePoolManager.ts
│   ├── services/               # Business logic services
│   │   ├── poolService.ts
│   │   └── prizeService.ts
│   └── components/             # UI components
│       ├── PoolList.tsx
│       └── PrizeDisplay.tsx
├── package.json
└── tsconfig.json
```

### Contract Layer Example

```typescript
// src/contracts/lazyLotto.ts
import {
  LazyLottoABI,
  checkMirrorBalance,
  parseError
} from '@lazysuperheroes/lazy-lotto-contracts';
import { ethers } from 'ethers';

export class LazyLottoClient {
  private contract: ethers.Contract;
  private env: string;

  constructor(address: string, signer: ethers.Signer, env: string) {
    this.contract = new ethers.Contract(address, LazyLottoABI, signer);
    this.env = env;
  }

  async getPoolInfo(poolId: number) {
    const info = await this.contract.getPoolBasicInfo(poolId);
    return {
      ticketCID: info[0],
      winCID: info[1],
      winRate: info[2],
      entryFee: info[3],
      prizeCount: Number(info[4]),
      outstandingEntries: Number(info[5]),
      poolTokenId: info[6],
      paused: info[7],
      closed: info[8],
      feeToken: info[9]
    };
  }

  async buyEntry(poolId: number, count: number, value: bigint) {
    try {
      const tx = await this.contract.buyEntry(poolId, count, { value });
      return await tx.wait();
    } catch (error) {
      const parsed = parseError(error, this.contract.interface);
      throw new Error(parsed.reason);
    }
  }

  // ... more methods
}
```

---

## Documentation References

The package includes references to the full implementation guides:

| Document | Description |
|----------|-------------|
| [USER_UX_GUIDE.md](./LazyLotto-UX_IMPLEMENTATION_GUIDE.md) | Complete user-facing flow implementation |
| [ADMIN_UX_GUIDE.md](./LazyLotto-ADMIN_UX_IMPLEMENTATION_GUIDE.md) | Admin operations and community pool management |
| [BUSINESS_LOGIC.md](./LazyLotto-BUSINESS_LOGIC.md) | Game mechanics and rules |
| [SECURITY_ANALYSIS.md](./LazyLotto-SECURITY_ANALYSIS.md) | Security model and admin powers |

---

## Building the Package

### Prerequisites

```bash
# Install dependencies
npm install

# Compile contracts (generates ABIs)
npx hardhat compile

# Extract ABIs
node scripts/deployments/extractABI.js

# Generate TypeScript types
npx typechain --target ethers-v6 --out-dir src/types 'abi/**/*.json'
```

### Publishing

```bash
# Build package
npm run build

# Test locally
npm pack

# Publish to npm
npm publish --access public
```

---

## Version Compatibility

| Package Version | Contract Version | Notes |
|-----------------|------------------|-------|
| 1.0.x | v3.0 (Community Pools) | Current |
| - | v2.1 (Pagination) | Included in 1.0.x |

---

## Dependencies

### Peer Dependencies

```json
{
  "peerDependencies": {
    "@hashgraph/sdk": "^2.18.0",
    "ethers": "^6.7.0"
  }
}
```

### Optional Dependencies

```json
{
  "optionalDependencies": {
    "axios": "^1.5.0"  // For mirror node queries
  }
}
```

---

## Support

- **Source Repository:** https://github.com/lazysuperheroes/hedera-SC-lazy-lotto
- **Multi-Sig Package:** [@lazysuperheroes/hedera-multisig](https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig)
- **Issues:** GitHub Issues

---

*This package is maintained by the Lazy Superheroes team.*
