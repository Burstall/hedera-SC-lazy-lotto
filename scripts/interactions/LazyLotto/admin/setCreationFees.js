/**
 * LazyLotto Set Creation Fees Script
 *
 * Allows admin to update the HBAR and LAZY fees required to create community pools.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/setCreationFees.js [--hbar <amount>] [--lazy <amount>]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/setCreationFees.js [--hbar <amount>] [--lazy <amount>] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/setCreationFees.js --multisig-help
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
	Hbar,
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

async function setCreationFees() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let hbarFeeInput = null;
		let lazyFeeInput = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--hbar' && args[i + 1]) {
				hbarFeeInput = args[i + 1];
				i++;
			}
			else if (args[i] === '--lazy' && args[i + 1]) {
				lazyFeeInput = args[i + 1];
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
		console.log('║         LazyLotto Set Creation Fees (Admin)               ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load PoolManager ABI
		const poolManagerJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json'),
		);
		const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

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

		// Get current fees
		console.log('🔍 Fetching current fees...\n');
		encodedCommand = poolManagerIface.encodeFunctionData('getCreationFees');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const [currentHbarFee, currentLazyFee] = poolManagerIface.decodeFunctionResult('getCreationFees', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CURRENT FEES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR Fee:         ${Hbar.fromTinybars(currentHbarFee).toString()}`);
		console.log(`  LAZY Fee:         ${currentLazyFee} LAZY`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Prompt for new fees if not provided
		if (hbarFeeInput === null) {
			hbarFeeInput = await prompt(`Enter new HBAR fee (current: ${Hbar.fromTinybars(currentHbarFee).toString()}): `);
		}

		if (lazyFeeInput === null) {
			lazyFeeInput = await prompt(`Enter new LAZY fee (current: ${currentLazyFee}): `);
		}

		// Parse and validate fees
		const newHbarFee = Hbar.from(parseFloat(hbarFeeInput), Hbar.HbarUnit.Hbar);
		const newLazyFee = BigInt(lazyFeeInput);

		if (newHbarFee.toTinybars() < 0) {
			console.error('❌ HBAR fee cannot be negative');
			process.exit(1);
		}

		if (newLazyFee < 0n) {
			console.error('❌ LAZY fee cannot be negative');
			process.exit(1);
		}

		// Display new fees
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  NEW FEES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR Fee:         ${newHbarFee.toString()} (${newHbarFee.toTinybars()} tinybars)`);
		console.log(`  LAZY Fee:         ${newLazyFee} LAZY`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Confirm action
		const confirmation = await prompt('Update creation fees? (yes/no): ');
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
			'setCreationFees',
			[newHbarFee.toTinybars(), newLazyFee],
			150000,
		);
		const gasEstimate = gasInfo.gasLimit;

		console.log(`Estimated gas: ${gasEstimate}`);

		// Execute transaction with 20% buffer
		const gasToUse = Math.floor(gasEstimate * 1.2);
		console.log(`Using gas: ${gasToUse} (20% buffer)\n`);

		console.log('📤 Updating creation fees...\n');

		const executionResult = await executeContractFunction({
			contractId: poolManagerId,
			iface: poolManagerIface,
			client: client,
			functionName: 'setCreationFees',
			params: [newHbarFee.toTinybars(), newLazyFee],
			gas: gasToUse,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('✅ Transaction successful!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

		// Wait for mirror node to sync
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await sleep(5000);

		// Verify new fees
		console.log('🔍 Verifying updated fees...\n');
		encodedCommand = poolManagerIface.encodeFunctionData('getCreationFees');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const [verifyHbarFee, verifyLazyFee] = poolManagerIface.decodeFunctionResult('getCreationFees', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED FEES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR Fee:         ${Hbar.fromTinybars(verifyHbarFee).toString()}`);
		console.log(`  LAZY Fee:         ${verifyLazyFee} LAZY`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('✨ Creation fees updated successfully!\n');

	}
	catch (error) {
		console.error('\n❌ Error updating creation fees:', error.message);
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
setCreationFees();
