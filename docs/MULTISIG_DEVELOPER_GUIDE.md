# LazyLotto Multi-Signature Developer Guide

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Module Reference](#module-reference)
- [Core Components](#core-components)
- [Workflow System](#workflow-system)
- [Key Management](#key-management)
- [Integration Patterns](#integration-patterns)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Development Workflow](#development-workflow)
- [Extension Points](#extension-points)

## Architecture Overview

### Design Principles

The multi-signature system follows these core principles:

1. **Zero Dependencies**: Library is published as `@lazysuperheroes/hedera-multisig` npm package with no project-specific dependencies
2. **Backward Compatibility**: All integrations preserve single-sig functionality
3. **Modern SDK**: Uses only current Hedera SDK methods (no deprecated APIs)
4. **Mixed Key Types**: Supports Ed25519 and ECDSA in same multi-sig setup
5. **Dual Workflows**: Interactive (real-time) and Offline (air-gapped) modes
6. **Security First**: Prompt-based input, encrypted storage, audit logging

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     LazyLotto Admin Scripts                      │
│  (21 scripts in scripts/interactions/LazyLotto/admin/)         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Integration Layer                              │
│  ┌──────────────────────┐  ┌─────────────────────────────────┐ │
│  │ scriptHelpers.js     │  │ multiSigIntegration.js          │ │
│  │ - executeContract    │  │ - contractExecuteFunctionMS     │ │
│  │   Function()         │  │ - parseMultiSigArgs()           │ │
│  │ - checkMultiSigHelp()│  │ - displayMultiSigHelp()         │ │
│  │ - displayBanner()    │  │                                 │ │
│  └──────────────────────┘  └─────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│          Multi-Sig Library (@lazysuperheroes/hedera-multisig)   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Workflow Layer                         │   │
│  │  ┌──────────────────┐  ┌──────────────────────────┐   │   │
│  │  │ Interactive      │  │ Offline Workflow         │   │   │
│  │  │ Workflow         │  │ - Freeze & Export        │   │   │
│  │  │ - Real-time      │  │ - Collect Signatures     │   │   │
│  │  │ - <110s timeout  │  │ - Execute                │   │   │
│  │  └──────────────────┘  └──────────────────────────┘   │   │
│  │           ▲                        ▲                   │   │
│  │           └────────┬───────────────┘                   │   │
│  │                    │                                   │   │
│  │           ┌────────▼────────┐                         │   │
│  │           │ Workflow        │                         │   │
│  │           │ Orchestrator    │                         │   │
│  │           └─────────────────┘                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                             │                                   │
│  ┌─────────────────────────▼────────────────────────────────┐  │
│  │                    Core Layer                            │  │
│  │  ┌───────────────┐ ┌──────────────┐ ┌────────────────┐ │  │
│  │  │ Transaction   │ │ Signature    │ │ Signature      │ │  │
│  │  │ Freezer       │ │ Collector    │ │ Verifier       │ │  │
│  │  └───────────────┘ └──────────────┘ └────────────────┘ │  │
│  │  ┌───────────────┐ ┌──────────────┐ ┌────────────────┐ │  │
│  │  │ Transaction   │ │ Transaction  │ │ Transaction    │ │  │
│  │  │ Executor      │ │ Decoder      │ │ Display        │ │  │
│  │  └───────────────┘ └──────────────┘ └────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             │                                   │
│  ┌─────────────────────────▼────────────────────────────────┐  │
│  │                 Key Management Layer                     │  │
│  │  ┌────────────────┐ ┌─────────────────┐ ┌─────────────┐│  │
│  │  │ Prompt Key     │ │ Encrypted File  │ │ Env Key     ││  │
│  │  │ Provider       │ │ Provider        │ │ Provider    ││  │
│  │  │ (Highest Sec)  │ │ (AES-256-GCM)   │ │ (Dev/Test)  ││  │
│  │  └────────────────┘ └─────────────────┘ └─────────────┘│  │
│  │           ▲                  ▲                 ▲         │  │
│  │           └──────────────────┴─────────────────┘         │  │
│  │                              │                            │  │
│  │                   ┌──────────▼──────────┐                │  │
│  │                   │ Key Provider Base   │                │  │
│  │                   └──────────┬──────────┘                │  │
│  │                              │                            │  │
│  │                   ┌──────────▼──────────┐                │  │
│  │                   │ Key Validator       │                │  │
│  │                   │ - Ed25519           │                │  │
│  │                   │ - ECDSA secp256k1   │                │  │
│  │                   └─────────────────────┘                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      UI Layer                            │  │
│  │  ┌──────────────┐ ┌───────────────┐ ┌───────────────┐  │  │
│  │  │ Progress     │ │ Error         │ │ Help          │  │  │
│  │  │ Indicator    │ │ Formatter     │ │ Text          │  │  │
│  │  └──────────────┘ └───────────────┘ └───────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Package Structure

The multi-sig library is published as `@lazysuperheroes/hedera-multisig` on npm.

**Installation:**
```bash
npm install @lazysuperheroes/hedera-multisig
# or
yarn add @lazysuperheroes/hedera-multisig
```

**Package Contents:**
```
@lazysuperheroes/hedera-multisig/
├── core/                      # Core transaction management
│   ├── TransactionFreezer.js      # Freeze transactions with timeout
│   ├── TransactionDecoder.js      # Decode transaction details
│   ├── SignatureCollector.js      # Collect signatures from multiple sources
│   ├── SignatureVerifier.js       # Cryptographic verification
│   └── TransactionExecutor.js     # Execute signed transactions
│
├── workflows/                 # Workflow orchestration
│   ├── InteractiveWorkflow.js     # Real-time signing (<110s)
│   ├── OfflineWorkflow.js         # Asynchronous signing
│   └── WorkflowOrchestrator.js    # Main entry point
│
├── keyManagement/            # Key handling and security
│   ├── KeyProvider.js             # Abstract base class
│   ├── PromptKeyProvider.js       # Interactive prompts (highest security)
│   ├── EncryptedFileProvider.js   # AES-256-GCM encrypted files
│   ├── EnvKeyProvider.js          # Environment variables (dev/test)
│   └── KeyValidator.js            # Key type detection and validation
│
├── ui/                       # User interface components
│   ├── ProgressIndicator.js       # Timers, spinners, progress bars
│   ├── ErrorFormatter.js          # User-friendly error messages
│   ├── HelpText.js                # Contextual help
│   └── TransactionDisplay.js      # Rich transaction details
│
├── cli/                      # CLI tools (via npx)
│   ├── sign.js                    # Standalone signing tool
│   ├── createKeyFile.js           # Create encrypted key files
│   ├── testKeyFile.js             # Test/validate key files
│   └── securityAudit.js           # Security scanning
│
└── index.js                  # Public API exports

# Project integration layer (in your project):
utils/
├── multiSigIntegration.js    # Project-specific adapter (imports from npm package)
└── scriptHelpers.js          # CLI script utilities
```

## Module Reference

### Core Modules

#### TransactionFreezer.js

**Purpose**: Freeze transactions and manage 110-second timeout.

**Key Methods**:

```javascript
class TransactionFreezer {
  /**
   * Freeze a transaction for multi-sig
   * @param {Transaction} transaction - Hedera transaction
   * @param {Client} client - Hedera client
   * @returns {Promise<{frozenTx, freezeTime, expiryTime}>}
   */
  async freeze(transaction, client);

  /**
   * Check if transaction expired
   * @param {Transaction} transaction - Frozen transaction
   * @returns {boolean}
   */
  isExpired(transaction);

  /**
   * Get time remaining until expiry
   * @param {Transaction} transaction - Frozen transaction
   * @returns {number} Milliseconds remaining
   */
  getTimeRemaining(transaction);
}
```

**Implementation Notes**:
- Uses 110-second timeout (not 119s) for network latency buffer
- Tracks freeze time in transaction metadata
- Validates transaction is not already frozen

#### SignatureCollector.js

**Purpose**: Collect signatures from multiple key providers.

**Key Methods**:

```javascript
class SignatureCollector {
  /**
   * Collect signatures interactively
   * @param {Transaction} transaction - Frozen transaction
   * @param {Array<KeyProvider>} keyProviders - Key sources
   * @param {Object} options - Collection options
   * @returns {Promise<Array<Signature>>}
   */
  async collectInteractive(transaction, keyProviders, options);

  /**
   * Load signatures from files (offline mode)
   * @param {Array<string>} signatureFiles - File paths
   * @returns {Promise<Array<Signature>>}
   */
  async loadSignatures(signatureFiles);

  /**
   * Add signature to transaction
   * @param {Transaction} transaction - Transaction to sign
   * @param {Signature} signature - Signature to add
   */
  addSignature(transaction, signature);
}
```

**Supported Formats**:
- Interactive: Key providers (Prompt, Encrypted File, Env)
- Offline: JSON signature files from CLI signer

#### SignatureVerifier.js

**Purpose**: Cryptographically verify signatures match transaction and accounts.

**Key Methods**:

```javascript
class SignatureVerifier {
  /**
   * Verify signature is valid
   * @param {Transaction} transaction - The transaction
   * @param {Signature} signature - Signature to verify
   * @param {PublicKey} publicKey - Expected public key
   * @returns {boolean}
   */
  verify(transaction, signature, publicKey);

  /**
   * Verify multiple signatures meet threshold
   * @param {Transaction} transaction - The transaction
   * @param {Array<Signature>} signatures - Signatures to verify
   * @param {number} threshold - Required signature count
   * @returns {Object} {valid: boolean, validCount: number, errors: []}
   */
  verifyThreshold(transaction, signatures, threshold);

  /**
   * Extract signer account ID from signature
   * @param {Signature} signature - The signature
   * @returns {AccountId}
   */
  getSignerAccount(signature);
}
```

**Verification Process**:
1. Extract public key from signature
2. Verify signature cryptographically matches transaction bytes
3. Confirm signer account matches expected account
4. Check key type (Ed25519 vs ECDSA)
5. Validate signature not expired

#### TransactionExecutor.js

**Purpose**: Execute signed transactions and create audit logs.

**Key Methods**:

```javascript
class TransactionExecutor {
  /**
   * Execute a signed transaction
   * @param {Transaction} transaction - Fully signed transaction
   * @param {Client} client - Hedera client
   * @param {Object} metadata - Additional logging metadata
   * @returns {Promise<{receipt, record}>}
   */
  async execute(transaction, client, metadata);

  /**
   * Create audit log entry
   * @param {Object} executionDetails - Details to log
   * @returns {Promise<string>} Log file path
   */
  async logExecution(executionDetails);
}
```

**Audit Log Format**:
```json
{
  "timestamp": "2025-12-19T10:30:00.000Z",
  "transactionId": "0.0.98765@1701234567.890",
  "operation": "setPlatformFee",
  "contract": "0.0.123456",
  "parameters": {"percentage": 12},
  "signers": [
    {"account": "0.0.111111", "algorithm": "Ed25519"},
    {"account": "0.0.222222", "algorithm": "ECDSA"}
  ],
  "threshold": "2 of 3",
  "workflow": "interactive",
  "status": "success",
  "receiptStatus": "SUCCESS",
  "gasUsed": 123456
}
```

### Workflow Modules

#### WorkflowOrchestrator.js

**Purpose**: Main entry point for multi-sig operations. Routes to appropriate workflow.

**API**:

```javascript
class WorkflowOrchestrator {
  constructor(client, options) {
    // options: {
    //   defaultWorkflow: 'interactive' | 'offline',
    //   auditLogPath: './logs/audit.log',
    //   exportDir: './multisig-transactions',
    //   verbose: boolean
    // }
  }

  /**
   * Execute a multi-signature transaction
   * @param {Transaction} transaction - Hedera transaction
   * @param {Object} config - Multi-sig configuration
   * @returns {Promise<{success, receipt, record, error?}>}
   */
  async execute(transaction, config);

  /**
   * Freeze and export for offline signing
   * @param {Transaction} transaction - Transaction to freeze
   * @param {Object} metadata - Transaction metadata
   * @returns {Promise<{txFile, jsonFile}>}
   */
  async freezeAndExport(transaction, metadata);

  /**
   * Collect signatures and execute (offline completion)
   * @param {Transaction} frozenTx - Frozen transaction
   * @param {Array<string>} signatureFiles - Signature file paths
   * @param {Object} config - Execution config
   * @returns {Promise<{success, receipt, record, error?}>}
   */
  async collectAndExecute(frozenTx, signatureFiles, config);
}
```

**Config Format**:
```javascript
{
  workflow: 'interactive' | 'offline',
  keyProviders: [KeyProvider, ...],  // For interactive
  signatureFiles: ['sig1.json', ...], // For offline
  threshold: 2,                       // Required signatures
  signerLabels: ['Alice', 'Bob'],     // Optional labels
  metadata: {                         // Additional context
    operation: 'setPlatformFee',
    poolId: 5
  }
}
```

#### InteractiveWorkflow.js

**Purpose**: Real-time multi-sig with <110s timeout.

**Flow**:
```
1. Freeze transaction
2. Display transaction details
3. Start countdown timer (110s)
4. Collect signatures sequentially
5. Verify threshold met
6. Execute transaction
7. Create audit log
```

**API**:

```javascript
class InteractiveWorkflow {
  /**
   * Run interactive workflow
   * @param {Transaction} transaction - Transaction to execute
   * @param {Array<KeyProvider>} keyProviders - Key sources
   * @param {Object} options - Workflow options
   * @returns {Promise<{success, receipt, record}>}
   */
  async run(transaction, keyProviders, options);
}
```

**Options**:
```javascript
{
  threshold: 2,                    // Required signatures (default: all)
  signerLabels: ['Alice', 'Bob'],  // Display names
  timeout: 110000,                 // Override timeout (ms)
  metadata: {}                     // Additional context
}
```

#### OfflineWorkflow.js

**Purpose**: Asynchronous multi-sig with no timeout.

**Flow**:

**Phase 1 (Freeze & Export)**:
```
1. Freeze transaction
2. Encode to bytes
3. Export .tx file (binary transaction)
4. Export .json file (human-readable metadata)
5. Return file paths
```

**Phase 2 (Signing - done separately by each signer)**:
```
1. Load .tx file
2. Decode transaction details
3. Display for review
4. Collect signature from key provider
5. Export signature to .json file
```

**Phase 3 (Execute)**:
```
1. Load frozen transaction
2. Load signature files
3. Verify signatures
4. Check threshold
5. Execute transaction
6. Create audit log
```

**API**:

```javascript
class OfflineWorkflow {
  /**
   * Freeze and export transaction
   * @param {Transaction} transaction - Transaction to freeze
   * @param {Object} metadata - Transaction context
   * @returns {Promise<{txFile, jsonFile}>}
   */
  async freezeAndExport(transaction, metadata);

  /**
   * Collect signatures from files
   * @param {Transaction} transaction - Frozen transaction
   * @param {Array<string>} signatureFiles - Signature file paths
   * @param {number} threshold - Required signatures
   * @returns {Promise<Array<Signature>>}
   */
  async collectSignatures(transaction, signatureFiles, threshold);

  /**
   * Execute with collected signatures
   * @param {Transaction} transaction - Frozen transaction
   * @param {Array<Signature>} signatures - Collected signatures
   * @returns {Promise<{success, receipt, record}>}
   */
  async executeTransaction(transaction, signatures);
}
```

### Key Management Modules

#### KeyProvider (Abstract Base)

**Purpose**: Define interface for all key providers.

```javascript
class KeyProvider {
  /**
   * Get private key from source
   * @param {string} label - Signer label for prompts
   * @returns {Promise<PrivateKey>}
   */
  async getPrivateKey(label);

  /**
   * Get key algorithm
   * @returns {Promise<'Ed25519' | 'ECDSA'| 'Unknown'>}
   */
  async getAlgorithm();

  /**
   * Cleanup resources
   */
  cleanup();
}
```

#### PromptKeyProvider

**Purpose**: Interactive prompt for private keys (highest security).

**Usage**:
```javascript
const provider = new PromptKeyProvider();
const privateKey = await provider.getPrivateKey('Alice');
// Prompts: "Enter private key for Alice: "
```

**Features**:
- Masked input (password-style)
- Validates key format
- Detects Ed25519 vs ECDSA automatically
- Clears memory after use

#### EncryptedFileProvider

**Purpose**: AES-256-GCM encrypted key storage.

**File Format**:
```json
{
  "version": "1.0",
  "algorithm": "aes-256-gcm",
  "keyDerivation": "pbkdf2",
  "iterations": 100000,
  "salt": "base64-encoded-32-bytes",
  "iv": "base64-encoded-16-bytes",
  "encrypted": "base64-encoded-ciphertext",
  "authTag": "base64-encoded-16-bytes"
}
```

**Usage**:
```javascript
const provider = new EncryptedFileProvider('alice.enc');
const privateKey = await provider.getPrivateKey('Alice');
// Prompts: "Enter password for alice.enc: "
```

**Security**:
- AES-256-GCM authenticated encryption
- PBKDF2 key derivation (100,000 iterations)
- Random salt per file
- Random IV per encryption

#### KeyValidator

**Purpose**: Detect and validate key types.

**API**:

```javascript
class KeyValidator {
  /**
   * Parse private key and detect algorithm
   * @param {string} keyString - Hex-encoded key
   * @returns {Promise<{key: PrivateKey, algorithm: string}>}
   */
  static async parsePrivateKey(keyString);

  /**
   * Detect algorithm from DER prefix
   * @param {string} keyString - Hex-encoded key
   * @returns {'Ed25519' | 'ECDSA' | 'Unknown'}
   */
  static detectAlgorithm(keyString);

  /**
   * Validate key format
   * @param {string} keyString - Hex-encoded key
   * @returns {{valid: boolean, error?: string}}
   */
  static validate(keyString);
}
```

**DER Prefix Detection**:
```javascript
const PREFIXES = {
  Ed25519_PRIVATE: '302e',    // 48 bytes total
  ECDSA_PRIVATE: '3030',      // 49 bytes total
  Ed25519_PUBLIC: '302a',     // 44 bytes total
  ECDSA_PUBLIC: '302d'        // 88 bytes total
};
```

**Algorithm**:
1. Try `PrivateKey.fromStringDer()` - works for both types
2. If fails, try `PrivateKey.fromStringED25519()`
3. If fails, try `PrivateKey.fromStringECDSA()`
4. Detect algorithm from DER prefix
5. Return parsed key + algorithm

## Integration Patterns

### Pattern 1: Drop-In Multi-Sig Support

**Before** (Single-Sig Only):
```javascript
const tx = await new ContractExecuteTransaction()
  .setContractId(contractId)
  .setGas(300000)
  .setFunction('myFunction', encodedParams)
  .execute(client);

const receipt = await tx.getReceipt(client);
```

**After** (Single-Sig + Multi-Sig):
```javascript
const { executeContractFunction } = require('../../utils/scriptHelpers');

const result = await executeContractFunction({
  contractId,
  iface: contractInterface,
  client,
  functionName: 'myFunction',
  params: [param1, param2],
  gas: 300000,
  payableAmount: 0
});

if (!result.success) {
  throw new Error(result.error);
}

const { receipt, record } = result;
```

**What Changed:**
- Uses `executeContractFunction()` wrapper
- Automatically detects `--multisig` flag
- Falls back to single-sig if flag absent
- Returns consistent `{success, receipt, record, error}` format

### Pattern 2: Custom Multi-Sig Integration

For full control over multi-sig behavior:

```javascript
const { WorkflowOrchestrator } = require('@lazysuperheroes/hedera-multisig');
const { PromptKeyProvider, EncryptedFileProvider } = require('@lazysuperheroes/hedera-multisig');

// Create orchestrator
const orchestrator = new WorkflowOrchestrator(client, {
  auditLogPath: './logs/audit.log',
  verbose: true
});

// Create transaction
const transaction = new ContractExecuteTransaction()
  .setContractId(contractId)
  .setGas(300000)
  .setFunction('myFunction', encodedParams);

// Configure multi-sig
const config = {
  workflow: 'interactive',
  keyProviders: [
    new PromptKeyProvider(),
    new EncryptedFileProvider('bob.enc'),
    new PromptKeyProvider()
  ],
  threshold: 2,
  signerLabels: ['Alice', 'Bob', 'Charlie'],
  metadata: {
    operation: 'myFunction',
    description: 'Update platform fee to 12%'
  }
};

// Execute
const result = await orchestrator.execute(transaction, config);

if (result.success) {
  console.log('Success:', result.receipt.transactionId);
} else {
  console.error('Failed:', result.error);
}
```

### Pattern 3: Offline Workflow Integration

```javascript
const { OfflineWorkflow } = require('@lazysuperheroes/hedera-multisig');

const workflow = new OfflineWorkflow(client, {
  exportDir: './my-transactions',
  verbose: true
});

// Phase 1: Freeze & Export
const transaction = new ContractExecuteTransaction()
  .setContractId(contractId)
  .setGas(300000)
  .setFunction('withdraw', encodedParams);

const { txFile, jsonFile } = await workflow.freezeAndExport(transaction, {
  operation: 'withdraw',
  amount: '1000 LAZY',
  recipient: '0.0.123456'
});

console.log('Transaction exported:');
console.log('  Binary:', txFile);
console.log('  Metadata:', jsonFile);
console.log('Share these files with signers.');

// ... signers sign offline using CLI tool ...

// Phase 3: Execute with signatures
const signatures = await workflow.collectSignatures(
  transaction,
  ['alice-sig.json', 'bob-sig.json'],
  2
);

const result = await workflow.executeTransaction(transaction, signatures);
```

## API Reference

### Public Exports

From `@lazysuperheroes/hedera-multisig`:

```javascript
module.exports = {
  // Core
  TransactionFreezer,
  TransactionDecoder,
  SignatureCollector,
  SignatureVerifier,
  TransactionExecutor,

  // Workflows
  WorkflowOrchestrator,
  InteractiveWorkflow,
  OfflineWorkflow,

  // Key Management
  KeyProvider,
  PromptKeyProvider,
  EncryptedFileProvider,
  EnvKeyProvider,
  KeyValidator,

  // UI
  ProgressIndicator,
  ErrorFormatter,
  HelpText,
  TransactionDisplay
};
```

### Configuration Objects

#### MultiSigConfig

```typescript
interface MultiSigConfig {
  workflow?: 'interactive' | 'offline';
  keyProviders?: KeyProvider[];      // For interactive
  signatureFiles?: string[];          // For offline
  threshold?: number;                 // Required signatures
  signerLabels?: string[];            // Display names
  metadata?: object;                  // Additional context
  timeout?: number;                   // Override default timeout
  exportDir?: string;                 // Custom export directory
  auditLogPath?: string;              // Custom audit log path
  verbose?: boolean;                  // Detailed logging
}
```

#### KeyProviderOptions

```typescript
interface PromptKeyProviderOptions {
  maskInput?: boolean;  // Default: true
}

interface EncryptedFileProviderOptions {
  filePath: string;     // Path to .enc file
}

interface EnvKeyProviderOptions {
  variableName: string; // Environment variable name
}
```

## Testing

### Test Structure

Tests are included in the npm package and can be run from the package repository:

```
@lazysuperheroes/hedera-multisig/test/
├── keyProviders.test.js       # 28 tests - Key provider functionality
├── multiKeyType.test.js       # 35 tests - Mixed key types
├── workflows.test.js          # Workflow integration
└── keyTypeDetection.js        # SDK method exploration
```

### Running Tests

```bash
# Clone the npm package repository
git clone https://github.com/lazysuperheroes/hedera-multisig.git
cd hedera-multisig

# Install dependencies
npm install

# Run all tests
npm test

# Run specific test files
npm test -- test/keyProviders.test.js
npm test -- test/multiKeyType.test.js
```

### Writing Tests

**Test Template**:

```javascript
const { expect } = require('chai');
const { PromptKeyProvider, KeyValidator } = require('@lazysuperheroes/hedera-multisig');

describe('KeyProvider Tests', () => {
  let provider;

  beforeEach(() => {
    provider = new PromptKeyProvider();
  });

  afterEach(() => {
    provider.cleanup();
  });

  it('should detect Ed25519 key', async () => {
    const testKey = '302e...'; // Ed25519 DER format
    const { key, algorithm } = await KeyValidator.parsePrivateKey(testKey);

    expect(algorithm).to.equal('Ed25519');
    expect(key).to.be.instanceof(PrivateKey);
  });

  it('should detect ECDSA key', async () => {
    const testKey = '3030...'; // ECDSA DER format
    const { key, algorithm } = await KeyValidator.parsePrivateKey(testKey);

    expect(algorithm).to.equal('ECDSA');
    expect(key).to.be.instanceof(PrivateKey);
  });
});
```

### Integration Testing

Test complete multi-sig workflows:

```javascript
describe('Multi-Sig Integration', () => {
  it('should complete interactive workflow', async () => {
    const orchestrator = new WorkflowOrchestrator(client);
    const transaction = new ContractExecuteTransaction()
      .setContractId(testContractId)
      .setGas(100000)
      .setFunction('test', Buffer.from([]));

    const config = {
      workflow: 'interactive',
      keyProviders: [
        new TestKeyProvider(testKey1),
        new TestKeyProvider(testKey2)
      ],
      threshold: 2
    };

    const result = await orchestrator.execute(transaction, config);

    expect(result.success).to.be.true;
    expect(result.receipt).to.exist;
  });
});
```

## Development Workflow

### Adding a New Key Provider

1. **Extend KeyProvider base class**:

```javascript
const { KeyProvider, KeyValidator } = require('@lazysuperheroes/hedera-multisig');

class MyKeyProvider extends KeyProvider {
  constructor(options) {
    super();
    this.options = options;
  }

  async getPrivateKey(label) {
    // Your implementation
    const keyString = await this.fetchKey(label);
    const { key, algorithm } = await KeyValidator.parsePrivateKey(keyString);
    this.algorithm = algorithm;
    return key;
  }

  async getAlgorithm() {
    return this.algorithm || 'Unknown';
  }

  cleanup() {
    // Clean up resources
  }
}
```

2. **Add tests**:

```javascript
describe('MyKeyProvider', () => {
  it('should fetch key correctly', async () => {
    const provider = new MyKeyProvider({...});
    const key = await provider.getPrivateKey('test');
    expect(key).to.exist;
  });
});
```

3. **Export from index.js**:

```javascript
module.exports = {
  // ... existing exports
  MyKeyProvider
};
```

### Adding a New Workflow

1. **Create workflow class**:

```javascript
class MyWorkflow {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
  }

  async run(transaction, config) {
    // Your workflow implementation
  }
}
```

2. **Integrate with orchestrator**:

```javascript
// In WorkflowOrchestrator.js
case 'myworkflow':
  result = await this._executeMyWorkflow(transaction, config);
  break;
```

### Debugging

**Enable verbose logging**:

```javascript
const orchestrator = new WorkflowOrchestrator(client, {
  verbose: true
});
```

**Check audit logs**:

```bash
tail -f logs/audit.log
```

**Use Node debugger**:

```bash
# Debug the sign CLI tool (clone the package repo first)
node --inspect-brk node_modules/@lazysuperheroes/hedera-multisig/cli/sign.js tx-file.tx
```

## Extension Points

### Custom Transaction Decoder

Override transaction decoding for custom contracts:

```javascript
const { TransactionDecoder } = require('@lazysuperheroes/hedera-multisig');

class MyTransactionDecoder extends TransactionDecoder {
  decode(transaction, contractInterface) {
    const baseDecoding = super.decode(transaction, contractInterface);

    // Add custom decoding logic
    return {
      ...baseDecoding,
      customField: this.decodeCustomField(transaction)
    };
  }
}
```

### Custom UI Components

Replace default UI components:

```javascript
const { ProgressIndicator } = require('@lazysuperheroes/hedera-multisig');

class MyProgressIndicator extends ProgressIndicator {
  displayCountdown(timeRemaining) {
    // Custom countdown display
    console.log(`Custom timer: ${timeRemaining}ms`);
  }
}
```

### Custom Audit Logging

Override audit logging:

```javascript
const { TransactionExecutor } = require('@lazysuperheroes/hedera-multisig');

class MyTransactionExecutor extends TransactionExecutor {
  async logExecution(details) {
    // Send to custom logging service
    await myLoggingService.log(details);

    // Also create file log
    return super.logExecution(details);
  }
}
```

## Best Practices

### Error Handling

Always wrap multi-sig operations in try/catch:

```javascript
try {
  const result = await orchestrator.execute(transaction, config);

  if (!result.success) {
    console.error('Transaction failed:', result.error);
    // Handle gracefully
  }
} catch (error) {
  console.error('Unexpected error:', error);
  // Log and alert
}
```

### Timeout Management

For operations that may take >110s, use offline workflow:

```javascript
// Bad: May timeout
const config = { workflow: 'interactive', threshold: 5 };

// Good: No timeout
const config = { workflow: 'offline' };
```

### Key Security

Never log or display private keys:

```javascript
// Bad
console.log('Key:', privateKey.toString());

// Good
console.log('Key loaded:', privateKey.type);
```

### Resource Cleanup

Always cleanup resources:

```javascript
const provider = new EncryptedFileProvider('key.enc');
try {
  const key = await provider.getPrivateKey('Alice');
  // Use key...
} finally {
  provider.cleanup(); // Clear sensitive data from memory
}
```

## Troubleshooting Development Issues

### "Module not found" errors

Ensure the package is installed:

```bash
npm install @lazysuperheroes/hedera-multisig
```

Then use the correct import:

```javascript
// Correct
const { WorkflowOrchestrator } = require('@lazysuperheroes/hedera-multisig');

// Incorrect (old local path - no longer exists)
// const { WorkflowOrchestrator } = require('../lib/multiSig');
```

### Key type detection fails

Use try/catch approach:

```javascript
try {
  return PrivateKey.fromStringDer(keyString);
} catch {
  try {
    return PrivateKey.fromStringED25519(keyString);
  } catch {
    return PrivateKey.fromStringECDSA(keyString);
  }
}
```

### Tests fail with timeout

Increase Mocha timeout in test:

```javascript
it('should complete workflow', async function() {
  this.timeout(30000); // 30 seconds
  // Test code...
});
```

## Performance Considerations

### Signature Collection

Interactive mode collects signatures sequentially. For >3 signers, consider offline mode.

### Key Derivation

Encrypted file decryption uses PBKDF2 with 100,000 iterations (~100ms). Cache decrypted keys when possible:

```javascript
let cachedKey;

async function getKey() {
  if (!cachedKey) {
    const provider = new EncryptedFileProvider('key.enc');
    cachedKey = await provider.getPrivateKey('Alice');
  }
  return cachedKey;
}
```

### Transaction Encoding

Transaction serialization is CPU-intensive. Freeze once, reuse frozen transaction:

```javascript
const frozenTx = await freezer.freeze(transaction, client);

// Reuse frozenTx multiple times
await signatureCollector.collect(frozenTx, providers);
```

## Additional Resources

- **User Guide**: `docs/MULTISIG_USER_GUIDE.md`
- **Admin Integration**: `docs/MULTISIG_ADMIN_INTEGRATION.md`
- **Security Analysis**: `docs/MULTISIG_SECURITY.md`
- **npm Package**: https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig
- **GitHub Repository**: https://github.com/lazysuperheroes/hedera-multisig
- **Hedera SDK Docs**: https://docs.hedera.com/hedera/sdks-and-apis/sdks
