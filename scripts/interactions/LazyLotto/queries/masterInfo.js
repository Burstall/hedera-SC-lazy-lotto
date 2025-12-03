/**
 * LazyLotto Master Information Query
 *
 * Comprehensive script that retrieves ALL contract state:
 * - All pools with detailed information
 * - All prizes for each pool
 * - Outstanding entries across pools
 * - Contract configuration
 * - Bonus systems
 *
 * Usage: node scripts/interactions/LazyLotto/queries/masterInfo.js
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

const { homebrewPopulateAccountNum, EntityType, getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
const storageContractId = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);

// Helper: Convert Hedera ID to EVM address

async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	// Use null to try all entity types (accounts, tokens, contracts)
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function getMasterInfo() {
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
		console.log('║         LazyLotto Master Information Query                ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}\n`);

		// Test if contract exists first by checking mirror node
		console.log('🔍 Verifying contract exists on mirror node...');
		const baseUrl = require('../../../../utils/hederaMirrorHelpers').getBaseURL(env);
		const axios = require('axios');

		try {
			const contractResponse = await axios.get(`${baseUrl}/api/v1/contracts/${contractId.toString()}`);
			if (contractResponse.data && contractResponse.data.contract_id) {
				console.log('✅ Contract found on mirror node\n');
			}
		}
		catch (error) {
			if (error.response && error.response.status === 404) {
				console.error('❌ Contract not found on mirror node.');
				console.error('   This could mean:');
				console.error('   1. The contract address is incorrect');
				console.error('   2. The contract was recently deployed (wait a few minutes for mirror node to sync)');
				console.error('   3. You are on the wrong network (check ENVIRONMENT in .env)\n');
				console.error(`   Contract ID: ${contractId.toString()}`);
				console.error(`   Environment: ${env.toUpperCase()}\n`);
				console.error('   Try running this script again in a few minutes if the contract was just deployed.\n');
				process.exit(1);
			}
			console.warn('⚠️  Could not verify contract on mirror node, continuing anyway...\n');
		}

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// const storageContractJson = JSON.parse(
		// 	fs.readFileSync('./artifacts/contracts/LazyLottoStorage.sol/LazyLottoStorage.json'),
		// );

		// const lazyLottoStorageIface = new ethers.Interface(storageContractJson.abi);

		// Import helper
		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

		console.log('🔍 Fetching contract configuration...\n');

		// Get immutable variables (with error handling for 404)
		let encodedCommand, result;

		try {
			encodedCommand = lazyLottoIface.encodeFunctionData('lazyToken');
			result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		}
		catch (error) {
			if (error.response && error.response.status === 404) {
				console.error('❌ Contract not found on mirror node.');
				console.error('   This could mean:');
				console.error('   1. The contract address is incorrect');
				console.error('   2. The contract was recently deployed and mirror node is still indexing');
				console.error('   3. You are on the wrong network (check ENVIRONMENT in .env)\n');
				console.error(`   Contract ID: ${storageContractId.toString()}`);
				console.error(`   Environment: ${env.toUpperCase()}\n`);
				process.exit(1);
			}
			throw error;
		}

		const lazyTokenAddr = lazyLottoIface.decodeFunctionResult('lazyToken', result);
		const lazyToken = await convertToHederaId(lazyTokenAddr[0], EntityType.TOKEN);

		encodedCommand = lazyLottoIface.encodeFunctionData('lazyGasStation');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyGasStationAddr = lazyLottoIface.decodeFunctionResult('lazyGasStation', result);
		const lazyGasStation = await convertToHederaId(lazyGasStationAddr[0], EntityType.CONTRACT);

		encodedCommand = lazyLottoIface.encodeFunctionData('lazyDelegateRegistry');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyDelegateRegistryAddr = lazyLottoIface.decodeFunctionResult('lazyDelegateRegistry', result);
		const lazyDelegateRegistry = await convertToHederaId(lazyDelegateRegistryAddr[0], EntityType.CONTRACT);

		encodedCommand = lazyLottoIface.encodeFunctionData('prng');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prngAddr = lazyLottoIface.decodeFunctionResult('prng', result);
		const prng = await convertToHederaId(prngAddr[0], EntityType.CONTRACT);

		encodedCommand = lazyLottoIface.encodeFunctionData('storageContract');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const storageAddr = lazyLottoIface.decodeFunctionResult('storageContract', result);
		const storage = await convertToHederaId(storageAddr[0], EntityType.CONTRACT);

		encodedCommand = lazyLottoIface.encodeFunctionData('burnPercentage');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const burnPercentage = lazyLottoIface.decodeFunctionResult('burnPercentage', result);

		// Check if paused
		encodedCommand = lazyLottoIface.encodeFunctionData('paused');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isPaused = lazyLottoIface.decodeFunctionResult('paused', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CONTRACT CONFIGURATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  LAZY Token:             ${lazyToken}`);
		console.log(`  LazyGasStation:         ${lazyGasStation}`);
		console.log(`  LazyDelegateRegistry:   ${lazyDelegateRegistry}`);
		console.log(`  PRNG Generator:         ${prng}`);
		console.log(`  Storage Contract:       ${storage}`);
		console.log(`  Burn Percentage:        ${burnPercentage[0]}%`);
		console.log(`  Contract Paused:        ${isPaused[0] ? '🔴 YES' : '🟢 NO'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Get bonus system info
		console.log('🎁 Fetching bonus system configuration...\n');

		encodedCommand = lazyLottoIface.encodeFunctionData('totalTimeBonuses');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalTimeBonuses = lazyLottoIface.decodeFunctionResult('totalTimeBonuses', result);

		encodedCommand = lazyLottoIface.encodeFunctionData('totalNFTBonusTokens');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalNFTBonuses = lazyLottoIface.decodeFunctionResult('totalNFTBonusTokens', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  BONUS SYSTEM');
		console.log('═══════════════════════════════════════════════════════════');

		// Time-based bonuses
		console.log(`\n⏰ Time-Based Bonuses: ${totalTimeBonuses[0]}`);
		if (Number(totalTimeBonuses[0]) > 0) {
			for (let i = 0; i < Number(totalTimeBonuses[0]); i++) {
				encodedCommand = lazyLottoIface.encodeFunctionData('timeBonuses', [i]);
				result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
				const timeBonusResult = lazyLottoIface.decodeFunctionResult('timeBonuses', result);
				const timeBonus = timeBonusResult[0];

				const start = Number(timeBonus.start);
				const end = Number(timeBonus.end);
				const bps = Number(timeBonus.bonusBps);

				console.log(`\n  Bonus #${i}:`);
				if (start === 0 && end === 0) {
					console.log('    Status:   DISABLED');
				}
				else {
					const now = Math.floor(Date.now() / 1000);
					let status;
					if (now < start) {
						status = 'UPCOMING';
					}
					else if (now >= start && now <= end) {
						status = 'ACTIVE';
					}
					else {
						status = 'EXPIRED';
					}
					console.log(`    Status:   ${status}`);
					console.log(`    Start:    ${new Date(start * 1000).toISOString()}`);
					console.log(`    End:      ${new Date(end * 1000).toISOString()}`);
				}
				console.log(`    Boost:    +${(bps / 100).toFixed(2)}%`);
			}
		}

		// NFT holding bonuses
		console.log(`\n🎨 NFT Holding Bonuses: ${totalNFTBonuses[0]}`);
		if (Number(totalNFTBonuses[0]) > 0) {
			for (let i = 0; i < Number(totalNFTBonuses[0]); i++) {
				encodedCommand = lazyLottoIface.encodeFunctionData('nftBonusTokens', [i]);
				result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
				const nftTokenResult = lazyLottoIface.decodeFunctionResult('nftBonusTokens', result);
				const nftTokenAddress = nftTokenResult[0];

				encodedCommand = lazyLottoIface.encodeFunctionData('nftBonusBps', [nftTokenAddress]);
				result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
				const nftBpsResult = lazyLottoIface.decodeFunctionResult('nftBonusBps', result);
				const bps = Number(nftBpsResult[0]);

				const tokenId = await convertToHederaId(nftTokenAddress, EntityType.TOKEN);

				// Try to get token details from mirror node
				let tokenName = 'Unknown';
				let tokenSymbol = '';
				try {
					const tokenDetails = await getTokenDetails(env, tokenId);
					tokenName = tokenDetails.name || 'Unknown';
					tokenSymbol = tokenDetails.symbol || '';
				}
				catch (e) {
					// Token details not available
					console.warn(`⚠️  Could not fetch details for token ${tokenId}: ${e.message}`);
				}

				console.log(`\n  Bonus #${i}:`);
				console.log(`    Token:    ${tokenId} (${tokenSymbol})`);
				console.log(`    Name:     ${tokenName}`);
				console.log(`    Boost:    +${(bps / 100).toFixed(2)}% (per NFT held)`);
			}
		}

		// LAZY balance bonus
		encodedCommand = lazyLottoIface.encodeFunctionData('lazyBalanceThreshold');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyThresholdResult = lazyLottoIface.decodeFunctionResult('lazyBalanceThreshold', result);
		const lazyThreshold = lazyThresholdResult[0];

		encodedCommand = lazyLottoIface.encodeFunctionData('lazyBalanceBonusBps');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyBpsResult = lazyLottoIface.decodeFunctionResult('lazyBalanceBonusBps', result);
		const lazyBps = Number(lazyBpsResult[0]);

		console.log('\n💎 LAZY Balance Bonus:');
		if (lazyThreshold === 0n || lazyBps === 0) {
			console.log('    Status:     DISABLED');
		}
		else {
			console.log('    Status:     ACTIVE');
			console.log(`    Threshold:  ${ethers.formatUnits(lazyThreshold, 8)} LAZY`);
			console.log(`    Boost:      +${(lazyBps / 100).toFixed(2)}%`);
		}

		console.log('\n═══════════════════════════════════════════════════════════\n');

		// Get total pools
		console.log('🎰 Fetching lottery pools...\n');

		encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', result);

		console.log(`📊 Total Pools: ${totalPools[0]}\n`);

		if (totalPools[0] === 0n) {
			console.log('No pools created yet.\n');
			return;
		}

		// Fetch all pools
		const pools = [];
		// Cache token details to avoid duplicate queries
		const tokenDetailsCache = new Map();

		for (let i = 0; i < Number(totalPools[0]); i++) {
			encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [i]);
			result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
			const poolBasicInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
			const [ticketCID, winCID, winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken] = poolBasicInfo;

			const feeTokenAddr = feeToken;
			const feeTokenId = feeTokenAddr === '0x0000000000000000000000000000000000000000'
				? 'HBAR'
				: await convertToHederaId(feeTokenAddr);

			// Cache token details for fee token
			if (feeTokenId !== 'HBAR' && !tokenDetailsCache.has(feeTokenId)) {
				tokenDetailsCache.set(feeTokenId, await getTokenDetails(env, feeTokenId));
			}

			const pool = {
				id: i,
				ticketCID: ticketCID,
				winCID: winCID,
				winRateThousandthsOfBps: Number(winRate),
				entryFee: Number(entryFee),
				prizeCount: Number(prizeCount),
				outstandingEntries: Number(outstandingEntries),
				poolTokenId: await convertToHederaId(poolTokenId),
				paused: paused,
				closed: closed,
				feeToken: feeTokenId,
			};
			pool.prizes = [];
			for (let j = 0; j < pool.prizeCount; j++) {
				encodedCommand = lazyLottoIface.encodeFunctionData('getPrizePackage', [i, j]);
				result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
				const prizePackage = lazyLottoIface.decodeFunctionResult('getPrizePackage', result);

				const prizeTokenAddr = prizePackage[0].token;
				const prizeTokenId = prizeTokenAddr === '0x0000000000000000000000000000000000000000'
					? 'HBAR'
					: await convertToHederaId(prizePackage[0].token);

				// Cache token details for prize token
				if (prizeTokenId !== 'HBAR' && !tokenDetailsCache.has(prizeTokenId)) {
					tokenDetailsCache.set(prizeTokenId, await getTokenDetails(env, prizeTokenId));
				}

				const nftTokensConverted = await Promise.all(
					prizePackage[0].nftTokens.map(async addr =>
						addr === '0x0000000000000000000000000000000000000000'
							? null
							: await convertToHederaId(addr),
					),
				); const prize = {
					token: prizeTokenId,
					amount: Number(prizePackage[0].amount),
					nftTokens: nftTokensConverted.filter(t => t !== null),
					nftSerials: prizePackage[0].nftSerials.map(serialArray => serialArray.map(s => Number(s))),
				}; pool.prizes.push(prize);
			}

			pools.push(pool);
		}

		// Display all pools
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  LOTTERY POOLS');
		console.log('═══════════════════════════════════════════════════════════\n');

		for (const pool of pools) {
			console.log(`┌─ Pool #${pool.id} ─────────────────────────────────────────────`);
			console.log(`│  Win Rate:          ${formatWinRate(pool.winRateThousandthsOfBps)}`);

			// Format entry fee with proper decimals
			const feeTokenDets = pool.feeToken === 'HBAR' ? null : tokenDetailsCache.get(pool.feeToken);
			const formattedFee = pool.feeToken === 'HBAR'
				? new Hbar(pool.entryFee, HbarUnit.Tinybar).toString()
				: `${pool.entryFee / (10 ** feeTokenDets.decimals)} ${feeTokenDets.symbol}`;
			console.log(`│  Entry Fee:         ${formattedFee}`);
			console.log(`│  Pool Token:        ${pool.poolTokenId}`);
			console.log(`│  Outstanding:       ${pool.outstandingEntries} entries`);
			console.log(`│  Status:            ${pool.closed ? '🔒 CLOSED' : pool.paused ? '⏸️  PAUSED' : '🟢 ACTIVE'}`);
			console.log(`│  Prize Packages:    ${pool.prizeCount}`);
			console.log('│');

			if (pool.prizes.length > 0) {
				console.log('│  Prizes:');
				pool.prizes.forEach((prize, idx) => {
					const prizeItems = [];
					if (prize.amount > 0) {
						const prizeTokenDets = prize.token === 'HBAR' ? null : tokenDetailsCache.get(prize.token);
						const formattedAmount = prize.token === 'HBAR'
							? new Hbar(prize.amount, HbarUnit.Tinybar).toString()
							: `${prize.amount / (10 ** prizeTokenDets.decimals)} ${prizeTokenDets.symbol}`;
						prizeItems.push(formattedAmount);
					}
					if (prize.nftTokens.length > 0) {
						prizeItems.push(`${prize.nftSerials.length} NFTs from ${prize.nftTokens.length} collection(s)`);
					}
					console.log(`│    ${idx + 1}. ${prizeItems.join(' + ')}`);
				});
			}
			else {
				console.log('│  No prizes configured');
			}

			console.log('└────────────────────────────────────────────────────────\n');
		}

		// Summary statistics
		const totalOutstanding = pools.reduce((sum, p) => sum + Number(p.outstandingEntries), 0);
		const activePools = pools.filter(p => !p.closed && !p.paused).length;
		const pausedPools = pools.filter(p => p.paused && !p.closed).length;
		const closedPools = pools.filter(p => p.closed).length;
		const totalPrizePackages = pools.reduce((sum, p) => sum + p.prizeCount, 0);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  SUMMARY STATISTICS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total Pools:            ${pools.length}`);
		console.log(`    - Active:             ${activePools}`);
		console.log(`    - Paused:             ${pausedPools}`);
		console.log(`    - Closed:             ${closedPools}`);
		console.log(`  Total Prize Packages:   ${totalPrizePackages}`);
		console.log(`  Outstanding Entries:    ${totalOutstanding}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('✅ Master info query complete!\n');

	}
	catch (error) {
		console.error('\n❌ Error fetching master info:', error.message);
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
getMasterInfo();
