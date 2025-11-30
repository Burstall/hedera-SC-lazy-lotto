/**
 * LazyLotto Admin Buy and Redeem Entry Script
 *
 * Admin function to buy free entries for themselves and immediately redeem to NFTs.
 * Useful for testing, promotions, or creating example tickets.
 * Requires ADMIN role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/buyAndRedeemEntry.js
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

async function buyAndRedeemEntry() {
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
		console.log('║     LazyLotto Admin Buy & Redeem Entry (Admin)            ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

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

		// Get ticket count
		const ticketCountStr = await prompt('Enter number of tickets to create: ');

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

		console.log(`\n🎫 Creating ${ticketCount} free NFT tickets`);
		console.log(`   Pool: ${poolId}`);
		console.log(`   Recipient: ${operatorId.toString()} (admin)`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'adminBuyAndRedeemEntry', [
			poolId,
			ticketCount,
		], 200000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		const confirm = await prompt(`Create ${ticketCount} free NFT tickets? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Creating NFT tickets...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'adminBuyAndRedeemEntry',
			[poolId, ticketCount],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ NFT tickets created successfully!');
		console.log(`🎫 ${ticketCount} tickets minted to ${operatorId.toString()}`);
		console.log(`   Pool: ${poolId}`);
		console.log(`📋 Transaction: ${record.transactionId.toString()}`);

		// Try to decode serial numbers from record
		try {
			const logData = record.contractFunctionResult.logs.find(log => {
				try {
					const parsed = lazyLottoIface.parseLog({
						topics: log.topics,
						data: log.data,
					});
					return parsed && parsed.name === 'TicketEvent';
				}
				catch {
					return false;
				}
			});

			if (logData) {
				const parsed = lazyLottoIface.parseLog({
					topics: logData.topics,
					data: logData.data,
				});
				const serials = parsed.args.serialNumber;
				console.log(`🎟️  Serial numbers: ${serials.join(', ')}\n`);
			}
			else {
				console.log('');
			}
		}
		catch {
			console.log('');
		}

	}
	catch (error) {
		console.error('\n❌ Error creating tickets:', error.message);
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
buyAndRedeemEntry();
