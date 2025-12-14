/**
 * LazyLotto Pool Details
 *
 * Shows comprehensive information for a specific pool:
 * - Basic info (name, owner, type)
 * - Financial details (proceeds, platform fee %)
 * - Prize manager
 *
 * Usage: node scripts/interactions/LazyLotto/queries/poolDetails.js [poolId]
 *        If poolId not provided, will prompt for input
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

const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
const lazyLottoId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	return await homebrewPopulateAccountNum(env, evmAddress, EntityType.ACCOUNT);
}

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

async function getPoolDetails(poolId) {
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
		console.log('║                 LazyLotto Pool Details                    ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`📄 LazyLotto: ${lazyLottoId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}\n`);

		// Load interfaces
		const poolManagerJson = JSON.parse(
			fs.readFileSync(
				'./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json',
			),
		);
		const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		const lazyLottoJson = JSON.parse(
			fs.readFileSync(
				'./artifacts/contracts/LazyLotto.sol/LazyLotto.json',
			),
		);
		const lazyLottoIface = new ethers.Interface(lazyLottoJson.abi);

		// === BASIC INFO ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log(`🎱 Pool #${poolId} - Basic Information`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Get pool name and info from LazyLotto
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		let result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const poolInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
		const poolName = poolInfo[1];
		const tokenIdSolidityAddress = poolInfo[0];

		console.log(`   Name: "${poolName}"`);
		console.log(`   Token: ${tokenIdSolidityAddress}`);

		// Check if global pool
		encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPool', [poolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isGlobal = poolManagerIface.decodeFunctionResult('isGlobalPool', result);

		console.log(`   Type: ${isGlobal[0] ? 'Global (Admin-Created)' : 'Community (User-Created)'}\n`);

		// === OWNERSHIP ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('👤 Ownership & Management');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [poolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const owner = poolManagerIface.decodeFunctionResult('getPoolOwner', result);
		const ownerHederaId = await convertToHederaId(owner[0]);

		console.log(`   Owner: ${ownerHederaId}`);

		// Get prize manager
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolPrizeManager', [poolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const prizeManager = poolManagerIface.decodeFunctionResult('getPoolPrizeManager', result);
		const prizeManagerHederaId = prizeManager[0] && prizeManager[0] !== '0x0000000000000000000000000000000000000000'
			? await convertToHederaId(prizeManager[0])
			: 'Not Set';

		console.log(`   Prize Manager: ${prizeManagerHederaId}\n`);

		// === FINANCIALS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 Financial Details');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Get platform fee percentage
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolPlatformFeePercentage', [poolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const feePercent = poolManagerIface.decodeFunctionResult('getPoolPlatformFeePercentage', result);
		const platformPercent = Number(feePercent[0]);
		const ownerPercent = 100 - platformPercent;

		console.log(`   Platform Fee: ${platformPercent}%`);
		console.log(`   Pool Owner Share: ${ownerPercent}%\n`);

		// Get pool proceeds
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [poolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceeds = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);

		const totalProceeds = proceeds[0];
		const withdrawn = proceeds[1];
		const available = totalProceeds - withdrawn;

		console.log('   Pool Proceeds:');
		console.log(`      Total Earned: ${new Hbar(totalProceeds, HbarUnit.Tinybar).toString()}`);
		console.log(`      Withdrawn: ${new Hbar(withdrawn, HbarUnit.Tinybar).toString()}`);
		console.log(`      Available: ${new Hbar(available, HbarUnit.Tinybar).toString()}\n`);

		// Calculate splits
		const platformShare = (Number(available) * platformPercent) / 100;
		const ownerShare = Number(available) - platformShare;

		console.log('   Available Breakdown:');
		console.log(`      Platform (${platformPercent}%): ${new Hbar(platformShare, HbarUnit.Tinybar).toString()}`);
		console.log(`      Pool Owner (${ownerPercent}%): ${new Hbar(ownerShare, HbarUnit.Tinybar).toString()}\n`);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (available > 0n && ownerHederaId === operatorId.toString()) {
			console.log('💡 You own this pool and have withdrawable proceeds!');
			console.log('   Run: node scripts/interactions/LazyLotto/user/withdrawPoolProceeds.js\n');
		}

	}
	catch (error) {
		console.error('\n❌ Error getting pool details:');
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
	// Check for command line argument
	let poolId = process.argv[2];

	// If not provided, prompt
	if (!poolId) {
		poolId = await promptForInput('Enter Pool ID: ');
	}

	poolId = parseInt(poolId);

	if (isNaN(poolId) || poolId < 0) {
		console.error('❌ Invalid pool ID. Must be a non-negative integer.');
		process.exit(1);
	}

	await getPoolDetails(poolId);
}

// Run the script
main();
