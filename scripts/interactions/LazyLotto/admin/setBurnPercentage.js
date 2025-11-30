/**
 * LazyLotto Set Burn Percentage Script
 *
 * Update the burn percentage applied to LAZY token entry fees.
 * Percentage must be between 0-100 (where 100 = 100% burn).
 * Requires ADMIN role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/setBurnPercentage.js
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

async function setBurnPercentage() {
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
		console.log('║        LazyLotto Set Burn Percentage (Admin)              ║');
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

		// Get current burn percentage
		try {
			const encodedQuery = lazyLottoIface.encodeFunctionData('burnPercentage', []);
			const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedQuery, operatorId, false);
			const decoded = lazyLottoIface.decodeFunctionResult('burnPercentage', result);
			const currentBurnPercentage = decoded[0];
			console.log(`📊 Current burn percentage: ${currentBurnPercentage}%\n`);
		}
		catch {
			console.log('⚠️  Could not fetch current burn percentage');
		}

		// Get new burn percentage
		const percentageStr = await prompt('Enter new burn percentage (0-100): ');

		let burnPercentage;
		try {
			burnPercentage = parseInt(percentageStr);
			if (isNaN(burnPercentage) || burnPercentage < 0 || burnPercentage > 100) {
				console.error('❌ Burn percentage must be between 0 and 100');
				process.exit(1);
			}
		}
		catch {
			console.error('❌ Invalid percentage format');
			process.exit(1);
		}

		console.log(`\n🔥 New burn percentage: ${burnPercentage}%`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'setBurnPercentage', [burnPercentage], 100000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		const confirm = await prompt(`Set burn percentage to ${burnPercentage}%? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Setting burn percentage...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'setBurnPercentage',
			[burnPercentage],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Burn percentage updated successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

	}
	catch (error) {
		console.error('\n❌ Error setting burn percentage:', error.message);
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
setBurnPercentage();
