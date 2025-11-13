/**
 * LazyLotto Unpause Pool Script
 *
 * Unpauses a pool to allow ticket purchases.
 * Requires ADMIN role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/unpausePool.js [poolId]
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

async function unpausePool() {
	let client;

	try {
		let poolIdStr = process.argv[2];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID to unpause: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Initialize client
		if (env.toUpperCase() === 'MAINNET') {
			client = Client.forMainnet();
		}
		else if (env.toUpperCase() === 'TESTNET') {
			client = Client.forTestnet();
		}
		else if (env.toUpperCase() === 'PREVIEWNET') {
			client = Client.forPreviewnet();
		}
		else {
			throw new Error(`Unknown environment: ${env}`);
		}

		client.setOperator(operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║            LazyLotto Unpause Pool (Admin)                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../utils/gasHelpers');

		// Estimate gas
		const encodedCommand = lazyLottoIface.encodeFunctionData('unpausePool', [poolId]);
		const gasEstimate = await estimateGas(env, contractId, encodedCommand, operatorId);
		console.log(`⛽ Estimated gas: ~${gasEstimate} gas\n`);

		// Confirm
		const confirm = await prompt(`Unpause pool #${poolId}? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Unpausing pool...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [success, txReceipt] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'unpausePool',
			[poolId],
		);

		if (!success) {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Pool unpaused successfully!');
		console.log(`📋 Transaction: ${txReceipt.transactionId.toString()}\n`);

		console.log('▶️  Pool is now active. Ticket purchases allowed.\n');

	}
	catch (error) {
		console.error('\n❌ Error unpausing pool:', error.message);
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
unpausePool();
