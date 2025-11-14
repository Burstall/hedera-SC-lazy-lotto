/**
 * LazyLotto Manage Roles Script
 *
 * Add or remove admin and prize manager roles.
 * Requires ADMIN role to execute.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/manageRoles.js
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

async function manageRoles() {
	let client;

	try {
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
		console.log('║            LazyLotto Manage Roles (Admin)                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../utils/gasHelpers');

		// Menu
		console.log('Select action:');
		console.log('1. Add Admin');
		console.log('2. Remove Admin');
		console.log('3. Add Prize Manager');
		console.log('4. Remove Prize Manager');

		const choice = await prompt('\nEnter choice (1-4): ');

		let operation, functionName;

		switch (choice) {
		case '1':
			operation = 'add';
			functionName = 'addAdmin';
			console.log('\n➕ Add Admin\n');
			break;
		case '2':
			operation = 'remove';
			functionName = 'removeAdmin';
			console.log('\n➖ Remove Admin\n');
			break;
		case '3':
			operation = 'add';
			functionName = 'addPrizeManager';
			console.log('\n➕ Add Prize Manager\n');
			break;
		case '4':
			operation = 'remove';
			functionName = 'removePrizeManager';
			console.log('\n➖ Remove Prize Manager\n');
			break;
		default:
			console.error('❌ Invalid choice');
			process.exit(1);
		}

		// Get address
		const addressInput = await prompt('Enter Hedera account ID (0.0.xxxxx) or EVM address: ');

		let targetAddress;
		if (addressInput.startsWith('0x')) {
			// EVM address
			targetAddress = addressInput;
		}
		else {
			// Hedera ID - convert to EVM
			try {
				const accountId = AccountId.fromString(addressInput);
				targetAddress = accountId.toSolidityAddress();
			}
			catch {
				console.error('❌ Invalid account ID format');
				process.exit(1);
			}
		}

		console.log(`\nTarget address: ${targetAddress}`);

		// Estimate gas
		const encodedCommand = lazyLottoIface.encodeFunctionData(functionName, [targetAddress]);
		const gasEstimate = await estimateGas(env, contractId, encodedCommand, operatorId);
		console.log(`⛽ Estimated gas: ~${gasEstimate} gas\n`);

		// Confirm
		const roleType = functionName.includes('Admin') ? 'Admin' : 'Prize Manager';
		const confirm = await prompt(`${operation === 'add' ? 'Add' : 'Remove'} ${roleType} role ${operation === 'add' ? 'to' : 'from'} ${addressInput}? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log(`\n🔄 ${operation === 'add' ? 'Adding' : 'Removing'} ${roleType.toLowerCase()}...`);

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [success, txReceipt] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			functionName,
			[targetAddress],
		);

		if (!success) {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log(`\n✅ ${roleType} role ${operation === 'add' ? 'added' : 'removed'} successfully!`);
		console.log(`📋 Transaction: ${txReceipt.transactionId.toString()}\n`);

	}
	catch (error) {
		console.error('\n❌ Error managing roles:', error.message);
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
manageRoles();
