# LazyLotto & LazyTradeLotto Multi-Signature User Guide

## Table of Contents
- [Introduction](#introduction)
- [Why Multi-Signature?](#why-multi-signature)
- [Supported Contracts](#supported-contracts)
- [Quick Start](#quick-start)
- [Key Concepts](#key-concepts)
- [Workflows](#workflows)
- [Usage Examples](#usage-examples)
- [Key Management](#key-management)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

## Introduction

The Multi-Signature system allows multiple parties to jointly approve and execute administrative operations on LazyLotto and LazyTradeLotto smart contracts. This provides enhanced security and shared governance for high-value operations.

### Supported Contracts

Multi-signature support is available for both lottery contracts:

| Contract | Admin Scripts | Description |
|----------|---------------|-------------|
| **LazyLotto** | 9 scripts | Multi-pool lottery with prize NFTs |
| **LazyTradeLotto** | 8 scripts | Trade-based lottery with jackpot |

All admin scripts in both contracts support the `--multisig` flag with identical behavior.

### What You Can Do

- ✅ Require multiple approvals for critical operations (pool creation, fee changes, withdrawals)
- ✅ Sign transactions on air-gapped machines for maximum security
- ✅ Mix Ed25519 and ECDSA key types in the same multi-sig setup
- ✅ Use interactive mode for real-time coordination or offline mode for asynchronous signing
- ✅ Maintain complete backward compatibility (single-sig still works)

### System Requirements

- Node.js 16+ or compatible JavaScript runtime
- Hedera SDK v2.75.0+
- Access to LazyLotto admin scripts
- Private keys for authorized signers

## Why Multi-Signature?

### Security Benefits

**No Single Point of Failure**: An attacker must compromise multiple private keys instead of just one.

**Shared Responsibility**: Critical decisions require consensus from multiple stakeholders.

**Air-Gapped Signing**: Signers can keep private keys on offline machines, never exposing them to the network.

**Audit Trail**: All multi-sig operations are logged with details about signers, timestamps, and transaction contents.

### Use Cases

| Scenario | Recommended Setup |
|----------|-------------------|
| Treasury management | 2-of-3 multi-sig with offline signing |
| Platform fee changes | 3-of-5 multi-sig with interactive mode |
| Emergency pool closure | 2-of-2 multi-sig for fast response |
| Prize pool funding | 2-of-3 multi-sig with encrypted key files |
| Role management | 3-of-4 multi-sig with manual approval |

## Quick Start

### 30-Second Interactive Multi-Sig

Run any admin script with the `--multisig` flag:

```bash
# Instead of single-signature:
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10

# Use multi-signature:
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10 --multisig
```

**What happens:**
1. Transaction is frozen (no longer modifiable)
2. System displays transaction details for review
3. Each signer is prompted to enter their private key
4. After all signatures collected, transaction executes
5. Audit log created with full transaction details

### 5-Minute Offline Multi-Sig Setup

For maximum security with air-gapped signing:

```bash
# Step 1: Create encrypted key files (one-time setup)
npx @lazysuperheroes/hedera-multisig create-key-file
# Creates alice.enc with AES-256-GCM encryption

# Step 2: Freeze and export transaction
node scripts/interactions/LazyLotto/admin/createPool.js --multisig --export-only
# Creates .tx and .json files in multisig-transactions/

# Step 3: Signers sign on their machines (can be offline)
npx @lazysuperheroes/hedera-multisig sign multisig-transactions/tx-12345.tx
# Creates signature-alice.json

# Step 4: Execute with collected signatures
node scripts/interactions/LazyLotto/admin/createPool.js --multisig --offline \
  --signatures=signature-alice.json,signature-bob.json
```

## Key Concepts

### Threshold Signatures

A **threshold signature scheme** (e.g., 2-of-3) means:
- 3 authorized signers total
- Only 2 signatures needed to execute
- Any 2 out of the 3 can approve

**Common patterns:**
- `2-of-2`: Both parties must agree (partnerships)
- `2-of-3`: Majority required, one can be offline
- `3-of-5`: Board-style governance
- `4-of-7`: Large organization with redundancy

### Transaction Lifecycle

```
┌──────────────┐
│ Create TX    │ Script builds transaction
└──────┬───────┘
       │
┌──────▼───────┐
│ Freeze TX    │ Transaction locked, 110s timeout starts
└──────┬───────┘
       │
┌──────▼───────┐
│ Collect Sigs │ Gather required signatures
└──────┬───────┘
       │
┌──────▼───────┐
│ Verify Sigs  │ Cryptographically validate signatures
└──────┬───────┘
       │
┌──────▼───────┐
│ Execute TX   │ Submit to Hedera network
└──────┬───────┘
       │
┌──────▼───────┐
│ Audit Log    │ Record operation details
└──────────────┘
```

### Workflows

**Interactive Workflow**: All signers available in real-time (<110 seconds)
- Best for: Scheduled coordination, emergency operations
- Pros: Fast, simple
- Cons: All signers must be online simultaneously

**Offline Workflow**: Asynchronous signing over any time period
- Best for: Air-gapped security, distributed teams, timezone differences
- Pros: Maximum security, no time pressure, offline signing
- Cons: Multi-step process

### Key Types

The system supports mixed key types in a single multi-sig setup:

- **Ed25519**: Hedera's default, fast signing
- **ECDSA secp256k1**: Ethereum-compatible, common in hardware wallets

**Example**: 2-of-3 with 1 Ed25519 + 2 ECDSA signers works perfectly.

## Workflows

### Interactive Workflow (Real-Time)

**When to use:**
- Team available simultaneously
- Good internet connectivity
- Time-sensitive operations
- <110 second coordination possible

**Step-by-Step:**

```bash
# 1. Start the script with --multisig
node scripts/interactions/LazyLotto/admin/closePool.js 5 --multisig --threshold=2

# 2. Review transaction details displayed
# ┌─────────────────────────────────────────┐
# │ Multi-Signature Transaction             │
# ├─────────────────────────────────────────┤
# │ Contract: 0.0.123456                    │
# │ Function: closePool                     │
# │ Parameters:                             │
# │   poolId: 5                             │
# │ Threshold: 2 of 3 signatures required  │
# │ Timeout: 110 seconds                    │
# └─────────────────────────────────────────┘

# 3. First signer enters private key when prompted
# Enter private key for Signer 1: ***************
# ✅ Signature 1 collected (Ed25519)

# 4. Second signer enters private key
# Enter private key for Signer 2: ***************
# ✅ Signature 2 collected (ECDSA)
# ✅ Threshold met (2/3)

# 5. Transaction executes automatically
# ✅ Transaction executed: 0.0.98765@1234567890.123456789
# 📝 Audit log: logs/audit.log
```

**Interactive Mode Options:**

```bash
# Specify custom threshold
--multisig --threshold=2

# Label signers for clarity
--multisig --signers=Alice,Bob,Charlie

# Use encrypted key files (no password prompts)
--multisig --keyfiles=alice.enc,bob.enc,charlie.enc

# Specify workflow explicitly
--multisig --workflow=interactive
```

### Offline Workflow (Air-Gapped)

**When to use:**
- Maximum security required
- Signers in different timezones
- Hardware wallet or air-gapped signing
- No time pressure

**Phase 1: Freeze & Export**

The initiator creates and freezes the transaction:

```bash
node scripts/interactions/LazyLotto/admin/withdrawTokens.js \
  0.0.123456 1000 --multisig --export-only

# Output:
# ✅ Transaction frozen
# 📁 Transaction: multisig-transactions/0-0-98765-1701234567-890.tx
# 📄 Metadata: multisig-transactions/0-0-98765-1701234567-890.json
#
# Share these files with signers via secure channel.
```

The `.json` file contains human-readable transaction details:

```json
{
  "transactionId": "0.0.98765@1701234567.890",
  "contractId": "0.0.123456",
  "function": "withdrawTokens",
  "params": ["0.0.123456", "1000"],
  "frozenAt": "2025-12-19T10:30:00.000Z",
  "expiresAt": "2025-12-19T10:31:50.000Z",
  "threshold": 2,
  "signers": ["Alice", "Bob", "Charlie"]
}
```

**Phase 2: Sign Offline**

Each signer signs on their own machine (can be air-gapped):

```bash
# Alice's machine (possibly offline)
npx @lazysuperheroes/hedera-multisig sign multisig-transactions/0-0-98765-1701234567-890.tx

# Prompts:
# Review transaction details (shown in clear text)
# Enter private key: ***************
# ✅ Signature created: signature-alice-1701234567.json
```

**Phase 3: Collect & Execute**

The coordinator collects signatures and executes:

```bash
node scripts/interactions/LazyLotto/admin/withdrawTokens.js \
  0.0.123456 1000 --multisig --offline \
  --signatures=signature-alice.json,signature-bob.json

# Output:
# 🔍 Loading signatures...
# ✅ Alice's signature valid (Ed25519)
# ✅ Bob's signature valid (ECDSA)
# ✅ Threshold met (2/2)
# 📤 Executing transaction...
# ✅ Success: 0.0.98765@1701234567.890
```

**Offline Mode Options:**

```bash
# Export only (Phase 1)
--multisig --export-only

# Execute with signatures (Phase 3)
--multisig --offline --signatures=sig1.json,sig2.json

# Custom export directory
--multisig --export-only --export-dir=./my-txs

# Skip export during execution
--multisig --skip-export
```

## Usage Examples

### Example 1: Create Pool with 2-of-3 Multi-Sig

**Scenario**: Three team members (Alice, Bob, Charlie) manage the platform. Any 2 must approve new pools.

```bash
# Alice initiates
node scripts/interactions/LazyLotto/admin/createPool.js \
  --multisig --threshold=2 --signers=Alice,Bob,Charlie

# System prompts Alice for her key
# Enter private key for Alice: ***************
# ✅ Signature 1/2 collected

# Bob enters his key
# Enter private key for Bob: ***************
# ✅ Signature 2/2 collected
# ✅ Threshold met, executing...

# Pool created with transaction ID logged
```

### Example 2: Emergency Pool Closure (Interactive)

**Scenario**: Pool has a critical bug, needs immediate closure.

```bash
# Fast 2-of-2 approval with two executives
node scripts/interactions/LazyLotto/admin/closePool.js 5 \
  --multisig --threshold=2 --signers=CEO,CTO

# Both sign within 110 seconds
# ✅ Pool closed immediately
```

### Example 3: Treasury Withdrawal (Offline, Air-Gapped)

**Scenario**: Withdraw $100K LAZY from treasury. CFO uses air-gapped hardware wallet.

```bash
# Day 1: Finance team member creates transaction
node scripts/interactions/LazyLotto/admin/withdrawTokens.js \
  0.0.789012 10000000000000 \
  --multisig --export-only --signers=CEO,CFO

# Email .tx file to CEO and CFO

# Day 2: CEO signs on laptop
npx @lazysuperheroes/hedera-multisig sign tx-file.tx
# Creates: signature-ceo.json

# Day 3: CFO signs on air-gapped machine
# (Transfer .tx file via USB)
npx @lazysuperheroes/hedera-multisig sign tx-file.tx
# Creates: signature-cfo.json
# (Transfer signature back via USB)

# Day 4: Finance executes with both signatures
node scripts/interactions/LazyLotto/admin/withdrawTokens.js \
  0.0.789012 10000000000000 \
  --multisig --offline \
  --signatures=signature-ceo.json,signature-cfo.json

# ✅ Withdrawal executed securely
```

### Example 4: Platform Fee Change (Mixed Keys)

**Scenario**: Update platform fee with board approval. Board members use different key types.

```bash
# Board has Ed25519 and ECDSA keys mixed
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 12 \
  --multisig --threshold=3 --signers=Alice,Bob,Carol,Dave,Eve

# Alice: Ed25519 ✅
# Bob: ECDSA ✅
# Carol: Ed25519 ✅
# Threshold met: 3/5
# ✅ Fee updated to 12%
```

### Example 5: Using Encrypted Key Files

**Scenario**: Frequent multi-sig operations, don't want to enter keys each time.

```bash
# One-time setup: Create encrypted key files
npx @lazysuperheroes/hedera-multisig create-key-file
# Enter private key: ***************
# Enter encryption password: ********
# ✅ Created: alice.enc

# Now use in scripts without entering private key
node scripts/interactions/LazyLotto/admin/setBonuses.js \
  --multisig --keyfiles=alice.enc,bob.enc --threshold=2

# Only password prompts, private keys stay encrypted
# Enter password for alice.enc: ********
# Enter password for bob.enc: ********
# ✅ Bonuses updated
```

### Example 6: LazyTradeLotto Jackpot Boost (Interactive)

**Scenario**: Boost the jackpot pool for a promotional event with 2-of-3 approval.

```bash
# Add 5000 $LAZY to jackpot with multi-sig
node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js \
  0.0.123456 5000 --multisig --threshold=2 --signers=Marketing,Treasury,CEO

# Marketing signs ✅
# Treasury signs ✅
# Threshold met (2/3)
# ✅ Jackpot boosted by 5,000 $LAZY
```

### Example 7: LazyTradeLotto Emergency Pause (Interactive)

**Scenario**: Critical issue detected, need to pause the lottery immediately.

```bash
# Fast 2-of-2 approval with executives
node scripts/interactions/LazyTradeLotto/admin/pauseLottoContract.js \
  0.0.123456 --multisig --threshold=2 --signers=CEO,CTO

# Both sign within 110 seconds
# ✅ LazyTradeLotto paused
```

### Example 8: LazyTradeLotto System Wallet Update (Offline)

**Scenario**: Rotate the signature wallet with maximum security.

```bash
# Phase 1: Freeze and export
node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js \
  0.0.123456 0.0.789012 --multisig --export-only

# Phase 2: Signers sign offline (air-gapped machines)
npx @lazysuperheroes/hedera-multisig sign multisig-transactions/tx-file.tx
# Creates signature files

# Phase 3: Execute with collected signatures
node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js \
  0.0.123456 0.0.789012 --multisig --offline \
  --signatures=signature-ceo.json,signature-cto.json

# ✅ System wallet updated securely
```

## Key Management

### Security Tiers

The system supports three security tiers:

| Tier | Method | Security | Convenience | Use Case |
|------|--------|----------|-------------|----------|
| 🔒🔒🔒 | Prompt Input | Highest | Low | Critical operations, one-time use |
| 🔒🔒 | Encrypted File | High | Medium | Regular operations, repeated use |
| 🔒 | Environment Variable | Medium | High | Development, testing |

### Creating Encrypted Key Files

```bash
# Interactive wizard
npx @lazysuperheroes/hedera-multisig create-key-file

# Prompts:
# 1. Enter private key (hex format)
# 2. Enter encryption password
# 3. Confirm password
# 4. Enter output filename

# Output: alice.enc (AES-256-GCM encrypted)
```

**File format:**
- Encryption: AES-256-GCM
- Key derivation: PBKDF2 with 100,000 iterations
- Salt: Random 32 bytes per file
- IV: Random 16 bytes per encryption

**Testing encrypted files:**

```bash
npx @lazysuperheroes/hedera-multisig test-key-file alice.enc
# Enter password: ********
# ✅ Key file valid
# Algorithm: Ed25519
# Public key: 302a300506032b6570032100...
```

### Best Practices

**DO:**
- ✅ Use encrypted files for repeated operations
- ✅ Use prompt input for critical operations
- ✅ Store encrypted files in secure locations
- ✅ Use different keys for testnet vs mainnet
- ✅ Rotate keys periodically
- ✅ Keep backup copies of encrypted files

**DON'T:**
- ❌ Commit private keys or encrypted files to git
- ❌ Share private keys via email or chat
- ❌ Reuse the same key across multiple roles
- ❌ Store keys in plain text anywhere
- ❌ Use environment variables in production

### Key Rotation

When rotating keys:

1. Create new encrypted key file with new key
2. Update multi-sig configuration to use new key
3. Test with non-critical operation
4. Securely delete old encrypted file
5. Update documentation/runbooks

## Troubleshooting

### "Transaction Expired" Error

**Symptom:**
```
❌ Error: Transaction expired
   Frozen at: 2025-12-19T10:30:00Z
   Expired at: 2025-12-19T10:31:50Z
   Current time: 2025-12-19T10:32:15Z
```

**Cause**: Signatures took longer than 110 seconds to collect.

**Solution**: Use offline workflow:
```bash
# Instead of interactive
--multisig

# Use offline
--multisig --export-only
# ... collect signatures over any timeframe ...
--multisig --offline --signatures=s1.json,s2.json
```

### "Insufficient Signatures" Error

**Symptom:**
```
❌ Error: Insufficient signatures
   Required: 3
   Provided: 2
   Valid: 2
```

**Cause**: Not enough signatures collected.

**Solution**:
- Check threshold setting: `--threshold=3`
- Verify all signature files exist
- Ensure all signers have signed

### "Invalid Signature" Error

**Symptom:**
```
❌ Error: Invalid signature from signer 2
   Expected account: 0.0.123456
   Signature account: 0.0.789012
```

**Cause**: Signature doesn't match expected signer or transaction was modified.

**Solutions**:
1. Verify signer used correct private key
2. Check transaction file wasn't modified
3. Ensure same .tx file used by all signers
4. Verify key type matches (Ed25519 vs ECDSA)

### "Wrong Password" Error

**Symptom:**
```
❌ Error decrypting key file: wrong password
```

**Cause**: Incorrect password for encrypted key file.

**Solution**:
- Re-enter password carefully
- Check caps lock is off
- Verify using correct .enc file
- Recreate key file if password forgotten

### Script Ignores --multisig Flag

**Symptom**: Script runs in single-sig mode despite `--multisig` flag.

**Cause**: Script hasn't been updated with multi-sig integration.

**Solution**:
- Check script uses `executeContractFunction` from scriptHelpers
- Verify script has been updated per integration guide
- See `docs/MULTISIG_ADMIN_INTEGRATION.md`

### Timeout Too Short

**Symptom**: Interactive mode times out before all signatures collected.

**Cause**: 110-second timeout too short for your workflow.

**Solution**: Use offline workflow instead - no timeout:
```bash
--multisig --export-only
```

### Can't Find Transaction File

**Symptom:**
```
❌ Error: Transaction file not found
   Path: multisig-transactions/tx-12345.tx
```

**Solution**:
- Check you're in correct directory
- Verify export directory: `--export-dir=./my-dir`
- Look in default: `./multisig-transactions/`
- Check file wasn't deleted

## FAQ

### Can I use hardware wallets?

**Yes**, via offline workflow:
1. Export transaction: `--multisig --export-only`
2. Transfer .tx file to machine with hardware wallet
3. Sign using hardware wallet's signing method
4. Transfer signature back
5. Execute: `--multisig --offline --signatures=...`

### Can I mix Ed25519 and ECDSA keys?

**Yes**, the system fully supports mixed key types in the same multi-sig setup. A 2-of-3 with 1 Ed25519 + 2 ECDSA signers works perfectly.

### What happens if a signer loses their key?

If using M-of-N where M < N (e.g., 2-of-3), the remaining signers can still approve transactions. Otherwise, you'll need to update the multi-sig configuration with a new signer.

### How long does a frozen transaction last?

110 seconds in interactive mode. In offline mode, there's no expiration - you can take as long as needed to collect signatures before executing.

### Can I cancel a multi-sig transaction?

**No**, once frozen and exported, the transaction cannot be cancelled. However, you can simply not execute it (don't collect signatures or run the execution step).

### What's in the audit log?

```json
{
  "timestamp": "2025-12-19T10:30:00.000Z",
  "transactionId": "0.0.98765@1701234567.890",
  "operation": "closePool",
  "contract": "0.0.123456",
  "parameters": { "poolId": 5 },
  "signers": [
    { "account": "0.0.111111", "algorithm": "Ed25519" },
    { "account": "0.0.222222", "algorithm": "ECDSA" }
  ],
  "threshold": "2 of 3",
  "workflow": "interactive",
  "status": "success",
  "receiptStatus": "SUCCESS"
}
```

### Are old single-sig scripts affected?

**No**, all scripts maintain backward compatibility. Running without `--multisig` flag works exactly as before.

### How do I test multi-sig on testnet?

```bash
# Set testnet in .env
ENVIRONMENT=testnet

# Run any admin script
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10 \
  --multisig --threshold=2

# Uses testnet Hedera network
```

### Can I use this with other Hedera projects?

**Yes**, the multi-sig library is published as `@lazysuperheroes/hedera-multisig` on npm. Install it in any Hedera project with `npm install @lazysuperheroes/hedera-multisig` and follow the integration guide.

### What if I need more than 7 signers?

The system has no hard limit on signers. However, practical limits:
- Interactive mode: ~5 signers (110s timeout)
- Offline mode: Unlimited (no timeout)

### How much does multi-sig cost?

Multi-sig operations have the same gas cost as single-sig - the only difference is coordination time and complexity.

## Additional Resources

- **Admin Integration Guide**: `docs/MULTISIG_ADMIN_INTEGRATION.md`
- **Developer Guide**: `docs/MULTISIG_DEVELOPER_GUIDE.md`
- **Security Analysis**: `docs/MULTISIG_SECURITY.md`
- **npm Package**: `@lazysuperheroes/hedera-multisig`
- **CLI Tools** (via npx):
  - `npx @lazysuperheroes/hedera-multisig create-key-file` - Create encrypted key files
  - `npx @lazysuperheroes/hedera-multisig test-key-file` - Test encrypted key files
  - `npx @lazysuperheroes/hedera-multisig sign` - Offline transaction signing
  - `npx @lazysuperheroes/hedera-multisig security-audit` - Security scanning

## Getting Help

**Check logs:**
```bash
tail -f logs/audit.log
```

**Run security audit:**
```bash
npx @lazysuperheroes/hedera-multisig security-audit
```

**Enable verbose output:**
```bash
--multisig --verbose
```

**Test key file:**
```bash
npx @lazysuperheroes/hedera-multisig test-key-file yourkey.enc
```

For bugs or feature requests, open an issue on GitHub with:
- Script name and command used
- Error message (full text)
- Relevant log entries
- Multi-sig configuration (threshold, signers, workflow)
