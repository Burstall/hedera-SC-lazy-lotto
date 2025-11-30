/**
 * LazyLotto Admin Grant Entry Script
 *
 * Grant free entries to users (as in-memory entries, not NFTs).
 * Useful for promotions, airdrops, or compensation.
 * Requires ADMIN role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/grantEntry.js
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

async function grantEntry() {
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
		console.log('║          LazyLotto Admin Grant Entry (Admin)              ║');
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

		// Get total pools
		const encodedQuery = lazyLottoIface.encodeFunctionData('totalPools', []);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedQuery, operatorId, false);
		const decoded = lazyLottoIface.decodeFunctionResult('totalPools', result);
		const totalPools = Number(decoded[0]);

		if (totalPools === 0) {
			console.error('❌ No pools exist in the contract');
			process.exit(1);
		}

		console.log(`📊 Total pools: ${totalPools}\n`);

		// Get pool ID
		const poolIdStr = await prompt(`Enter pool ID (0-${totalPools - 1}): `);

		let poolId;
		try {
			poolId = parseInt(poolIdStr);
			if (isNaN(poolId) || poolId < 0 || poolId >= totalPools) {
				console.error(`❌ Pool ID must be between 0 and ${totalPools - 1}`);
				process.exit(1);
			}
		}
		catch {
			console.error('❌ Invalid pool ID format');
			process.exit(1);
		}

		// Get recipient address
		const recipientInput = await prompt('Enter recipient (0.0.xxxxx or 0x...): ');

		let recipientAddress;
		if (recipientInput.startsWith('0x')) {
			// EVM address
			recipientAddress = recipientInput;
		}
		else {
			// Hedera ID - convert to EVM
			try {
				const accountId = AccountId.fromString(recipientInput);
				recipientAddress = accountId.toSolidityAddress();
			}
			catch {
				console.error('❌ Invalid account ID format');
				process.exit(1);
			}
		}

		// Get ticket count
		const ticketCountStr = await prompt('Enter number of tickets to grant: ');

		let ticketCount;
		try {
			ticketCount = parseInt(ticketCountStr);
			if (isNaN(ticketCount) || ticketCount <= 0) {
				console.error('❌ Ticket count must be positive');
				process.exit(1);
			}
		}
		catch {
			console.error('❌ Invalid ticket count format');
			process.exit(1);
		}

		console.log(`\n🎁 Granting ${ticketCount} free entries`);
		console.log(`   Pool: ${poolId}`);
		console.log(`   Recipient: ${recipientInput}`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'adminGrantEntry', [
			poolId,
			ticketCount,
			recipientAddress,
		], 200000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		const confirm = await prompt(`Grant ${ticketCount} entries to ${recipientInput}? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Granting entries...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'adminGrantEntry',
			[poolId, ticketCount, recipientAddress],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Entries granted successfully!');
		console.log(`🎁 ${ticketCount} entries granted to ${recipientInput}`);
		console.log(`   Pool: ${poolId}`);
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

	}
	catch (error) {
		console.error('\n❌ Error granting entries:', error.message);
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
grantEntry();
