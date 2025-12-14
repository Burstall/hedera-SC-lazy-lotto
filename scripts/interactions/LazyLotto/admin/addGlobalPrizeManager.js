/**
 * LazyLotto Add Global Prize Manager Script
 *
 * Allows admin to grant another account the ability to manage prizes for global pools.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/addGlobalPrizeManager.js [--manager <accountId>]
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
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);

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

// Helper: Sleep
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function addGlobalPrizeManager() {
	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let managerInput = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--manager' && args[i + 1]) {
				managerInput = args[i + 1];
				i++;
			}
		}

		// Normalize environment name
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
		console.log('║         LazyLotto Add Global Prize Manager (Admin)        ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Load PoolManager ABI
		const poolManagerJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json'),
		);
		const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		const { contractExecuteFunction, readOnlyEVMFromMirrorNode, estimateGas } = require('../../../../utils/solidityHelpers');

		// Check if operator is admin
		console.log('🔍 Verifying admin permissions...\n');
		let encodedCommand = poolManagerIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isAdmin = poolManagerIface.decodeFunctionResult('isAdmin', result)[0];

		if (!isAdmin) {
			console.error('❌ You are not an admin of the PoolManager contract');
			process.exit(1);
		}

		console.log('✅ Admin status confirmed\n');

		// Prompt for manager address if not provided
		if (!managerInput) {
			managerInput = await prompt('Enter manager account ID (e.g., 0.0.1234): ');
		}

		// Parse manager ID
		let managerId;
		try {
			managerId = AccountId.fromString(managerInput);
		}
		catch {
			console.error('❌ Invalid account ID format. Use format like 0.0.1234:', managerInput);
			process.exit(1);
		}

		const managerAddress = managerId.toSolidityAddress();

		// Check if already a manager
		console.log('🔍 Checking if already a global prize manager...\n');
		encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPrizeManager', [managerAddress]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isAlreadyManager = poolManagerIface.decodeFunctionResult('isGlobalPrizeManager', result)[0];

		if (isAlreadyManager) {
			console.log('⚠️  This account is already a global prize manager');
			const continueAnyway = await prompt('Continue anyway? (yes/no): ');
			if (continueAnyway.toLowerCase() !== 'yes' && continueAnyway.toLowerCase() !== 'y') {
				console.log('❌ Operation cancelled by user');
				process.exit(0);
			}
		}

		// Display summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  MANAGER DETAILS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Manager ID:       ${managerId.toString()}`);
		console.log(`  Current Status:   ${isAlreadyManager ? 'Already Manager' : 'Not Manager'}`);
		console.log('  New Status:       Manager (can configure global pools)');
		console.log('═══════════════════════════════════════════════════════════\n');

		// Confirm action
		const confirmation = await prompt('Add this account as a global prize manager? (yes/no): ');
		if (confirmation.toLowerCase() !== 'yes' && confirmation.toLowerCase() !== 'y') {
			console.log('❌ Operation cancelled by user');
			process.exit(0);
		}

		// Estimate gas
		console.log('\n⛽ Estimating gas...\n');
		const gasInfo = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'addGlobalPrizeManager',
			[managerAddress],
			150000,
		);
		const gasEstimate = gasInfo.gasLimit;

		console.log(`Estimated gas: ${gasEstimate}`);

		// Execute transaction with 20% buffer
		const gasToUse = Math.floor(gasEstimate * 1.2);
		console.log(`Using gas: ${gasToUse} (20% buffer)\n`);

		console.log('📤 Adding global prize manager...\n');

		const [receipt, , record] = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasToUse,
			'addGlobalPrizeManager',
			[managerAddress],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('✅ Transaction successful!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		// Wait for mirror node to sync
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await sleep(5000);

		// Verify manager status
		console.log('🔍 Verifying manager status...\n');
		encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPrizeManager', [managerAddress]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const verifyManager = poolManagerIface.decodeFunctionResult('isGlobalPrizeManager', result)[0];

		if (verifyManager) {
			console.log('✅ Manager status verified!\n');
			console.log(`${managerId.toString()} is now a global prize manager\n`);
		}
		else {
			console.log('⚠️  Warning: Manager status not confirmed. This may be a timing issue with the mirror node.\n');
		}

		console.log('✨ Global prize manager added successfully!\n');
		console.log('💡 This account can now configure prizes for global pools using prize management scripts.\n');

	}
	catch (error) {
		console.error('\n❌ Error adding global prize manager:', error.message);
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
addGlobalPrizeManager();
