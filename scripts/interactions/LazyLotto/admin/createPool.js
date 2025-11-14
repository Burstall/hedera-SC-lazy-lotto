/**
 * LazyLotto Create Pool Script
 *
 * Creates a new lottery pool with specified parameters.
 * Requires ADMIN role on the contract.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/createPool.js
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

// Helper: Convert address formats
function convertToEvmAddress(hederaId) {
	if (hederaId.startsWith('0x')) return hederaId;
	const parts = hederaId.split('.');
	const num = parts[parts.length - 1];
	return '0x' + BigInt(num).toString(16).padStart(40, '0');
}

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

async function createPool() {
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
		console.log('║           LazyLotto Create Pool (Admin)                  ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../utils/gasHelpers');

		// Check admin role
		console.log('🔍 Verifying admin role...');
		const adminRole = ethers.keccak256(ethers.toUtf8Bytes('ADMIN'));
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();

		let encodedCommand = lazyLottoIface.encodeFunctionData('hasRole', [adminRole, userEvmAddress]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const hasAdmin = lazyLottoIface.decodeFunctionResult('hasRole', result);

		if (!hasAdmin[0]) {
			console.error('❌ You do not have ADMIN role on this contract');
			process.exit(1);
		}

		console.log('✅ Admin role verified\n');

		// Gather pool parameters
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL CONFIGURATION');
		console.log('═══════════════════════════════════════════════════════════\n');

		// Win rate
		const winRateStr = await prompt('Enter win rate (as percentage, e.g., 5.25 for 5.25%): ');
		const winRatePercent = parseFloat(winRateStr);

		if (isNaN(winRatePercent) || winRatePercent <= 0 || winRatePercent > 100) {
			console.error('❌ Invalid win rate (must be 0-100)');
			process.exit(1);
		}

		const winRateThousandthsOfBps = Math.floor(winRatePercent * 1_000_000);

		// Entry fee token
		const feeTokenStr = await prompt('Enter fee token (0.0.xxxxx or "HBAR"): ');
		const feeToken = feeTokenStr.toUpperCase() === 'HBAR' ? '0x0000000000000000000000000000000000000000' : convertToEvmAddress(feeTokenStr);

		// Entry fee amount
		const entryFeeStr = await prompt('Enter entry fee amount: ');
		const entryFee = entryFeeStr;

		if (isNaN(Number(entryFee)) || Number(entryFee) <= 0) {
			console.error('❌ Invalid entry fee');
			process.exit(1);
		}

		// Create new pool NFT token or use existing
		const createNewToken = await prompt('Create new pool token? (yes/no): ');

		let poolTokenId;

		if (createNewToken.toLowerCase() === 'yes' || createNewToken.toLowerCase() === 'y') {
			await prompt('Enter token name: ');
			await prompt('Enter token symbol: ');

			console.log('\n💡 Note: Pool token creation requires ~20 HBAR fee\n');

			poolTokenId = null;
		}
		else {
			const tokenIdStr = await prompt('Enter existing pool token ID (0.0.xxxxx): ');
			poolTokenId = convertToEvmAddress(tokenIdStr);
		}

		// Summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Win Rate:         ${formatWinRate(winRateThousandthsOfBps)}`);
		console.log(`  Entry Fee:        ${entryFee} ${feeToken === '0x0000000000000000000000000000000000000000' ? 'HBAR' : await convertToHederaId(feeToken)}`);
		console.log(`  Pool Token:       ${poolTokenId ? await convertToHederaId(poolTokenId) : 'NEW (will be created)'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas
		console.log('⛽ Estimating gas...');

		let functionName;
		let functionArgs;
		let payableAmount = '0';

		if (poolTokenId === null) {
			functionName = 'createPool';
			functionArgs = [winRateThousandthsOfBps, entryFee, feeToken];
			payableAmount = '2000000000';
		}
		else {
			functionName = 'createPoolWithToken';
			functionArgs = [winRateThousandthsOfBps, entryFee, feeToken, poolTokenId];
		}

		encodedCommand = lazyLottoIface.encodeFunctionData(functionName, functionArgs);
		const gasEstimate = await estimateGas(env, contractId, encodedCommand, operatorId);
		console.log(`   Gas: ~${gasEstimate}\n`);

		if (payableAmount !== '0') {
			console.log('💰 Pool creation fee: 20 HBAR (for NFT token creation)\n');
		}

		// Confirm
		const confirm = await prompt('Proceed with pool creation? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Pool creation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Creating pool...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [success, txReceipt] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			functionName,
			functionArgs,
			payableAmount,
		);

		if (!success) {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Pool created successfully!');
		console.log(`📋 Transaction: ${txReceipt.transactionId.toString()}\n`);

		// Get new pool ID
		encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', result);

		const newPoolId = Number(totalPools[0]) - 1;

		// Get pool details
		encodedCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [newPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolDetails', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  NEW POOL DETAILS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool ID:          #${newPoolId}`);
		console.log(`  Win Rate:         ${formatWinRate(poolDetails.winRateThousandthsOfBps)}`);
		console.log(`  Entry Fee:        ${entryFee} ${await convertToHederaId(poolDetails.feeToken)}`);
		console.log(`  Pool Token:       ${await convertToHederaId(poolDetails.poolTokenId)}`);
		console.log('  State:            ACTIVE');
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('💡 Next steps:');
		console.log('   - Use addPrizePackage.js to add prizes to the pool');
		console.log('   - Users can buy entries once prizes are added\n');

	}
	catch (error) {
		console.error('\n❌ Error creating pool:', error.message);
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
createPool();
