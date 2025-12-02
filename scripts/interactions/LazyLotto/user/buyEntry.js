/**
 * LazyLotto Buy Entry Script
 *
 * Purchase memory entries (tickets) for a lottery pool.
 * Memory entries can be rolled later using rollTickets.js
 *
 * Usage: node scripts/interactions/LazyLotto/user/buyEntry.js [poolId] [quantity]
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

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

// Helper: Convert Hedera ID to EVM address
async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	return await homebrewPopulateAccountNum(env, evmAddress);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

// Helper: Format HBAR
function formatHbar(tinybars) {
	return (Number(tinybars) / 100_000_000).toFixed(8) + ' ℏ';
}

async function buyEntry() {
	let client;

	try {
		// Get pool ID
		let poolIdStr = process.argv[2];
		let quantityStr = process.argv[3];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID: ');
		}

		if (!quantityStr) {
			quantityStr = await prompt('Enter quantity to purchase: ');
		}

		const poolId = parseInt(poolIdStr);
		const quantity = parseInt(quantityStr);

		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		if (isNaN(quantity) || quantity <= 0) {
			console.error('❌ Invalid quantity (must be positive)');
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
		console.log('║              LazyLotto Buy Entry                          ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}`);
		console.log(`🎫 Quantity: ${quantity}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		console.log('🔍 Fetching pool details...\n');

		// Get pool details
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [poolId]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolDetailsResult = lazyLottoIface.decodeFunctionResult('getPoolDetails', result);
		const poolDetails = poolDetailsResult[0];

		// Validate pool state
		if (poolDetails.paused) {
			console.error('❌ Pool is paused. Cannot buy entries.');
			process.exit(1);
		}

		if (poolDetails.closed) {
			console.error('❌ Pool is closed. Cannot buy entries.');
			process.exit(1);
		}

		// Display pool info
		const feeToken = await convertToHederaId(poolDetails.feeToken);
		const feePerEntry = poolDetails.entryFee;
		const totalFee = BigInt(feePerEntry) * BigInt(quantity);

		// Get token details for formatting
		let tokenDets = null;
		if (feeToken !== 'HBAR') {
			tokenDets = await getTokenDetails(env, feeToken);
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Win Rate:         ${formatWinRate(Number(poolDetails.winRateThousandthsOfBps))}`);
		console.log(`  Entry Fee:        ${feeToken === 'HBAR' ? new Hbar(Number(feePerEntry), HbarUnit.Tinybar).toString() : `${Number(feePerEntry) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log(`  Pool Token:       ${await convertToHederaId(poolDetails.poolTokenId)}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PURCHASE SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Quantity:         ${quantity} entries`);
		console.log(`  Total Cost:       ${feeToken === 'HBAR' ? new Hbar(Number(totalFee), HbarUnit.Tinybar).toString() : `${Number(totalFee) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log('═══════════════════════════════════════════════════════════\n');		// Check if FT payment required
		if (feeToken !== 'HBAR') {
			const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');
			const balance = await checkMirrorBalance(env, operatorId.toString(), feeToken);

			console.log(`💰 Your ${tokenDets.symbol} balance: ${Number(balance) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}\n`);

			if (BigInt(balance) < totalFee) {
				console.error(`❌ Insufficient ${tokenDets.symbol} balance`);
				console.error(`   Required: ${Number(totalFee) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`);
				console.error(`   Available: ${Number(balance) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`);
				process.exit(1);
			}

			// Check allowance to storage contract
			encodedCommand = lazyLottoIface.encodeFunctionData('storageContract');
			result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
			const storageAddress = lazyLottoIface.decodeFunctionResult('storageContract', result);
			const storageId = await convertToHederaId(storageAddress[0]);

			console.log(`📝 Note: Token approval must be set for storage contract: ${storageId}`);
			console.log('   Use Hedera token approval or the LazyGasStation for allowances.\n');
		}

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'buyEntry', [poolId, quantity], 300000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm purchase
		const confirm = await prompt('Proceed with purchase? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Purchase cancelled');
			process.exit(0);
		}

		// Execute purchase
		console.log('\n🔄 Purchasing entries...');

		// 20% buffer for gas
		const gasLimit = Math.floor(gasEstimate * 1.2);
		const payableAmount = feeToken === 'HBAR' ? totalFee.toString() : '0';

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'buyEntry',
			[poolId, quantity],
			payableAmount,
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Entries purchased successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		// Get updated entry count
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();
		encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const entries = lazyLottoIface.decodeFunctionResult('getUsersEntries', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED STATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Your entries in pool #${poolId}: ${entries[0]}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('💡 Next steps:');
		console.log('   - Use rollTickets.js to play your entries');
		console.log('   - Use userState.js to view your tickets and prizes\n');

	}
	catch (error) {
		console.error('\n❌ Error buying entries:', error.message);
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
buyEntry();
