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

		// Get pending prizes
		console.log('🔍 Fetching pending prizes...');

		const userAddress = operatorId.toSolidityAddress();
		const encodedQuery = lazyLottoIface.encodeFunctionData('getPendingPrizes', [userAddress]);
		const pendingPrizes = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedQuery,
			lazyLottoIface,
			'getPendingPrizes',
			false,
		);

		if (!pendingPrizes || pendingPrizes.length === 0) {
			console.log('\n⚠️  No pending prizes found');
			process.exit(0);
		}

		// Display prizes
		console.log(`\nFound ${pendingPrizes.length} pending prize(s):\n`);

		for (let i = 0; i < pendingPrizes.length; i++) {
			const prize = pendingPrizes[i];

			console.log(`${i}. Pool #${prize.poolId} (${prize.formatType === 0 ? 'Memory' : 'NFT'})`);

			// FT components
			if (prize.ftComponents && prize.ftComponents.length > 0) {
				console.log('   Fungible Tokens:');
				for (const ft of prize.ftComponents) {
					const tokenId = await convertToHederaId(ft.tokenAddress);
					console.log(`     - ${ethers.formatUnits(ft.amount, ft.decimals)} ${tokenId}`);
				}
			}

			// NFT components
			if (prize.nftComponents && prize.nftComponents.length > 0) {
				console.log('   NFTs:');
				for (const nft of prize.nftComponents) {
					const tokenId = await convertToHederaId(nft.tokenAddress);
					console.log(`     - ${nft.serials.length} NFT(s) from ${tokenId}`);
				}
			}

			console.log('');
		}

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

		console.log(`\nConverting ${indices.length} prize(s) to NFT format...\n`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'redeemPrizeToNFT', [indices], 500000);
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

		const [receipt, results, record] = await contractExecuteFunction(
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
