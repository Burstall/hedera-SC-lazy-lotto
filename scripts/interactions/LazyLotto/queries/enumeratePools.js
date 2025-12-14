/**
 * Enumerate LazyLotto Pools
 *
 * Lists all pools with categorization:
 * - Global pools (admin-created, no creation fees)
 * - Community pools (user-created, paid creation fees)
 *
 * Shows pool ID, owner, type, and platform fee percentage
 *
 * Usage: node scripts/interactions/LazyLotto/queries/enumeratePools.js [--page <number>] [--size <number>]
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
const lazyLottoId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

// Parse command line arguments
const args = process.argv.slice(2);
let page = 0;
let pageSize = 20;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--page' && i + 1 < args.length) {
		page = parseInt(args[i + 1]);
		i++;
	}
	else if (args[i] === '--size' && i + 1 < args.length) {
		pageSize = parseInt(args[i + 1]);
		i++;
	}
}

async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	return await homebrewPopulateAccountNum(env, evmAddress, EntityType.ACCOUNT);
}

async function enumeratePools() {
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
		console.log('║              LazyLotto Pool Enumeration                   ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}`);
		console.log(`📄 Page: ${page} | Size: ${pageSize}\n`);

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

		// === GLOBAL POOLS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🌍 GLOBAL POOLS (Admin-Created)');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		let encodedCommand = poolManagerIface.encodeFunctionData('totalGlobalPools');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalGlobal = poolManagerIface.decodeFunctionResult('totalGlobalPools', result);

		console.log(`Total Global Pools: ${totalGlobal[0]}\n`);

		if (Number(totalGlobal[0]) > 0) {
			const startIdx = page * pageSize;
			const endIdx = Math.min(startIdx + pageSize, Number(totalGlobal[0]));

			encodedCommand = poolManagerIface.encodeFunctionData('getGlobalPools', [startIdx, pageSize]);
			result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
			const globalPools = poolManagerIface.decodeFunctionResult('getGlobalPools', result);

			const poolIds = globalPools[0].map(id => Number(id));

			console.log(`Showing pools ${startIdx} to ${endIdx - 1}:\n`);

			for (const poolId of poolIds) {
				// Get pool owner
				encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
				const owner = poolManagerIface.decodeFunctionResult('getPoolOwner', result);
				const ownerHederaId = await convertToHederaId(owner[0]);

				// Get pool platform fee %
				encodedCommand = poolManagerIface.encodeFunctionData('getPoolPlatformFeePercentage', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
				const feePercent = poolManagerIface.decodeFunctionResult('getPoolPlatformFeePercentage', result);

				// Get pool name from LazyLotto
				encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
				const poolInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
				const poolName = poolInfo[1];

				console.log(`   Pool #${poolId}: "${poolName}"`);
				console.log('      Type: Global');
				console.log(`      Owner: ${ownerHederaId}`);
				console.log(`      Platform Fee: ${feePercent[0]}% | Pool Owner: ${100 - Number(feePercent[0])}%`);
				console.log('');
			}
		}
		else {
			console.log('   No global pools found.\n');
		}

		// === COMMUNITY POOLS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('👥 COMMUNITY POOLS (User-Created)');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		encodedCommand = poolManagerIface.encodeFunctionData('totalCommunityPools');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalCommunity = poolManagerIface.decodeFunctionResult('totalCommunityPools', result);

		console.log(`Total Community Pools: ${totalCommunity[0]}\n`);

		if (Number(totalCommunity[0]) > 0) {
			const startIdx = page * pageSize;
			const endIdx = Math.min(startIdx + pageSize, Number(totalCommunity[0]));

			encodedCommand = poolManagerIface.encodeFunctionData('getCommunityPools', [startIdx, pageSize]);
			result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
			const communityPools = poolManagerIface.decodeFunctionResult('getCommunityPools', result);

			const poolIds = communityPools[0].map(id => Number(id));

			console.log(`Showing pools ${startIdx} to ${endIdx - 1}:\n`);

			for (const poolId of poolIds) {
				// Get pool owner
				encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
				const owner = poolManagerIface.decodeFunctionResult('getPoolOwner', result);
				const ownerHederaId = await convertToHederaId(owner[0]);

				// Get pool platform fee %
				encodedCommand = poolManagerIface.encodeFunctionData('getPoolPlatformFeePercentage', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
				const feePercent = poolManagerIface.decodeFunctionResult('getPoolPlatformFeePercentage', result);

				// Get pool name from LazyLotto
				encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
				const poolInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
				const poolName = poolInfo[1];

				console.log(`   Pool #${poolId}: "${poolName}"`);
				console.log('      Type: Community');
				console.log(`      Owner: ${ownerHederaId}`);
				console.log(`      Platform Fee: ${feePercent[0]}% | Pool Owner: ${100 - Number(feePercent[0])}%`);
				console.log('');
			}
		}
		else {
			console.log('   No community pools found.\n');
		}

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log(`\n💡 Total: ${Number(totalGlobal[0]) + Number(totalCommunity[0])} pools`);
		console.log('   Use --page <n> --size <s> to paginate results\n');

	}
	catch (error) {
		console.error('\n❌ Error enumerating pools:');
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

// Run the enumeration
enumeratePools();
