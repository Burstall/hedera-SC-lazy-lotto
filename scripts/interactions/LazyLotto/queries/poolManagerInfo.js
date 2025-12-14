/**
 * LazyLottoPoolManager Information Query
 *
 * Displays comprehensive pool manager state:
 * - Creation fees (HBAR and LAZY)
 * - Platform proceeds percentage
 * - Time-based bonuses
 * - NFT holding bonuses
 * - LAZY balance bonus
 * - Global and community pool counts
 *
 * Usage: node scripts/interactions/LazyLotto/queries/poolManagerInfo.js
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
require('dotenv').config();

const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
const lazyDecimals = Number(process.env.LAZY_DECIMALS || 1);

async function getPoolManagerInfo() {
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
		console.log('║        LazyLottoPoolManager Information Query             ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}\n`);

		// Load interface
		const poolManagerJson = JSON.parse(
			fs.readFileSync(
				'./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json',
			),
		);
		const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		// === CREATION FEES ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 CREATION FEES (for community pools)');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		let encodedCommand = poolManagerIface.encodeFunctionData('getCreationFees');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const fees = poolManagerIface.decodeFunctionResult('getCreationFees', result);

		const hbarFee = Number(fees[0]);
		const lazyFee = Number(fees[1]);
		const hbarDisplay = new Hbar(hbarFee, HbarUnit.Tinybar).toString();
		const lazyDisplay = (lazyFee / (10 ** lazyDecimals)).toFixed(lazyDecimals);

		console.log(`   HBAR Fee: ${hbarDisplay} (${hbarFee.toLocaleString()} tinybars)`);
		console.log(`   LAZY Fee: ${lazyDisplay} LAZY (${lazyFee.toLocaleString()} units)\n`);

		// === PLATFORM FEE ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🏦 PLATFORM FEE CONFIGURATION');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		encodedCommand = poolManagerIface.encodeFunctionData('platformProceedsPercentage');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const platformFee = poolManagerIface.decodeFunctionResult('platformProceedsPercentage', result);

		console.log(`   Platform Proceeds: ${platformFee[0]}% of pool entry fees`);
		console.log(`   Pool Owner Gets: ${100 - Number(platformFee[0])}% of pool entry fees\n`);

		// === TIME BONUSES ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('⏰ TIME-BASED BONUSES');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalTimeBonuses = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result);

		if (Number(totalTimeBonuses[0]) === 0) {
			console.log('   ⚠️  No time bonuses configured\n');
		}
		else {
			console.log(`   Total Configured: ${totalTimeBonuses[0]} time bonus(es)\n`);
			// Note: Individual time bonus details require indexed access which isn't exposed
			// Users can see the effect via calculateBoost()
		}

		// === NFT BONUSES ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎨 NFT HOLDING BONUSES');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		encodedCommand = poolManagerIface.encodeFunctionData('totalNFTBonusTokens');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalNFTBonuses = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', result);

		if (Number(totalNFTBonuses[0]) === 0) {
			console.log('   ⚠️  No NFT bonuses configured\n');
		}
		else {
			console.log(`   Total Configured: ${totalNFTBonuses[0]} NFT collection(s)\n`);
			// Note: Individual NFT bonus details require indexed access
		}

		// === LAZY BALANCE BONUS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💎 LAZY BALANCE BONUS');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		encodedCommand = poolManagerIface.encodeFunctionData('lazyBalanceThreshold');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const threshold = poolManagerIface.decodeFunctionResult('lazyBalanceThreshold', result);

		encodedCommand = poolManagerIface.encodeFunctionData('lazyBalanceBonusBps');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const bonusBps = poolManagerIface.decodeFunctionResult('lazyBalanceBonusBps', result);

		if (Number(threshold[0]) === 0 || Number(bonusBps[0]) === 0) {
			console.log('   ⚠️  No LAZY balance bonus configured\n');
		}
		else {
			const thresholdDisplay = (Number(threshold[0]) / (10 ** lazyDecimals)).toFixed(lazyDecimals);
			const bonusPercent = ((Number(bonusBps[0]) - 100) / 100).toFixed(2);
			console.log(`   Threshold: ${thresholdDisplay} LAZY`);
			console.log(`   Bonus: ${bonusPercent}% (${bonusBps[0]} bps)\n`);
		}

		// === POOL STATISTICS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📊 POOL STATISTICS');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		encodedCommand = poolManagerIface.encodeFunctionData('totalGlobalPools');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalGlobal = poolManagerIface.decodeFunctionResult('totalGlobalPools', result);

		encodedCommand = poolManagerIface.encodeFunctionData('totalCommunityPools');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalCommunity = poolManagerIface.decodeFunctionResult('totalCommunityPools', result);

		console.log(`   Global Pools (admin-created): ${totalGlobal[0]}`);
		console.log(`   Community Pools (user-created): ${totalCommunity[0]}`);
		console.log(`   Total Pools: ${Number(totalGlobal[0]) + Number(totalCommunity[0])}\n`);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
		console.log('✅ Pool Manager info query complete!\n');

	}
	catch (error) {
		console.error('\n❌ Error querying pool manager info:');
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

// Run the query
getPoolManagerInfo();
