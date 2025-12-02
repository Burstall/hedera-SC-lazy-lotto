/**
 * LazyLotto Pool Info Query
 *
 * Retrieves detailed information about a specific pool including:
 * - Pool configuration (win rate, entry fee, etc.)
 * - All prizes in the pool
 * - Pool statistics
 *
 * Usage: node scripts/interactions/LazyLotto/queries/poolInfo.js [poolId]
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

		// Get pool details (includes prizes)
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [poolId]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolDetails', result);

		// Prizes are included in pool details
		const prizes = poolDetails.prizes;

		// Display pool configuration
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL CONFIGURATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Win Rate:         ${formatWinRate(poolDetails.winRateThousandthsOfBps)}`);

		const feeToken = await convertToHederaId(poolDetails.feeToken);
		const feeAmount = feeToken === 'HBAR'
			? formatHbar(poolDetails.entryFee)
			: `${poolDetails.entryFee} (${feeToken})`;
		console.log(`  Entry Fee:        ${feeAmount}`);

		console.log(`  Pool Token:       ${await convertToHederaId(poolDetails.poolTokenId)}`);
		console.log(`  State:            ${poolDetails.paused ? '⏸️  PAUSED' : poolDetails.closed ? '🔒 CLOSED' : '✅ ACTIVE'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Display prizes
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PRIZES');
		console.log('═══════════════════════════════════════════════════════════');

		if (prizes[0].length === 0) {
			console.log('  No prizes in this pool\n');
		}
		else {
			console.log(`  Total: ${prizes[0].length} prize(s)\n`);

			for (let i = 0; i < prizes[0].length; i++) {
				const prize = prizes[0][i];
				console.log(`  Prize #${i}:`);

				// FT component
				if (prize.amount > 0) {
					const tokenId = await convertToHederaId(prize.token);
					const amount = tokenId === 'HBAR' ? formatHbar(prize.amount) : prize.amount.toString();
					console.log(`    FT:   ${amount} ${tokenId}`);
				}

				// NFT components
				const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
				if (nftTokens.length > 0) {
					console.log(`    NFTs: ${prize.nftSerials.length} NFT(s) from ${nftTokens.length} collection(s)`);
					for (let j = 0; j < nftTokens.length; j++) {
						const tokenId = await convertToHederaId(nftTokens[j]);
						// Count serials for this token
						const serialCount = prize.nftSerials.filter((_, idx) =>
							prize.nftTokens[idx] === nftTokens[j],
						).length;
						console.log(`          - ${tokenId}: ${serialCount} serial(s)`);
					}
				}

				console.log();
			}
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool State:     ${poolDetails.paused ? 'PAUSED' : poolDetails.closed ? 'CLOSED' : 'ACTIVE'}`);
		console.log(`  Win Rate:       ${formatWinRate(poolDetails.winRateThousandthsOfBps)}`);
		console.log(`  Entry Fee:      ${feeAmount}`);
		console.log(`  Total Prizes:   ${prizes[0].length}`);
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
