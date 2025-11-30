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
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

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

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helper
		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

		console.log('🔍 Fetching contract configuration...\n');

		// Get immutable variables
		let encodedCommand = lazyLottoIface.encodeFunctionData('lazyToken');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyTokenAddr = lazyLottoIface.decodeFunctionResult('lazyToken', result);
		const lazyToken = await convertToHederaId(lazyTokenAddr[0]);

		encodedCommand = lazyLottoIface.encodeFunctionData('lazyGasStation');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyGasStationAddr = lazyLottoIface.decodeFunctionResult('lazyGasStation', result);
		const lazyGasStation = await convertToHederaId(lazyGasStationAddr[0]);

		encodedCommand = lazyLottoIface.encodeFunctionData('lazyDelegateRegistry');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyDelegateRegistryAddr = lazyLottoIface.decodeFunctionResult('lazyDelegateRegistry', result);
		const lazyDelegateRegistry = await convertToHederaId(lazyDelegateRegistryAddr[0]);

		encodedCommand = lazyLottoIface.encodeFunctionData('prng');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prngAddr = lazyLottoIface.decodeFunctionResult('prng', result);
		const prng = await convertToHederaId(prngAddr[0]);

		encodedCommand = lazyLottoIface.encodeFunctionData('storageContract');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const storageAddr = lazyLottoIface.decodeFunctionResult('storageContract', result);
		const storage = await convertToHederaId(storageAddr[0]);

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
		console.log(`  Time-Based Bonuses:     ${totalTimeBonuses[0]}`);
		console.log(`  NFT Holding Bonuses:    ${totalNFTBonuses[0]}`);
		console.log('═══════════════════════════════════════════════════════════\n');

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
		for (let i = 0; i < Number(totalPools[0]); i++) {
			encodedCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [i]);
			result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
			const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolDetails', result);

			const pool = {
				id: i,
				ticketCID: poolDetails.ticketCID,
				winCID: poolDetails.winCID,
				winRateThousandthsOfBps: poolDetails.winRateThousandthsOfBps,
				entryFee: poolDetails.entryFee,
				prizeCount: poolDetails.prizes.length,
				outstandingEntries: poolDetails.outstandingEntries,
				poolTokenId: await convertToHederaId(poolDetails.poolTokenId),
				paused: poolDetails.paused,
				closed: poolDetails.closed,
				feeToken: poolDetails.feeToken === '0x0000000000000000000000000000000000000000'
					? 'HBAR'
					: await convertToHederaId(poolDetails.feeToken),
			};

			// Fetch all prizes for this pool
			pool.prizes = [];
			for (let j = 0; j < pool.prizeCount; j++) {
				encodedCommand = lazyLottoIface.encodeFunctionData('getPrizePackage', [i, j]);
				result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
				const prizePackage = lazyLottoIface.decodeFunctionResult('getPrizePackage', result);

				const nftTokensConverted = await Promise.all(
					prizePackage.nftTokens.map(async addr =>
						addr === '0x0000000000000000000000000000000000000000'
							? null
							: await convertToHederaId(addr),
					),
				);

				const prize = {
					token: prizePackage.token === '0x0000000000000000000000000000000000000000'
						? 'HBAR'
						: await convertToHederaId(prizePackage.token),
					amount: prizePackage.amount,
					nftTokens: nftTokensConverted.filter(t => t !== null),
					nftSerials: prizePackage.nftSerials.map(s => Number(s)),
				};

				pool.prizes.push(prize);
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
			console.log(`│  Entry Fee:         ${pool.feeToken === 'HBAR' ? formatHbar(pool.entryFee) : `${pool.entryFee} (${pool.feeToken})`}`);
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
						prizeItems.push(
							prize.token === 'HBAR'
								? formatHbar(prize.amount)
								: `${prize.amount} ${prize.token}`,
						);
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
