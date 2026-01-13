/**
 * ECDSA Signing Key Verification Script
 *
 * Verifies that the SIGNING_KEY in .env is a valid ECDSA key (not Ed25519).
 * LazyTradeLotto uses Solidity's ECDSA.recover() which ONLY works with ECDSA keys.
 *
 * Usage: node scripts/deployments/verifySigningKey.js
 *
 * What this script checks:
 * 1. SIGNING_KEY is present in .env
 * 2. Key can be loaded as an ECDSA private key
 * 3. Sign/verify round-trip works correctly
 * 4. Displays public key and address for contract configuration
 */

const { ethers } = require('ethers');
require('dotenv').config();

const main = async () => {
	console.log('\n' + '='.repeat(70));
	console.log('  ECDSA Signing Key Verification');
	console.log('='.repeat(70));
	console.log();

	// Step 1: Check if SIGNING_KEY exists
	const signingKeyRaw = process.env.SIGNING_KEY;

	if (!signingKeyRaw) {
		console.log('ERROR: SIGNING_KEY not found in .env file');
		console.log();
		console.log('To generate an ECDSA key, you can use:');
		console.log('  const wallet = ethers.Wallet.createRandom();');
		console.log('  console.log(wallet.privateKey);');
		console.log();
		process.exit(1);
	}

	console.log('Step 1: SIGNING_KEY found in .env');

	// Step 2: Try to create an ethers Wallet (ECDSA only)
	let wallet;
	try {
		// Ensure key has 0x prefix for ethers
		const privateKey = signingKeyRaw.startsWith('0x')
			? signingKeyRaw
			: `0x${signingKeyRaw}`;

		wallet = new ethers.Wallet(privateKey);
		console.log('Step 2: Successfully loaded as ECDSA key');
	}
	catch (error) {
		console.log();
		console.log('ERROR: Failed to load SIGNING_KEY as ECDSA key');
		console.log();
		console.log('Details:', error.message);
		console.log();
		console.log('Common issues:');
		console.log('  - Key may be Ed25519 format (Hedera native) instead of ECDSA');
		console.log('  - Key may have incorrect length (should be 32 bytes / 64 hex chars)');
		console.log('  - Key may contain invalid characters');
		console.log();
		console.log('LazyTradeLotto requires an ECDSA (secp256k1) key for signature validation.');
		console.log('Generate one with: ethers.Wallet.createRandom().privateKey');
		console.log();
		process.exit(1);
	}

	// Step 3: Test sign/verify round-trip
	console.log('Step 3: Testing signature round-trip...');

	const testMessage = 'LazyTradeLotto signature verification test';
	const messageHash = ethers.hashMessage(testMessage);

	let signature;
	try {
		signature = await wallet.signMessage(testMessage);
		console.log('        - Message signed successfully');
	}
	catch (error) {
		console.log('ERROR: Failed to sign test message:', error.message);
		process.exit(1);
	}

	// Verify the signature recovers to the correct address
	try {
		const recoveredAddress = ethers.verifyMessage(testMessage, signature);

		if (recoveredAddress.toLowerCase() === wallet.address.toLowerCase()) {
			console.log('        - Signature verification passed');
		}
		else {
			console.log('ERROR: Signature verification failed!');
			console.log('  Expected:', wallet.address);
			console.log('  Recovered:', recoveredAddress);
			process.exit(1);
		}
	}
	catch (error) {
		console.log('ERROR: Failed to verify signature:', error.message);
		process.exit(1);
	}

	// Step 4: Display key information
	console.log();
	console.log('='.repeat(70));
	console.log('  VERIFICATION SUCCESSFUL');
	console.log('='.repeat(70));
	console.log();
	console.log('Key Details:');
	console.log('-'.repeat(70));
	console.log('  Algorithm:     ECDSA (secp256k1)');
	console.log('  Public Key:   ', wallet.publicKey);
	console.log('  Address:      ', wallet.address);
	console.log('-'.repeat(70));
	console.log();
	console.log('For LazyTradeLotto Configuration:');
	console.log('-'.repeat(70));
	console.log('  Use this address as the systemWallet in LazyTradeLotto:');
	console.log(`    ${wallet.address}`);
	console.log();
	console.log('  The contract expects signatures from this address for roll validation.');
	console.log('-'.repeat(70));
	console.log();

	// Additional: Show signature format example
	console.log('Signature Format (for reference):');
	console.log('-'.repeat(70));
	console.log('  Test message hash:', messageHash);
	console.log('  Signature length: ', signature.length, 'chars');
	console.log('  Signature (v,r,s format used by Solidity ECDSA.recover):');

	// Parse signature components
	const sig = ethers.Signature.from(signature);
	console.log('    r:', sig.r);
	console.log('    s:', sig.s);
	console.log('    v:', sig.v);
	console.log('-'.repeat(70));
	console.log();
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('Unexpected error:', error);
		process.exit(1);
	});
