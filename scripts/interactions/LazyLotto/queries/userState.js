/**
 * LazyLotto User State Query
 *
 * Retrieves complete user state including:
 * - Memory entries across all pools
 * - NFT tickets owned
 * - Pending prizes
 * - Current win rate boost
 *
 * Usage: node scripts/interactions/LazyLotto/queries/userState.js [userAddress]
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

const { getTokenDetails, getSerialsOwned, homebrewPopulateAccountEvmAddress } = require('../../../../utils/hederaMirrorHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

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

async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	// Use null to try all entity types (accounts, tokens, contracts)
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (Number(thousandthsOfBps) / 1_000_000).toFixed(4) + '%';
}


async function getUserState() {
	let client;

	try {
		// Get user address
		let userAddress = process.argv[2];

		if (!userAddress) {
			userAddress = await prompt('Enter user address (0.0.xxxxx or 0x...): ');
		}

		if (!userAddress) {
			console.error('❌ User address required');
			process.exit(1);
		}

		let userEvmAddress;
		let userHederaId;
		// Convert to EVM format
		if (!userAddress.startsWith('0x')) {
			userHederaId = AccountId.fromString(userAddress).toString();
			userEvmAddress = await homebrewPopulateAccountEvmAddress(env, userHederaId, EntityType.ACCOUNT);
		}
		else {
			userEvmAddress = userAddress;
			userHederaId = await homebrewPopulateAccountNum(env, userEvmAddress, EntityType.ACCOUNT);
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
		console.log('║           LazyLotto User State Query                      ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 User: ${userHederaId}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helper
		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

		console.log('🔍 Fetching user data...\n');

		// Get user's boost
		let encodedCommand = lazyLottoIface.encodeFunctionData('calculateBoost', [userEvmAddress]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const boostBps = lazyLottoIface.decodeFunctionResult('calculateBoost', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  WIN RATE BOOST');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Current Boost: +${formatWinRate(Number(boostBps[0]))}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Get total pools
		encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', result);

		// Get user entries for each pool
		const userEntries = [];
		for (let i = 0; i < Number(totalPools[0]); i++) {
			encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [i, userEvmAddress]);
			result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
			const entries = lazyLottoIface.decodeFunctionResult('getUsersEntries', result);

			if (Number(entries[0]) > 0) {
				// Get pool details
				encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [i]);
				result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
				const [, , winRate, entryFee, , , poolTokenId, , , feeToken] =
					lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
				userEntries.push({
					poolId: i,
					entryCount: Number(entries[0]),
					winRate: Number(winRate),
					entryFee: Number(entryFee),
					feeToken: feeToken === '0x0000000000000000000000000000000000000000'
						? 'HBAR'
						: await homebrewPopulateAccountNum(env, feeToken, EntityType.TOKEN),
					poolTokenId: await homebrewPopulateAccountNum(env, poolTokenId, EntityType.TOKEN),
				});
			}
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  MEMORY ENTRIES (Unrolled Tickets)');
		console.log('═══════════════════════════════════════════════════════════');

		if (userEntries.length === 0) {
			console.log('  No memory entries found\n');
		}
		else {
			for (const entry of userEntries) {
				console.log(`  Pool #${entry.poolId}:`);
				console.log(`    Tickets:    ${entry.entryCount}`);
				console.log(`    Win Rate:   ${formatWinRate(entry.winRate)} (base)`);
				console.log(`    Boosted:    ${formatWinRate(Number(entry.winRate) + Number(boostBps[0]))}`);

				// Format entry fee with proper decimals
				let formattedFee;
				if (entry.feeToken === 'HBAR') {
					formattedFee = new Hbar(Number(entry.entryFee), HbarUnit.Tinybar).toString();
				}
				else {
					const tokenDets = await getTokenDetails(env, entry.feeToken);
					formattedFee = `${Number(entry.entryFee) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`;
				}
				console.log(`    Entry Fee:  ${formattedFee}`);
				console.log();
			}
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Check for pool NFTs (both tickets and prizes)
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL NFTs (Tickets & Prize NFTs)');
		console.log('═══════════════════════════════════════════════════════════');

		let hasPoolNFTs = false;

		for (let i = 0; i < Number(totalPools[0]); i++) {
			// Get pool details to find pool token
			encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [i]);
			result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
			const [, , , , , , poolTokenIdEvm] = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
			const poolTokenId = await convertToHederaId(poolTokenIdEvm, EntityType.TOKEN);

			// Check if user owns any NFTs from this pool
			const ownedSerials = await getSerialsOwned(env, userHederaId, poolTokenId);

			if (ownedSerials && ownedSerials.length > 0) {
				hasPoolNFTs = true;

				// Get token details
				let tokenSymbol = poolTokenId;
				try {
					const tokenDetails = await getTokenDetails(env, poolTokenId);
					tokenSymbol = tokenDetails.symbol || poolTokenId;
				}
				catch {
					// Use tokenId as fallback
				}

				console.log(`\n  Pool #${i} - ${tokenSymbol} (${poolTokenId}):`);

				// Check each serial to see if it's a prize NFT or ticket NFT
				const ticketSerials = [];
				const prizeData = [];
				// Store {serial, pendingPrize} for prizes

				for (const serial of ownedSerials) {
					// Query if this NFT is a prize
					encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizesByNFT', [poolTokenIdEvm, serial]);
					result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
					const pendingPrize = lazyLottoIface.decodeFunctionResult('getPendingPrizesByNFT', result)[0];

					if (pendingPrize.asNFT) {
						prizeData.push({ serial, pendingPrize });
					}
					else {
						ticketSerials.push(serial);
					}
				}

				if (ticketSerials.length > 0) {
					console.log(`    🎫 Ticket NFTs: ${ticketSerials.length} (serials: ${ticketSerials.join(', ')})`);
				}

				if (prizeData.length > 0) {
					console.log(`    🎁 Prize NFTs:  ${prizeData.length}`);

					// Display each prize's details
					for (const { serial, pendingPrize } of prizeData) {
						const prize = pendingPrize.prize;
						const prizeItems = [];

						// FT/HBAR amount
						if (prize.amount > 0) {
							const tokenId = prize.token === '0x0000000000000000000000000000000000000000'
								? 'HBAR'
								: await convertToHederaId(prize.token, EntityType.TOKEN);

							let formattedAmount;
							if (tokenId === 'HBAR') {
								formattedAmount = new Hbar(Number(prize.amount), HbarUnit.Tinybar).toString();
							}
							else {
								const tokenDets = await getTokenDetails(env, tokenId);
								formattedAmount = `${Number(prize.amount) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`;
							}
							prizeItems.push(formattedAmount);
						}

						// NFTs
						if (prize.nftTokens.length > 0) {
							const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
							if (nftTokens.length > 0) {
								const totalSerials = prize.nftSerials.reduce((sum, arr) => sum + arr.length, 0);
								prizeItems.push(`${totalSerials} NFT${totalSerials !== 1 ? 's' : ''}`);
							}
						}

						console.log(`       Serial #${serial}: ${prizeItems.join(' + ')}`);

						// Show NFT details if present
						if (prize.nftTokens.length > 0) {
							for (let j = 0; j < prize.nftTokens.length; j++) {
								const nftAddr = prize.nftTokens[j];
								if (nftAddr === '0x0000000000000000000000000000000000000000') continue;

								const nftTokenId = await convertToHederaId(nftAddr, EntityType.TOKEN);
								const serials = prize.nftSerials[j].map(s => Number(s));
								const serialsStr = serials.join(', ');

								try {
									const nftDets = await getTokenDetails(env, nftTokenId);
									console.log(`         → ${nftDets.symbol}: serials [${serialsStr}]`);
								}
								catch {
									console.log(`         → ${nftTokenId}: serials [${serialsStr}]`);
								}
							}
						}
					}
				}
			}
		}

		if (!hasPoolNFTs) {
			console.log('  No pool NFTs found\n');
		}
		else {
			console.log('');
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Get pending prizes count first
		const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userEvmAddress]);
		const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false);
		const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult)[0];

		// Get all pending prizes
		encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userEvmAddress, 0, Number(prizeCount)]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PENDING PRIZES');
		console.log('═══════════════════════════════════════════════════════════');

		if (pendingPrizes[0].length === 0) {
			console.log('  No pending prizes\n');
		}
		else {
			console.log(`  Total: ${pendingPrizes[0].length} prize(s)\n`);

			for (let i = 0; i < pendingPrizes[0].length; i++) {
				const pendingPrize = pendingPrizes[0][i];
				const poolId = pendingPrize.poolId;
				const prize = pendingPrize.prize;

				console.log(`  Prize #${i}:`);
				console.log(`    Pool:     #${poolId}`);
				console.log(`    As NFT:   ${pendingPrize.asNFT ? 'Yes' : 'No'}`);

				const prizeItems = [];
				if (prize.amount > 0) {
					const tokenId = prize.token === '0x0000000000000000000000000000000000000000'
						? 'HBAR'
						: await convertToHederaId(prize.token, EntityType.TOKEN);

					let formattedAmount;
					if (tokenId === 'HBAR') {
						formattedAmount = new Hbar(Number(prize.amount), HbarUnit.Tinybar).toString();
					}
					else {
						const tokenDets = await getTokenDetails(env, tokenId);
						formattedAmount = `${Number(prize.amount) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`;
					}
					prizeItems.push(formattedAmount);
				}
				if (prize.nftTokens.length > 0) {
					const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
					if (nftTokens.length > 0) {
						const totalSerials = prize.nftSerials.reduce((sum, arr) => sum + arr.length, 0);
						prizeItems.push(`${totalSerials} NFT${totalSerials !== 1 ? 's' : ''}`);
					}
				}

				console.log(`    Contents: ${prizeItems.join(' + ')}`);

				// Show NFT details
				if (prize.nftTokens.length > 0) {
					for (let j = 0; j < prize.nftTokens.length; j++) {
						const nftAddr = prize.nftTokens[j];
						if (nftAddr === '0x0000000000000000000000000000000000000000') continue;

						const nftTokenId = await convertToHederaId(nftAddr, EntityType.TOKEN);
						const serials = prize.nftSerials[j].map(s => Number(s));
						const serialsStr = serials.join(', ');

						try {
							const nftDets = await getTokenDetails(env, nftTokenId);
							console.log(`              → ${nftDets.symbol}: serials [${serialsStr}]`);
						}
						catch {
							console.log(`              → ${nftTokenId}: serials [${serialsStr}]`);
						}
					}
				}
				console.log();
			}
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Summary
		const totalMemoryEntries = userEntries.reduce((sum, e) => sum + e.entryCount, 0);
		const totalPendingPrizes = pendingPrizes[0].length;

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pools with entries:     ${userEntries.length}`);
		console.log(`  Total memory entries:   ${totalMemoryEntries}`);
		console.log(`  Pending prizes:         ${totalPendingPrizes}`);
		console.log(`  Current boost:          +${formatWinRate(Number(boostBps[0]))}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('✅ User state query complete!\n');

	}
	catch (error) {
		console.error('\n❌ Error fetching user state:', error.message);
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
getUserState();
