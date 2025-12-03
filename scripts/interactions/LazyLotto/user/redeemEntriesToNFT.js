/**
 * LazyLotto Redeem Entries to NFT Script
 *
 * Converts memory entries (tickets) to NFT format.
 * Separate from buyAndRedeemToNFT - this only converts existing entries.
 *
 * Usage: node scripts/interactions/LazyLotto/user/redeemEntriesToNFT.js [poolId] [quantity]
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

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR';
	}

	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

async function redeemEntriesToNFT() {
	let client;

	try {
		let poolIdStr = process.argv[2];
		let quantityStr = process.argv[3];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID: ');
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
		console.log('║        LazyLotto Redeem Entries to NFT Tickets            ║');
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
		const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		console.log('🔍 Checking your entries...');

		// Get user's entries
		const userEvmAddress = operatorId.toSolidityAddress();
		let encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);
		const entriesResult = lazyLottoIface.decodeFunctionResult('getUsersEntries', result);
		const entries = entriesResult[0];

		const totalEntries = Number(entries);

		if (totalEntries === 0) {
			console.error('\n❌ You have no memory entries in this pool');
			process.exit(1);
		}

		console.log(`✅ You have ${totalEntries} memory entries in pool #${poolId}\n`);

		// Get pool details
		encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken] =
			lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);

		console.log('Pool Token:', await convertToHederaId(poolTokenId));

		// Determine quantity to redeem
		let quantity;

		if (!quantityStr) {
			const response = await prompt(`\nRedeem all ${totalEntries} entries? (yes/no): `);
			if (response.toLowerCase() === 'yes' || response.toLowerCase() === 'y') {
				quantity = totalEntries;
			}
			else {
				quantityStr = await prompt(`Enter quantity to redeem (1-${totalEntries}): `);
				quantity = parseInt(quantityStr);
			}
		}
		else {
			quantity = parseInt(quantityStr);
		}

		if (isNaN(quantity) || quantity <= 0 || quantity > totalEntries) {
			console.error(`\n❌ Invalid quantity (must be 1-${totalEntries})`);
			process.exit(1);
		}

		console.log(`\n📦 Converting ${quantity} memory entries to NFT tickets...\n`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'redeemEntriesToNFT', [poolId, quantity], 300000);
		const gasEstimate = gasInfo.gasLimit;
		const gasLimit = Math.floor(gasEstimate * 1.2);

		console.log(`⛽ Estimated gas: ${gasEstimate} (with 20% buffer: ${gasLimit})\n`);

		// Confirm
		const confirm = await prompt('Proceed with redemption? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Redemption cancelled');
			process.exit(0);
		}

		// Execute the redemption
		console.log('\n🔄 Redeeming entries to NFT tickets...');

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'redeemEntriesToNFT',
			[poolId, quantity],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Entries redeemed to NFT tickets successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🎨 Your memory entries have been converted to tradeable NFT tickets.');
		console.log('   You can now:');
		console.log('   - Roll them with rollWithNFT.js');
		console.log('   - Trade them on secondary markets');
		console.log('   - Hold them for later use\n');

	}
	catch (error) {
		console.error('\n❌ Error redeeming entries:', error.message);
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
redeemEntriesToNFT();
