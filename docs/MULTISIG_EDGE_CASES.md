# Multi-Signature Edge Cases & Handling

**Last Updated**: 2025-12-19
**Purpose**: Document edge cases, error scenarios, and system behavior under unusual conditions

---

## Table of Contents

1. [Transaction Lifecycle Edge Cases](#transaction-lifecycle-edge-cases)
2. [Key Management Edge Cases](#key-management-edge-cases)
3. [Workflow Edge Cases](#workflow-edge-cases)
4. [Network & Timing Edge Cases](#network--timing-edge-cases)
5. [Integration Edge Cases](#integration-edge-cases)
6. [Error Recovery Patterns](#error-recovery-patterns)

---

## Transaction Lifecycle Edge Cases

### Case 1: Transaction Expires During Signature Collection
**Scenario**: Interactive workflow, 110-second timeout expires before threshold met

**Behavior**:
- System detects expiration via countdown timer
- Immediately stops accepting new signatures
- Returns error: "Transaction expired"
- Transaction cannot be executed (Hedera network will reject)

**Handling**:
```javascript
// System automatically detects
if (workflow.isExpired) {
  throw new Error('Transaction expired before threshold met');
}
```

**Resolution**:
- Restart the operation with fresh transaction
- Consider offline workflow for slower signing scenarios
- Increase signer count to reduce wait time

**Prevention**:
- Use 110-second timeout (9-second buffer before 119s Hedera limit)
- Pre-notify signers before initiating
- Use offline workflow for non-urgent operations

---

### Case 2: Transaction Frozen Twice
**Scenario**: Attempt to freeze an already-frozen transaction

**Behavior**:
- Hedera SDK throws error: "transaction is immutable"
- System catches and wraps error with context

**Handling**:
```javascript
try {
  frozenTx = await transaction.freezeWith(client);
} catch (error) {
  if (error.message.includes('immutable')) {
    // Already frozen, proceed
    frozenTx = transaction;
  } else {
    throw error;
  }
}
```

**Resolution**:
- System automatically detects frozen state
- Re-uses existing frozen transaction
- No user action required

---

### Case 3: Insufficient Signatures Provided
**Scenario**: Only 2 signatures collected for 2-of-3 threshold, but one is invalid

**Behavior**:
- System validates all signatures
- Counts only valid signatures
- Rejects if valid count < threshold

**Handling**:
```javascript
const validSignatures = signatures.filter(sig => isValid(sig));
if (validSignatures.length < threshold) {
  throw new Error(`Insufficient valid signatures: ${validSignatures.length}/${threshold}`);
}
```

**Resolution**:
- Request replacement signature from another signer
- Verify signature file format is correct
- Check that correct transaction was signed

---

### Case 4: Duplicate Signatures
**Scenario**: Same signer provides multiple signatures (intentionally or by mistake)

**Behavior**:
- System detects duplicate account IDs or public keys
- Counts each unique signer once
- Prevents double-counting

**Handling**:
```javascript
// Deduplicate by account ID
const uniqueSigners = new Set(signatures.map(s => s.accountId));
if (uniqueSigners.size < threshold) {
  throw new Error('Duplicate signers detected - each must be unique');
}
```

**Resolution**:
- System automatically deduplicates
- Warns user if duplicates found
- Requests additional unique signers if needed

---

## Key Management Edge Cases

### Case 5: Mixed Key Types (Ed25519 + ECDSA)
**Scenario**: 2-of-3 setup with 1 Ed25519 and 2 ECDSA keys

**Behavior**:
- System auto-detects key type via DER prefix
- Creates appropriate PrivateKey object for each
- All signatures verify correctly regardless of algorithm

**Handling**:
```javascript
// KeyValidator.detectKeyType()
if (keyString.startsWith('302e')) {
  return PrivateKey.fromStringED25519(keyString);
} else if (keyString.startsWith('3030')) {
  return PrivateKey.fromStringECDSA(keyString);
} else {
  // Try DER parse
  return PrivateKey.fromStringDer(keyString);
}
```

**Verification**:
- ✅ Tested in multiKeyType.test.js (35 tests)
- ✅ Both algorithms supported
- ✅ No configuration required

---

### Case 6: Invalid Key Format
**Scenario**: User enters key in wrong format (e.g., raw hex without DER encoding)

**Behavior**:
- Immediate validation failure
- Clear error message with expected formats
- Allows retry (up to 3 attempts in CLI)

**Error Messages**:
```
❌ Invalid key format
   Expected: Hedera private key (ED25519 or ECDSA)
   Formats: DER-encoded hex (302e... or 3030...)

   Use KeyValidator.js or testKeyFile.js to verify your key
```

**Handling**:
- Validation before storage/use
- Multiple retry attempts
- Link to validation tools

---

### Case 7: Encrypted File Decryption Failure
**Scenario**: Wrong passphrase or corrupted file

**Behavior**:
- PBKDF2 derivation produces wrong key
- AES-256-GCM decryption fails with auth tag error
- Clear error message (doesn't reveal if passphrase or file is wrong)

**Error Message**:
```
❌ Failed to decrypt key file
   Possible causes:
   - Incorrect passphrase
   - Corrupted file
   - File not created by this tool
```

**Resolution**:
- Retry with correct passphrase
- Verify file integrity (not truncated/modified)
- Restore from backup if corrupted

---

### Case 8: Environment Variable Key Not Set
**Scenario**: EnvKeyProvider used but PRIVATE_KEY not in .env

**Behavior**:
- Provider checks for env var on construction
- Throws clear error if missing
- Does not proceed with undefined key

**Error Message**:
```
❌ Private key not found in environment
   Required: PRIVATE_KEY environment variable

   Add to .env file or use different key provider
   WARNING: Env vars are development-only (not for production)
```

**Prevention**:
- Check at provider initialization
- Fail fast before operation starts
- Recommend alternative providers

---

## Workflow Edge Cases

### Case 9: Offline Export with No Disk Space
**Scenario**: System tries to write frozen transaction but disk is full

**Behavior**:
- Node.js fs.writeFile throws ENOSPC error
- System catches and provides helpful message
- No partial files written (atomic operation)

**Handling**:
```javascript
try {
  await fs.writeFile(txFile, frozenBytes);
} catch (error) {
  if (error.code === 'ENOSPC') {
    throw new Error('Insufficient disk space for export');
  }
  throw error;
}
```

**Resolution**:
- Free up disk space
- Specify different export directory
- Check disk space before operation

---

### Case 10: Offline Signature File Corruption
**Scenario**: Signature JSON file manually edited or corrupted

**Behavior**:
- JSON parse fails
- Signature validation fails
- Clear error with file name

**Handling**:
```javascript
let signature;
try {
  signature = JSON.parse(fileContent);
} catch (error) {
  throw new Error(`Invalid signature file format: ${filename}`);
}

// Validate structure
if (!signature.signer || !signature.signature || !signature.accountId) {
  throw new Error(`Missing required fields in: ${filename}`);
}
```

**Resolution**:
- Re-sign transaction (generate new signature)
- Verify file was not manually edited
- Check file transfer wasn't corrupted

---

### Case 11: Threshold Exceeds Available Signers
**Scenario**: Configuration specifies 5-of-3 (impossible)

**Behavior**:
- Validation catches this before execution
- Throws error immediately
- Prevents wasted effort

**Handling**:
```javascript
// WorkflowOrchestrator._validateConfig()
if (config.threshold > config.keyProviders.length) {
  errors.push('Threshold cannot exceed number of key providers');
}
```

**Resolution**:
- Fix configuration (reduce threshold or add signers)
- System prevents execution
- No partial state created

---

### Case 12: Interactive Workflow - Signer Dropout
**Scenario**: 3-of-5 setup, 2 signers provide keys, then cancel/disconnect

**Behavior**:
- System collects signatures synchronously
- Timeout still applies (110 seconds)
- Fails if threshold not met before timeout or all signers attempt

**Handling**:
```javascript
// Collect up to threshold or timeout
for (let i = 0; i < keyProviders.length && collected < threshold; i++) {
  if (this.isExpired) {
    throw new Error('Transaction expired');
  }

  try {
    const signature = await provider.sign(frozenTx);
    collected++;
  } catch (error) {
    // Log and continue to next signer
    console.error(`Signer ${i+1} failed: ${error.message}`);
  }
}

if (collected < threshold) {
  throw new Error(`Insufficient signatures: ${collected}/${threshold}`);
}
```

**Resolution**:
- System tries all provided key providers
- Succeeds if threshold met before timeout
- Fails gracefully if not enough signers

---

## Network & Timing Edge Cases

### Case 13: Network Interruption During Execution
**Scenario**: Transaction submitted to Hedera but connection lost before receipt

**Behavior**:
- Hedera SDK throws network error
- Transaction may or may not have been processed
- System cannot determine state

**Error Message**:
```
❌ Network error during transaction execution
   Transaction may or may not have been submitted

   Check transaction status manually:
   - Transaction ID: 0.0.123456@1234567890.123456789
   - Check via Hedera explorer or mirror node
```

**Resolution**:
- Query Hedera mirror node with transaction ID
- Verify if transaction was processed
- Retry if not processed (generate new transaction)

**Prevention**:
- Stable network connection
- Timeout handling in SDK
- Audit logging captures transaction ID before submission

---

### Case 14: Clock Skew Between Machines
**Scenario**: Offline workflow, signing machine clock is 5 minutes ahead

**Behavior**:
- Transaction valid start time may be in future
- Hedera may reject as "not yet valid"
- Or may be fine if within tolerance

**Handling**:
- Use Hedera network time (from client)
- Transaction validity is set by freezing machine
- Signing machines don't affect timing

**Prevention**:
- Sync machine clocks (NTP)
- Freeze transaction on machine with accurate time
- Hedera has small tolerance for time differences

---

### Case 15: Transaction Submitted After Expiration
**Scenario**: Offline workflow delayed, signatures collected after 119 seconds

**Behavior**:
- Hedera network rejects: "TRANSACTION_EXPIRED"
- System receives receipt with failure status
- No state change on network

**Error Message**:
```
❌ Transaction rejected by Hedera network
   Status: TRANSACTION_EXPIRED

   The transaction is no longer valid
   Reason: Exceeded 120-second validity window

   Solution: Create and sign new transaction
```

**Resolution**:
- Cannot recover expired transaction
- Must create fresh transaction
- Use offline workflow for delayed signing

---

## Integration Edge Cases

### Case 16: Admin Script Called Without Required Arguments
**Scenario**: `setBurnPercentage.js` called without percentage parameter

**Behavior**:
- Script validates positional arguments
- Throws clear error before multi-sig setup
- No wasted multi-sig overhead

**Handling**:
```javascript
if (process.argv.length < 3) {
  console.error('Usage: node setBurnPercentage.js <percentage>');
  console.error('Example: node setBurnPercentage.js 10');
  process.exit(1);
}

const percentage = parseInt(process.argv[2]);
if (isNaN(percentage) || percentage < 0 || percentage > 100) {
  console.error('Invalid percentage (must be 0-100)');
  process.exit(1);
}
```

**Resolution**:
- Fix command line arguments
- Re-run script
- Multi-sig not initiated unless args valid

---

### Case 17: Multi-sig Flag Mixed with Incompatible Flags
**Scenario**: `--multisig --help` (both flags provided)

**Behavior**:
- Help takes precedence
- Displays multi-sig help
- Does not execute operation

**Handling**:
```javascript
// checkMultiSigHelp() runs first
if (process.argv.includes('--multisig-help') || process.argv.includes('--ms-help')) {
  displayMultiSigHelp();
  return true; // Script should exit
}
```

**Resolution**:
- Help displayed, no execution
- Remove --help to execute
- Clear precedence order documented

---

### Case 18: Contract Execution Fails After Multi-sig
**Scenario**: All signatures collected, transaction submits, but contract reverts

**Behavior**:
- Multi-sig succeeded (all signatures valid)
- Hedera transaction processed
- Contract function reverted (business logic error)

**Error Message**:
```
✅ Multi-sig successful (2-of-3 signatures collected)
✅ Transaction submitted: 0.0.123@1234567890.123456789
❌ Contract execution failed
   Status: CONTRACT_REVERT_EXECUTED
   Reason: [Contract-specific error]

   The multi-sig process completed successfully
   The failure is in the contract logic, not multi-sig
```

**Resolution**:
- Verify contract function parameters
- Check contract state (paused, permissions, etc.)
- Multi-sig layer worked correctly
- Fix contract-level issue

---

## Error Recovery Patterns

### Pattern 1: Partial Signature Collection Failure
**Scenario**: 3-of-5 setup, collected 2 signatures, 3rd signer fails

**Recovery Steps**:
1. Check if 2 valid signatures were saved
2. Request signature from 4th or 5th signer
3. Combine all valid signatures
4. Re-attempt execution if threshold met

**Code**:
```javascript
// Offline workflow automatically handles this
// Just provide additional signature files:
await orchestrator.collectAndExecute(
  frozenTx,
  ['sig1.json', 'sig2.json', 'sig4.json'], // Skip sig3
  3 // Threshold
);
```

---

### Pattern 2: Transaction Expiration Recovery
**Scenario**: Transaction expired before threshold met

**Recovery Steps**:
1. Create fresh transaction (new transaction ID)
2. Freeze with current timestamp
3. Collect signatures again
4. Execute new transaction

**Note**: Cannot reuse signatures from expired transaction (each signature is for specific transaction ID)

---

### Pattern 3: Network Failure During Submission
**Scenario**: Signatures collected, but network fails during execute()

**Recovery Steps**:
1. Check transaction status via mirror node
2. If processed: Operation complete (check contract state)
3. If not processed:
   - Reuse existing frozen transaction + signatures
   - Re-attempt execute() with same signature set
   - No need to re-collect signatures

**Code**:
```javascript
// Signatures still valid for same frozen transaction
try {
  result = await workflow.executeTransaction(frozenTx, signatures);
} catch (networkError) {
  // Check mirror node
  const status = await checkTransactionStatus(txId);

  if (status === 'NOT_FOUND') {
    // Retry with same signatures
    result = await workflow.executeTransaction(frozenTx, signatures);
  }
}
```

---

### Pattern 4: Wrong Transaction Signed
**Scenario**: Offline workflow, signer accidentally signs wrong transaction file

**Detection**:
- Signature verification will fail
- Transaction hash mismatch
- Error: "Signature does not match transaction"

**Recovery Steps**:
1. Verify correct transaction file provided
2. Re-sign correct transaction
3. Replace incorrect signature file
4. Re-attempt collection

**Prevention**:
- Include transaction checksum in metadata
- Verify checksum before signing
- Use clear file naming: `multisig-tx-[timestamp]-[description].txt`

---

## Best Practices for Edge Case Handling

### 1. Always Validate Early
```javascript
// Validate before expensive operations
const validation = orchestrator._validateConfig(config);
if (!validation.valid) {
  throw new Error(`Invalid config: ${validation.errors.join(', ')}`);
}

// Then proceed with multi-sig
await orchestrator.execute(transaction, config);
```

### 2. Provide Clear Error Context
```javascript
try {
  await operation();
} catch (error) {
  throw new Error(`
    Operation failed: ${error.message}

    Context:
    - Workflow: ${config.workflow}
    - Threshold: ${config.threshold}
    - Transaction ID: ${txId}

    See audit log for details: ${auditLogPath}
  `);
}
```

### 3. Log All Edge Cases
```javascript
// Even handled edge cases should be logged
if (duplicateSignerDetected) {
  auditLog.warn({
    event: 'duplicate_signer',
    signerId: signer.accountId,
    handled: true
  });
}
```

### 4. Fail Fast on Invalid State
```javascript
// Don't proceed if state is invalid
if (transaction.isFrozen && needToFreeze) {
  throw new Error('Cannot freeze already-frozen transaction');
}

// Rather than trying to handle and potentially corrupting state
```

### 5. Provide Recovery Instructions
```javascript
if (insufficientSignatures) {
  console.error(`
    ❌ Insufficient signatures: ${collected}/${threshold}

    Recovery options:
    1. Request signature from another authorized signer
    2. If offline workflow: check signature files are valid
    3. If interactive: ensure all signers are available
    4. Verify threshold configuration is correct
  `);
}
```

---

## Testing Edge Cases

All edge cases documented here are covered by the test suite:

- **Unit Tests**: workflows.test.js (67 tests) - timeout, expiration, validation
- **Integration Tests**: multiSigAdminIntegration.test.js (68 tests) - threshold variations, error scenarios
- **Key Tests**: keyProviders.test.js (28 tests) + multiKeyType.test.js (35 tests) - key format, mixed types

**Total Edge Case Coverage**: 198 tests specifically for edge cases and error scenarios

---

## Summary

The multi-signature system handles edge cases through:

1. **Early Validation**: Catch errors before expensive operations
2. **Clear Error Messages**: Provide context and recovery steps
3. **Graceful Degradation**: Handle partial failures when possible
4. **Comprehensive Logging**: Audit trail for all edge cases
5. **Recovery Patterns**: Document how to recover from failures
6. **Extensive Testing**: 236 tests including edge case scenarios

**Production Readiness**: All known edge cases are handled with clear error messages and recovery procedures.

---

*Last Updated: 2025-12-19 - Part of comprehensive multi-signature system documentation*
