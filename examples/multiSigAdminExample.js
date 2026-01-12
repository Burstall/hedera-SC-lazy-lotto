/**
 * Multi-Sig Admin Script Example
 *
 * This example demonstrates how to integrate multi-sig support into LazyLotto admin scripts.
 * Use this as a template for updating existing admin scripts.
 *
 * Based on: scripts/interactions/LazyLotto/admin/setPlatformFee.js
 *
 * Usage:
 *   Single-sig: node examples/multiSigAdminExample.js [percentage]
 *   Multi-sig:  node examples/multiSigAdminExample.js [percentage] --multisig
 *   Help:       node examples/multiSigAdminExample.js --multisig-help
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

const { readOnlyEVMFromMirrorNode } = require('../utils/solidityHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../utils/scriptHelpers');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);

function promptForInput(question) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

async function setPlatformFee(percentage) {
	let client;

	try {
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
		console.log('║         Set Platform Fee Percentage (Admin)               ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load interface
		const poolManagerJson = JSON.parse(
			fs.readFileSync(
				'./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json',
			),
		);
		const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		// Get current percentage
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 Current Platform Fee');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const encodedCommand = poolManagerIface.encodeFunctionData('platformProceedsPercentage');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const currentPercentage = poolManagerIface.decodeFunctionResult('platformProceedsPercentage', result);

		const currentPercent = Number(currentPercentage[0]);
		const currentOwnerPercent = 100 - currentPercent;

		console.log(`   Platform: ${currentPercent}%`);
		console.log(`   Pool Owner: ${currentOwnerPercent}%\n`);

		const ownerPercent = 100 - percentage;

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🆕 New Platform Fee');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`   Platform: ${percentage}%`);
		console.log(`   Pool Owner: ${ownerPercent}%\n`);

		// Confirm
		const confirm = await promptForInput('❓ Confirm setting new platform fee? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled.\n');
			return;
		}

		console.log('\n⏳ Setting platform fee percentage...\n');

		// ============================================================================
		// MULTI-SIG INTEGRATION POINT
		// ============================================================================
		// OLD CODE (single-sig only):
		//
		// const encodedFunction = poolManagerIface.encodeFunctionData('setPlatformProceedsPercentage', [percentage]);
		//
		// const tx = await new ContractExecuteTransaction()
		// 	.setContractId(poolManagerId)
		// 	.setGas(300000)
		// 	.setFunction('setPlatformProceedsPercentage', Buffer.from(encodedFunction.slice(2), 'hex'))
		// 	.execute(client);
		//
		// const receipt = await tx.getReceipt(client);
		//
		// if (receipt.status.toString() !== 'SUCCESS') {
		// 	throw new Error(`Transaction failed with status: ${receipt.status.toString()}`);
		// }
		//
		// ============================================================================
		// NEW CODE (single-sig + multi-sig support):
		// ============================================================================

		const executionResult = await executeContractFunction({
			contractId: poolManagerId,
			iface: poolManagerIface,
			client: client,
			functionName: 'setPlatformProceedsPercentage',
			params: [percentage],
			gas: 300000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt } = executionResult;

		// ============================================================================
		// END INTEGRATION POINT
		// ============================================================================

		console.log('✅ Platform fee updated successfully!\n');

		// Handle different receipt formats (single-sig vs multi-sig)
		const txId = receipt.transactionId?.toString() || 'N/A';
		const status = receipt.status?.toString() || 'SUCCESS';

		console.log(`   Transaction: ${txId}`);
		console.log(`   Status: ${status}\n`);

		// Verify new percentage
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('✓ Verified New Fee');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Wait for mirror node propagation
		console.log('⏳ Waiting for mirror node propagation (5 seconds)...');
		await new Promise(resolve => setTimeout(resolve, 5000));

		const verifyResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const newPercentage = poolManagerIface.decodeFunctionResult('platformProceedsPercentage', verifyResult);

		const newPercent = Number(newPercentage[0]);
		const newOwnerPercent = 100 - newPercent;

		console.log(`   Platform: ${newPercent}%`);
		console.log(`   Pool Owner: ${newOwnerPercent}%\n`);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.error('\n❌ Error setting platform fee:');
		console.error(error.message);
		if (error.stack) {
			console.error('\nStack trace:');
			console.error(error.stack);
		}
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

async function main() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	// Check for command line argument
	let percentage = process.argv[2];

	// Filter out flag arguments when getting percentage
	if (percentage && percentage.startsWith('--')) {
		percentage = null;
	}

	// If not provided, prompt
	if (!percentage) {
		percentage = await promptForInput('Enter platform fee percentage (0-25): ');
	}

	percentage = parseInt(percentage);

	if (isNaN(percentage) || percentage < 0 || percentage > 25) {
		console.error('❌ Invalid percentage. Must be between 0 and 25.');
		process.exit(1);
	}

	await setPlatformFee(percentage);
}

// Run the script
main();
