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

// Helper: Format HBAR
function formatHbar(tinybars) {
	return (Number(tinybars) / 100_000_000).toFixed(8) + ' ℏ';
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

		// Convert to EVM format
		const userEvmAddress = convertToEvmAddress(userAddress);
		const userHederaId = await convertToHederaId(userEvmAddress);

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
		const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');

		console.log('🔍 Fetching user data...\n');

		// Get user's boost
		let encodedCommand = lazyLottoIface.encodeFunctionData('calculateBoost', [userEvmAddress]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const boostBps = lazyLottoIface.decodeFunctionResult('calculateBoost', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  WIN RATE BOOST');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Current Boost: +${formatWinRate(boostBps[0])}`);
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
				encodedCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [i]);
				result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
				const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolDetails', result);

				userEntries.push({
					poolId: i,
					entryCount: Number(entries[0]),
					winRate: poolDetails.winRateThousandthsOfBps,
					entryFee: poolDetails.entryFee,
					feeToken: poolDetails.feeToken === '0x0000000000000000000000000000000000000000'
						? 'HBAR'
						: await convertToHederaId(poolDetails.feeToken),
					poolTokenId: await convertToHederaId(poolDetails.poolTokenId),
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
				console.log(`    Entry Fee:  ${entry.feeToken === 'HBAR' ? formatHbar(entry.entryFee) : `${entry.entryFee} (${entry.feeToken})`}`);
				console.log();
			}
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Get pending prizes
		encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizes', [userEvmAddress]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizes', result);

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
						: await convertToHederaId(prize.token);
					prizeItems.push(
						tokenId === 'HBAR'
							? formatHbar(prize.amount)
							: `${prize.amount} ${tokenId}`,
					);
				}
				if (prize.nftTokens.length > 0) {
					const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
					if (nftTokens.length > 0) {
						prizeItems.push(`${prize.nftSerials.length} NFTs from ${nftTokens.length} collection(s)`);
					}
				}

				console.log(`    Contents: ${prizeItems.join(' + ')}`);
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
		console.log(`  Current boost:          +${formatWinRate(boostBps[0])}`);
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
