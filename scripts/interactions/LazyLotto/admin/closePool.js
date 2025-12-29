/**
 * LazyLotto Close Pool Script
 *
 * Permanently closes a pool. Pool must have no outstanding entries or pending prizes.
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/closePool.js [poolId]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/closePool.js [poolId] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/closePool.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
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

const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

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
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		let poolIdStr = process.argv[2];

		// Filter out flag arguments
		if (poolIdStr && poolIdStr.startsWith('--')) {
			poolIdStr = null;
		}

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID to close: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

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
		console.log('║             LazyLotto Close Pool (Admin)                  ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		// Check pool status first
		console.log('🔍 Checking pool status...');

		const encodedQuery = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedQuery,
			operatorId,
			false,
		);
		const poolBasicInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
		// Destructure: (ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken)
		const [, , , , , outstandingEntries, , , closed] = poolBasicInfo;

		if (!poolBasicInfo) {
			console.error('\n❌ Pool does not exist');
			process.exit(1);
		}

		if (closed) {
			console.log('\n⚠️  Pool is already closed');
			process.exit(0);
		}

		console.log(`Outstanding Entries: ${outstandingEntries.toString()}\n`);

		// Warn if there are outstanding entries
		if (Number(outstandingEntries) > 0) {
			console.log('⚠️  WARNING: Pool has outstanding entries!');
			console.log('   Users should roll and claim prizes before closing.\n');
		}

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'closePool', [poolId], 150000);
		const gasEstimate = gasInfo.gasLimit;

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

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: 'closePool',
			params: [poolId],
			gas: gasLimit,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			console.error('\n❌ Transaction failed');
			console.error('   Possible reasons:');
			console.error('   - Pool has outstanding entries');
			console.error('   - Pool has unclaimed prizes');
			console.error('   - Not authorized (requires ADMIN)');
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ Pool closed successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

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
