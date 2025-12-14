/**
 * Manage Global Prize Managers
 *
 * Allows admin to:
 * - View all global prize managers
 * - Add a new global prize manager
 * - Remove an existing global prize manager
 * - Check if an account is a global prize manager
 * Usage: node scripts/interactions/LazyLotto/admin/manageGlobalPrizeManagers.js
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	ContractExecuteTransaction,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

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

async function convertToEvmAddress(accountId) {
	// Convert Hedera account ID to EVM address format
	const account = AccountId.fromString(accountId);
	const accountNum = account.num;
	const evmAddress = '0x' + accountNum.toString(16).padStart(40, '0');
	return evmAddress;
}

async function manageGlobalPrizeManagers() {
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
		console.log('║        Manage Global Prize Managers (Admin)               ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Load interface
		const poolManagerJson = JSON.parse(
			fs.readFileSync(
				'./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json',
			),
		);
		const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		// Show menu
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎯 Options');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
		console.log('   1. View all global prize managers');
		console.log('   2. Add a global prize manager');
		console.log('   3. Remove a global prize manager');
		console.log('   4. Check if account is a global prize manager\n');

		const choice = await promptForInput('Select option (1-4): ');

		if (choice === '1') {
			// View all
			console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('📋 Global Prize Managers');
			console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

			const encodedCommand = poolManagerIface.encodeFunctionData('getGlobalPrizeManagers', [0, 100]);
			const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
			const managers = poolManagerIface.decodeFunctionResult('getGlobalPrizeManagers', result);

			if (managers[0].length === 0) {
				console.log('   No global prize managers configured.\n');
			}
			else {
				console.log(`   Total: ${managers[0].length}\n`);
				for (let i = 0; i < managers[0].length; i++) {
					// Convert EVM address to Hedera ID
					const evmAddress = managers[0][i];
					// Simple conversion for display (may need mirror node lookup for full conversion)
					console.log(`   ${i + 1}. ${evmAddress}`);
				}
				console.log('');
			}
		}
		else if (choice === '2') {
			// Add
			const accountInput = await promptForInput('\nEnter account ID to add (e.g., 0.0.12345): ');

			let accountId;
			try {
				accountId = AccountId.fromString(accountInput);
			}
			catch (error) {
				console.error('❌ Invalid account ID format.', error.message);
				return;
			}

			const evmAddress = await convertToEvmAddress(accountId.toString());

			// Check if already a manager
			const checkCommand = poolManagerIface.encodeFunctionData('isGlobalPrizeManager', [evmAddress]);
			const checkResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, checkCommand, operatorId, false);
			const isManager = poolManagerIface.decodeFunctionResult('isGlobalPrizeManager', checkResult);

			if (isManager[0]) {
				console.log(`\n⚠️  ${accountId.toString()} is already a global prize manager.\n`);
				return;
			}

			const confirm = await promptForInput(`\n❓ Confirm adding ${accountId.toString()} as global prize manager? (yes/no): `);
			if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
				console.log('\n❌ Operation cancelled.\n');
				return;
			}

			console.log('\n⏳ Adding global prize manager...\n');

			const encodedFunction = poolManagerIface.encodeFunctionData('addGlobalPrizeManager', [evmAddress]);

			const tx = await new ContractExecuteTransaction()
				.setContractId(poolManagerId)
				.setGas(300000)
				.setFunction('addGlobalPrizeManager', Buffer.from(encodedFunction.slice(2), 'hex'))
				.execute(client);

			const receipt = await tx.getReceipt(client);

			if (receipt.status.toString() !== 'SUCCESS') {
				throw new Error(`Transaction failed with status: ${receipt.status.toString()}`);
			}

			console.log('✅ Global prize manager added successfully!\n');
			console.log(`   Account: ${accountId.toString()}`);
			console.log(`   Transaction: ${tx.transactionId.toString()}`);
			console.log(`   Status: ${receipt.status.toString()}\n`);
		}
		else if (choice === '3') {
			// Remove
			const accountInput = await promptForInput('\nEnter account ID to remove (e.g., 0.0.12345): ');

			let accountId;
			try {
				accountId = AccountId.fromString(accountInput);
			}
			catch (error) {
				console.error('❌ Invalid account ID format.', error.message);
				return;
			}

			const evmAddress = await convertToEvmAddress(accountId.toString());

			// Check if is a manager
			const checkCommand = poolManagerIface.encodeFunctionData('isGlobalPrizeManager', [evmAddress]);
			const checkResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, checkCommand, operatorId, false);
			const isManager = poolManagerIface.decodeFunctionResult('isGlobalPrizeManager', checkResult);

			if (!isManager[0]) {
				console.log(`\n⚠️  ${accountId.toString()} is not a global prize manager.\n`);
				return;
			}

			const confirm = await promptForInput(`\n❓ Confirm removing ${accountId.toString()} as global prize manager? (yes/no): `);
			if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
				console.log('\n❌ Operation cancelled.\n');
				return;
			}

			console.log('\n⏳ Removing global prize manager...\n');

			const encodedFunction = poolManagerIface.encodeFunctionData('removeGlobalPrizeManager', [evmAddress]);

			const tx = await new ContractExecuteTransaction()
				.setContractId(poolManagerId)
				.setGas(300000)
				.setFunction('removeGlobalPrizeManager', Buffer.from(encodedFunction.slice(2), 'hex'))
				.execute(client);

			const receipt = await tx.getReceipt(client);

			if (receipt.status.toString() !== 'SUCCESS') {
				throw new Error(`Transaction failed with status: ${receipt.status.toString()}`);
			}

			console.log('✅ Global prize manager removed successfully!\n');
			console.log(`   Account: ${accountId.toString()}`);
			console.log(`   Transaction: ${tx.transactionId.toString()}`);
			console.log(`   Status: ${receipt.status.toString()}\n`);
		}
		else if (choice === '4') {
			// Check
			const accountInput = await promptForInput('\nEnter account ID to check (e.g., 0.0.12345): ');

			let accountId;
			try {
				accountId = AccountId.fromString(accountInput);
			}
			catch (error) {
				console.error('❌ Invalid account ID format.', error.message);
				return;
			}

			const evmAddress = await convertToEvmAddress(accountId.toString());

			const checkCommand = poolManagerIface.encodeFunctionData('isGlobalPrizeManager', [evmAddress]);
			const checkResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, checkCommand, operatorId, false);
			const isManager = poolManagerIface.decodeFunctionResult('isGlobalPrizeManager', checkResult);

			console.log(`\n${isManager[0] ? '✅' : '❌'} ${accountId.toString()} ${isManager[0] ? 'IS' : 'IS NOT'} a global prize manager.\n`);
		}
		else {
			console.log('\n❌ Invalid option.\n');
		}

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.error('\n❌ Error managing global prize managers:');
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

// Run the script
manageGlobalPrizeManagers();
