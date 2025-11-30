/**
 * LazyLotto Buy and Roll Entry Script
 *
 * Combined operation: Buy entry tickets and immediately roll them.
 * More efficient than separate buy + roll transactions.
 * Uses 2x gas multiplier for roll portion due to PRNG uncertainty.
 *
 * Usage: node scripts/interactions/LazyLotto/user/buyAndRoll.js [poolId] [numEntries] [paymentToken] [amount]
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
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
const storageContractId = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE_CONTRACT_ID);

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

async function buyAndRoll() {
	let client;

	try {
		// Get parameters
		let poolIdStr = process.argv[2];
		let numEntriesStr = process.argv[3];
		let paymentTokenStr = process.argv[4];
		let amountStr = process.argv[5];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		if (!numEntriesStr) {
			numEntriesStr = await prompt('Enter number of entries to buy: ');
		}

		const numEntries = parseInt(numEntriesStr);
		if (isNaN(numEntries) || numEntries <= 0) {
			console.error('❌ Invalid number of entries');
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
		console.log('║          LazyLotto Buy & Roll Entries (Combined)          ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}`);
		console.log(`🎫 Entries: ${numEntries}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');
		const { queryTokenBalance, associateToken } = require('../../../../utils/hederaMirrorHelpers');

		// Get pool details
		console.log('🔍 Fetching pool details...');

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
			console.error('\n❌ Pool does not exist');
			process.exit(1);
		}

		if (poolDetails.closed) {
			console.error('\n❌ Pool is closed');
			process.exit(1);
		}

		if (poolDetails.paused) {
			console.error('\n❌ Pool is paused');
			process.exit(1);
		}

		console.log(`Pool: "${poolDetails.name}"`);
		console.log(`Cost per entry: ${ethers.formatUnits(poolDetails.costPerEntry, poolDetails.decimals)} tokens`);

		// Payment token details
		const paymentTokenHederaId = await convertToHederaId(poolDetails.paymentToken);
		console.log(`Payment token: ${paymentTokenHederaId}\n`);

		// Calculate total cost
		const totalCost = poolDetails.costPerEntry * BigInt(numEntries);

		// Get payment token if not provided
		if (!paymentTokenStr) {
			paymentTokenStr = paymentTokenHederaId;
		}

		// Validate payment token matches
		const inputHederaId = paymentTokenStr === 'HBAR' ? 'HBAR' : await convertToHederaId(paymentTokenStr);
		if (inputHederaId !== paymentTokenHederaId) {
			console.error(`❌ Payment token mismatch. Pool requires: ${paymentTokenHederaId}`);
			process.exit(1);
		}

		// Get amount if not provided
		if (!amountStr) {
			const defaultAmount = ethers.formatUnits(totalCost, poolDetails.decimals);
			amountStr = await prompt(`Enter amount to pay (default ${defaultAmount}): `) || defaultAmount;
		}

		// Parse payment amount
		let paymentAmount;
		try {
			paymentAmount = ethers.parseUnits(amountStr, poolDetails.decimals);
		}
		catch {
			console.error('❌ Invalid amount format');
			process.exit(1);
		}

		if (paymentAmount < totalCost) {
			console.error(`❌ Insufficient payment. Required: ${ethers.formatUnits(totalCost, poolDetails.decimals)}`);
			process.exit(1);
		}

		console.log(`💰 Payment: ${ethers.formatUnits(paymentAmount, poolDetails.decimals)} ${inputHederaId}\n`);

		// Check balance and association for fungible tokens
		if (paymentTokenHederaId !== 'HBAR') {
			const tokenId = TokenId.fromSolidityAddress(poolDetails.paymentToken);

			// Check balance
			const balance = await queryTokenBalance(env, operatorId.toString(), tokenId.toString());
			if (balance < paymentAmount) {
				console.error(`❌ Insufficient balance. Have: ${ethers.formatUnits(balance, poolDetails.decimals)}, Need: ${ethers.formatUnits(paymentAmount, poolDetails.decimals)}`);
				process.exit(1);
			}

			console.log(`✅ Balance sufficient: ${ethers.formatUnits(balance, poolDetails.decimals)} ${paymentTokenHederaId}`);

			// Check association
			const associated = await queryTokenBalance(env, operatorId.toString(), tokenId.toString());
			if (associated === null) {
				console.log('\n🔗 Token not associated. Associating...');
				await associateToken(client, operatorId, tokenId);
				console.log('✅ Token associated');
			}

			// Check allowance - must approve storage contract
			console.log('\n⚠️  Ensure token approval to storage contract:');
			console.log(`   ${storageContractId.toString()}`);
			console.log(`   Amount: ${ethers.formatUnits(paymentAmount, poolDetails.decimals)}\n`);
		}
		else {
			// HBAR payment - check balance via mirror node
			const { homebrewGetBalance } = require('../../../../utils/hederaMirrorHelpers');
			const hbarBalance = await homebrewGetBalance(env, operatorId.toString());

			if (hbarBalance < paymentAmount) {
				console.error(`❌ Insufficient HBAR. Have: ${ethers.formatEther(hbarBalance)}, Need: ${ethers.formatEther(paymentAmount)}`);
				process.exit(1);
			}

			console.log(`✅ HBAR balance sufficient: ${ethers.formatEther(hbarBalance)} ℏ\n`);
		}

		// Estimate gas with 2x multiplier for roll portion
		console.log('⛽ Estimating gas (2x multiplier for PRNG rolls)...');

		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'buyAndRollEntry', [poolId, numEntries, paymentAmount], 800000);
		const gasEstimate = gasInfo.gasLimit;

		// Apply 2x multiplier for roll operations
		const gasWithMultiplier = Math.floor(gasEstimate * 2);
		console.log(`   Base estimate: ${gasEstimate} gas`);
		console.log(`   With 2x multiplier: ${gasWithMultiplier} gas\n`);

		// Confirm
		const confirm = await prompt(`Buy ${numEntries} entries and roll immediately? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Buying and rolling entries...');

		const gasLimit = Math.floor(gasWithMultiplier * 1.2);

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'buyAndRollEntry',
			[poolId, numEntries, paymentAmount],
			paymentTokenHederaId === 'HBAR' ? paymentAmount : undefined,
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Buy and roll completed!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		// Parse logs to find wins
		console.log('🎲 Roll Results:');
		console.log('   Check userState.js for updated pending prizes\n');

	}
	catch (error) {
		console.error('\n❌ Error buying and rolling:', error.message);
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
buyAndRoll();
