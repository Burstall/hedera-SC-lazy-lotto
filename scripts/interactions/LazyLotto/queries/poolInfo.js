/**
 * LazyLotto Pool Info Query
 *
 * Retrieves detailed information about a specific pool including:
 * - Pool configuration (win rate, entry fee, etc.)
 * - All prizes in the pool
 * - Pool statistics
 *
 * Usage: node scripts/interactions/LazyLotto/queries/poolInfo.js [poolId] [--json]
 *
 * Options:
 *   --json    Output results as JSON (for programmatic use)
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

const { homebrewPopulateAccountNum, EntityType, getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

// CLI options
const outputJson = process.argv.includes('--json');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
const poolManagerId = process.env.LAZY_LOTTO_POOL_MANAGER_ID ? ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID) : null;

let tokenDets = null;

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

// Helper: Format HBAR
function formatHbar(tinybars) {
	return new Hbar(Number(tinybars), HbarUnit.Tinybar).toString();
}

async function getPoolInfo() {
	let client;

	try {
		// Get pool ID
		let poolIdStr = process.argv[2];

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
		console.log('║            LazyLotto Pool Info Query                      ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helper
		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

		console.log('🔍 Fetching pool data...\n');

		// Get pool basic info (new API - no prizes array)
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolBasicInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);

		// Destructure the tuple: (ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken)
		const [, , winRateThousandthsOfBps, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken] = poolBasicInfo;

		// Fetch individual prizes if any exist
		const prizes = [];
		const prizeCountNum = Number(prizeCount);
		if (prizeCountNum > 0) {
			console.log(`📦 Fetching ${prizeCountNum} prize package(s)...`);
			for (let i = 0; i < prizeCountNum; i++) {
				const prizeQuery = lazyLottoIface.encodeFunctionData('getPrizePackage', [poolId, i]);
				const prizeResult = await readOnlyEVMFromMirrorNode(env, contractId, prizeQuery, operatorId, false);
				const prizePackage = lazyLottoIface.decodeFunctionResult('getPrizePackage', prizeResult);
				prizes.push(prizePackage[0]);
			}
		}

		// Display pool configuration
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL CONFIGURATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Win Rate:         ${formatWinRate(Number(winRateThousandthsOfBps))}`);

		const feeTokenId = await convertToHederaId(feeToken, EntityType.TOKEN);

		if (feeTokenId !== 'HBAR') {
			tokenDets = await getTokenDetails(env, feeTokenId);
		}

		const feeAmount = feeTokenId === 'HBAR'
			? formatHbar(Number(entryFee))
			: `${entryFee / 10 ** tokenDets.decimals} (${feeTokenId})`;
		console.log(`  Entry Fee:        ${feeAmount}`);

		console.log(`  Pool Token:       ${await convertToHederaId(poolTokenId, EntityType.TOKEN)}`);
		console.log(`  Outstanding:      ${outstandingEntries} entries`);
		console.log(`  State:            ${paused ? '⏸️  PAUSED' : closed ? '🔒 CLOSED' : '✅ ACTIVE'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Display prizes
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PRIZES');
		console.log('═══════════════════════════════════════════════════════════');

		if (prizes.length === 0) {
			console.log('  No prizes in this pool\n');
		}
		else {
			console.log(`  Total: ${prizes.length} prize(s)\n`);

			for (let i = 0; i < prizes.length; i++) {
				const prize = prizes[i];
				console.log(`  Prize #${i}:`);

				// FT component
				if (Number(prize.amount) > 0) {
					const prizeTokenId = await convertToHederaId(prize.token);
					let amount;
					if (prizeTokenId === 'HBAR') {
						amount = formatHbar(Number(prize.amount));
					}
					else {
						const prizeTokenDets = await getTokenDetails(env, prizeTokenId);
						amount = `${Number(prize.amount) / (10 ** prizeTokenDets.decimals)} ${prizeTokenDets.symbol}`;
					}
					console.log(`    FT:   ${amount}`);
				}

				// NFT components
				const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
				if (nftTokens.length > 0) {
					// prize.nftSerials is an array of arrays - flatten to count total
					const totalSerials = prize.nftSerials.reduce((sum, serialArray) => sum + serialArray.length, 0);
					console.log(`    NFTs: ${totalSerials} NFT(s) from ${nftTokens.length} collection(s)`);
					for (let j = 0; j < nftTokens.length; j++) {
						const tokenId = await convertToHederaId(nftTokens[j], EntityType.TOKEN);

						// Get token details from mirror node
						let tokenSymbol = tokenId;
						let tokenName = 'Unknown';
						try {
							tokenDets = await getTokenDetails(env, tokenId);
							tokenSymbol = tokenDets.symbol || tokenId;
							tokenName = tokenDets.name || 'Unknown';
						}
						catch {
							// Use token ID if details unavailable
						}

						// Each NFT token has its own array of serials
						const serials = prize.nftSerials[j].map(s => Number(s));
						const serialsStr = serials.join(', ');
						console.log(`          - ${tokenId} (${tokenSymbol} - ${tokenName}): [${serialsStr}]`);
					}
				} console.log();
			}
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Pool Manager Details
		if (poolManagerId) {
			try {
				const poolManagerJson = JSON.parse(
					fs.readFileSync('./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json'),
				);
				const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

				console.log('═══════════════════════════════════════════════════════════');
				console.log('  POOL MANAGER DETAILS');
				console.log('═══════════════════════════════════════════════════════════');

				// Get pool owner
				encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
				const owner = poolManagerIface.decodeFunctionResult('getPoolOwner', result);
				const ownerHederaId = await convertToHederaId(owner[0], EntityType.ACCOUNT);

				// Check if global
				encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPool', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
				const isGlobal = poolManagerIface.decodeFunctionResult('isGlobalPool', result);

				// Get platform fee %
				encodedCommand = poolManagerIface.encodeFunctionData('getPoolPlatformFeePercentage', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
				const feePercent = poolManagerIface.decodeFunctionResult('getPoolPlatformFeePercentage', result);

				// Get proceeds
				encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [poolId]);
				result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
				const proceeds = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);

				const totalProceeds = proceeds[0];
				const withdrawn = proceeds[1];
				const available = totalProceeds - withdrawn;

				console.log(`  Pool Type:          ${isGlobal[0] ? 'Global (Admin)' : 'Community (User)'}`);
				console.log(`  Owner:              ${ownerHederaId}`);
				console.log(`  Platform Fee:       ${feePercent[0]}% (Owner: ${100 - Number(feePercent[0])}%)`);
				console.log('  Proceeds:');
				console.log(`    - Total Earned:   ${new Hbar(totalProceeds, HbarUnit.Tinybar).toString()}`);
				console.log(`    - Withdrawn:      ${new Hbar(withdrawn, HbarUnit.Tinybar).toString()}`);
				console.log(`    - Available:      ${new Hbar(available, HbarUnit.Tinybar).toString()}`);
				console.log('═══════════════════════════════════════════════════════════\n');
			}
			catch (error) {
				console.log('⚠️  Pool Manager details unavailable\n', error.message);
			}
		}

		// Summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool State:     ${paused ? 'PAUSED' : closed ? 'CLOSED' : 'ACTIVE'}`);
		console.log(`  Win Rate:       ${formatWinRate(Number(winRateThousandthsOfBps))}`);
		console.log(`  Entry Fee:      ${feeAmount}`);
		console.log(`  Total Prizes:   ${prizes.length}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('✅ Pool info query complete!\n');

	}
	catch (error) {
		console.error('\n❌ Error fetching pool info:', error.message);
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
getPoolInfo();
