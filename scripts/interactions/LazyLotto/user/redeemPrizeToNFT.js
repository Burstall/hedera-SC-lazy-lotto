/**
 * LazyLotto Redeem Prize to NFT Script
 *
 * Convert pending prizes (memory format) to NFT format.
 * NFTs can be held, transferred, or claimed later.
 *
 * Usage: node scripts/interactions/LazyLotto/user/redeemPrizeToNFT.js [index1,index2,...]
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');
const { associateTokensToAccount } = require('../../../../utils/hederaHelpers');
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

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR';
	}

	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

async function redeemPrizeToNFT() {
	let client;

	try {
		// Get indices parameter
		let indicesStr = process.argv[2];

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
		console.log('║         LazyLotto Redeem Prizes to NFT Format             ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 User: ${operatorId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');
		const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

		// Get pending prizes
		console.log('🔍 Fetching pending prizes...\n');

		// Get pending prizes count first
		const userAddress = `0x${operatorId.toSolidityAddress()}`;
		const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userAddress]);
		const countResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			countQuery,
			operatorId,
			false,
		);
		const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult)[0];

		if (Number(prizeCount) === 0) {
			console.log('⚠️  No pending prizes found\n');
			process.exit(0);
		}

		// Get all pending prizes
		const encodedQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userAddress, 0, Number(prizeCount)]);
		let result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedQuery,
			operatorId,
			false,
		);
		const pendingPrizesResult = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', result);
		const pendingPrizes = pendingPrizesResult[0];

		if (!pendingPrizes || pendingPrizes.length === 0) {
			console.log('⚠️  No pending prizes found\n');
			process.exit(0);
		}

		// Display prizes
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PENDING PRIZES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total: ${pendingPrizes.length} prize(s)\n`);

		for (let i = 0; i < pendingPrizes.length; i++) {
			const pendingPrize = pendingPrizes[i];
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

					const nftTokenId = await convertToHederaId(nftAddr);
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

		console.log('═══════════════════════════════════════════════════════════\n');

		// Get indices if not provided
		if (!indicesStr) {
			indicesStr = await prompt('Enter prize indices to convert to NFT (comma-separated, e.g., 0,1,2): ');
		}

		// Parse indices
		const indices = indicesStr.split(',').map(s => {
			const idx = parseInt(s.trim());
			if (isNaN(idx) || idx < 0 || idx >= pendingPrizes.length) {
				throw new Error(`Invalid index: ${s.trim()}`);
			}
			return idx;
		});

		if (indices.length === 0) {
			console.error('❌ No valid indices provided');
			process.exit(1);
		}

		// Get unique pool IDs from selected prizes
		const poolIds = [...new Set(indices.map(i => Number(pendingPrizes[i].poolId)))];

		// Check association for each pool's token
		console.log('🔍 Checking pool token associations...\n');
		const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');

		for (const poolId of poolIds) {
			const poolInfoCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
			const poolInfoResult = await readOnlyEVMFromMirrorNode(env, contractId, poolInfoCommand, operatorId, false);
			const [, , , , , , poolTokenIdEvm] = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolInfoResult);

			const poolTokenHederaId = await convertToHederaId(poolTokenIdEvm);
			const userBalance = await checkMirrorBalance(env, operatorId, poolTokenHederaId);

			if (userBalance === null) {
				console.log(`🔗 Associating pool #${poolId} token (${poolTokenHederaId})...`);
				result = await associateTokensToAccount(
					client,
					operatorId,
					operatorKey,
					[TokenId.fromString(poolTokenHederaId)],
				);

				if (result !== 'SUCCESS') {
					console.error(`❌ Failed to associate pool #${poolId} token`);
					process.exit(1);
				}
				console.log(`✅ Pool #${poolId} token associated`);
				console.log('⏳ Waiting 5 seconds for mirror node to sync...');
				await new Promise(resolve => setTimeout(resolve, 5000));
			}
			else {
				console.log(`✅ Pool #${poolId} token already associated (${poolTokenHederaId})`);
			}
		}
		console.log('');

		console.log(`Converting ${indices.length} prize(s) to NFT format...\n`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'redeemPrizeToNFT', [indices], 800000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		const confirm = await prompt(`Redeem ${indices.length} prize(s) to NFT format? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Redeeming prizes to NFT...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'redeemPrizeToNFT',
			[indices],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Prizes redeemed to NFT format!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🎨 Prize NFTs minted and added to your pending prizes.');
		console.log('   Use claimFromPrizeNFT.js to claim them later.\n');

	}
	catch (error) {
		console.error('\n❌ Error redeeming prizes:', error.message);
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
redeemPrizeToNFT();
