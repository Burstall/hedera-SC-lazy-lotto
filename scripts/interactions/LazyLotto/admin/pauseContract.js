/**
 * LazyLotto Contract Pause/Unpause Script
 *
 * Pause or unpause the entire LazyLotto contract (emergency stop).
 * This is different from pool-level pause - this affects ALL operations.
 * Requires ADMIN role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/pauseContract.js
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

async function pauseContract() {
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
		console.log('║        LazyLotto Contract Pause/Unpause (Admin)           ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		// Menu
		console.log('⚠️  Contract-level pause affects ALL operations globally.\n');
		console.log('Select action:');
		console.log('1. Pause Contract (Emergency Stop)');
		console.log('2. Unpause Contract');

		const choice = await prompt('\nEnter choice (1-2): ');

		let functionName, actionDesc;

		switch (choice) {
		case '1':
			functionName = 'pause';
			actionDesc = 'Pause';
			console.log('\n🛑 Pause Contract (Emergency Stop)\n');
			break;
		case '2':
			functionName = 'unpause';
			actionDesc = 'Unpause';
			console.log('\n✅ Unpause Contract\n');
			break;
		default:
			console.error('❌ Invalid choice');
			process.exit(1);
		}

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, functionName, [], 100000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		const confirm = await prompt(`${actionDesc} the entire LazyLotto contract? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log(`\n🔄 ${actionDesc}ing contract...`);

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			functionName,
			[],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log(`\n✅ Contract ${actionDesc.toLowerCase()} successfully!`);
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

	}
	catch (error) {
		console.error('\n❌ Error managing contract pause state:', error.message);
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
pauseContract();
