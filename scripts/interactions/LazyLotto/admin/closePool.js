/**
 * LazyLotto Close Pool Script
 *
 * Permanently closes a pool. Pool must have no outstanding entries or pending prizes.
 * Requires ADMIN role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/closePool.js [poolId]
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

async function closePool() {
	let client;

	try {
		let poolIdStr = process.argv[2];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID to close: ');
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
		console.log('║             LazyLotto Close Pool (Admin)                  ║');
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
		const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../utils/gasHelpers');

		// Check pool status first
		console.log('🔍 Checking pool status...');

		const encodedQuery = lazyLottoIface.encodeFunctionData('getPoolDetails', [poolId]);
		const poolDetails = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedQuery,
			lazyLottoIface,
			'getPoolDetails',
			false,
		);

		if (!poolDetails || !poolDetails.used) {
			console.error('\n❌ Pool does not exist or is not in use');
			process.exit(1);
		}

		if (poolDetails.closed) {
			console.log('\n⚠️  Pool is already closed');
			process.exit(0);
		}

		console.log(`Pool: "${poolDetails.name}"`);
		console.log(`Total Entries: ${poolDetails.totalEntries.toString()}`);
		console.log(`Outstanding Tokens: ${poolDetails.tokensForPoolPrizes.toString()}\n`);

		// Warn if there are outstanding entries/prizes
		if (poolDetails.totalEntries > 0n) {
			console.log('⚠️  WARNING: Pool has outstanding entries!');
			console.log('   Users should roll and claim prizes before closing.\n');
		}

		if (poolDetails.tokensForPoolPrizes > 0n) {
			console.log('⚠️  WARNING: Pool has outstanding prize tokens!');
			console.log('   All prizes should be claimed before closing.\n');
		}

		// Estimate gas
		const encodedCommand = lazyLottoIface.encodeFunctionData('closePool', [poolId]);
		const gasEstimate = await estimateGas(env, contractId, encodedCommand, operatorId);
		console.log(`⛽ Estimated gas: ~${gasEstimate} gas\n`);

		// Confirm
		console.log('⚠️  This action is PERMANENT and cannot be undone!');
		const confirm = await prompt(`Close pool #${poolId} PERMANENTLY? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Closing pool...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [success, txReceipt] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'closePool',
			[poolId],
		);

		if (!success) {
			console.error('\n❌ Transaction failed');
			console.error('   Possible reasons:');
			console.error('   - Pool has outstanding entries');
			console.error('   - Pool has unclaimed prizes');
			console.error('   - Not authorized (requires ADMIN)');
			process.exit(1);
		}

		console.log('\n✅ Pool closed successfully!');
		console.log(`📋 Transaction: ${txReceipt.transactionId.toString()}\n`);

		console.log('🔒 Pool is now permanently closed.');
		console.log('   - No further ticket purchases');
		console.log('   - No further prize additions');
		console.log('   - Can remove remaining prizes with removePrizes.js\n');

	}
	catch (error) {
		console.error('\n❌ Error closing pool:', error.message);
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
closePool();
