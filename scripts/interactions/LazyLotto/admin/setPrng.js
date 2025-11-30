/**
 * LazyLotto Set PRNG Contract Script
 *
 * Update the PRNG (Pseudo-Random Number Generator) contract address.
 * Used for VRF randomness in roll outcomes.
 * Requires ADMIN role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/setPrng.js
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

// Helper: Prompt user
function prompt(question) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => {
		rl.question(question, answer => {
			rl.close();
			resolve(answer);
		});
	});
}

async function setPrng() {
	let client;

	try {
		// Normalize environment name to accept TEST/TESTNET, MAIN/MAINNET, PREVIEW/PREVIEWNET
		const envUpper = env.toUpperCase();

		// Initialize client
		if (envUpper === 'MAINNET' || envUpper === 'MAIN') {
			client = Client.forMainnet();
		}
		else if (envUpper === 'TESTNET' || envUpper === 'TEST') {
			client = Client.forTestnet();
		}
		else if (envUpper === 'PREVIEWNET' || envUpper === 'PREVIEW') {
			client = Client.forPreviewnet();
		}
		else {
			throw new Error(`Unknown environment: ${env}. Use TESTNET, MAINNET, or PREVIEWNET`);
		}

		client.setOperator(operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║          LazyLotto Set PRNG Contract (Admin)              ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		// Get current PRNG contract
		try {
			const encodedQuery = lazyLottoIface.encodeFunctionData('prng', []);
			const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedQuery, operatorId, false);
			const decoded = lazyLottoIface.decodeFunctionResult('prng', result);
			const currentPrng = decoded[0];

			// Try to convert to Hedera ID
			const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
			const hederaId = await homebrewPopulateAccountNum(env, currentPrng);

			console.log(`📊 Current PRNG contract: ${currentPrng}`);
			if (hederaId) {
				console.log(`   (Hedera ID: ${hederaId.toString()})\n`);
			}
			else {
				console.log('');
			}
		}
		catch {
			console.log('⚠️  Could not fetch current PRNG contract\n');
		}

		// Get new PRNG address
		const prngInput = await prompt('Enter new PRNG contract (0.0.xxxxx or 0x...): ');

		let prngAddress;
		if (prngInput.startsWith('0x')) {
			// EVM address
			prngAddress = prngInput;
		}
		else {
			// Hedera ID - convert to EVM
			try {
				const prngContractId = ContractId.fromString(prngInput);
				prngAddress = prngContractId.toSolidityAddress();
			}
			catch {
				console.error('❌ Invalid contract ID format');
				process.exit(1);
			}
		}

		console.log(`\n🎲 New PRNG contract: ${prngAddress}`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'setPrng', [prngAddress], 100000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		const confirm = await prompt(`Set PRNG contract to ${prngInput}? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Setting PRNG contract...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'setPrng',
			[prngAddress],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ PRNG contract updated successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

	}
	catch (error) {
		console.error('\n❌ Error setting PRNG contract:', error.message);
		if (error.status) {
			console.error('Status:', error.status.toString());
		}
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

// Run the script
setPrng();
