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

// Helper: Convert Hedera ID to EVM address
async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	const { homebrewPopulateAccountNum } = require('../../../utils/hederaMirrorHelpers');
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
		const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../utils/gasHelpers');

		console.log('🔍 Fetching pool details...\n');

		// Get pool details
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [poolId]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolDetails', result);

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

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Win Rate:         ${formatWinRate(poolDetails.winRateThousandthsOfBps)}`);
		console.log(`  Entry Fee:        ${feeToken === 'HBAR' ? formatHbar(feePerEntry) : `${feePerEntry} ${feeToken}`}`);
		console.log(`  Pool Token:       ${await convertToHederaId(poolDetails.poolTokenId)}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PURCHASE SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Quantity:         ${quantity} entries`);
		console.log(`  Total Cost:       ${feeToken === 'HBAR' ? formatHbar(totalFee) : `${totalFee} ${feeToken}`}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Check if FT payment required
		if (feeToken !== 'HBAR') {
			const { checkMirrorBalance } = require('../../../utils/hederaMirrorHelpers');
			const balance = await checkMirrorBalance(env, operatorId.toString(), feeToken);

			console.log(`💰 Your ${feeToken} balance: ${balance}\n`);

			if (BigInt(balance) < totalFee) {
				console.error(`❌ Insufficient ${feeToken} balance`);
				console.error(`   Required: ${totalFee}`);
				console.error(`   Available: ${balance}`);
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
		encodedCommand = lazyLottoIface.encodeFunctionData('buyEntry', [poolId, quantity]);
		const gasEstimate = await estimateGas(env, contractId, encodedCommand, operatorId);
		console.log(`⛽ Estimated gas: ~${gasEstimate} gas\n`);

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

		const [success, txReceipt] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'buyEntry',
			[poolId, quantity],
			payableAmount,
		);

		if (!success) {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Entries purchased successfully!');
		console.log(`📋 Transaction: ${txReceipt.transactionId.toString()}\n`);

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
