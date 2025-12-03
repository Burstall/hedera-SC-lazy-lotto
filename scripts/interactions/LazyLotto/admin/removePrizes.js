/**
 * LazyLotto Remove Prizes Script
 *
 * Remove prizes from CLOSED pools and return them to caller.
 * Requires ADMIN role. Pool must be closed.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/removePrizes.js [poolId]
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

async function removePrizes() {
	let client;

	try {
		let poolIdStr = process.argv[2];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID to remove prizes from: ');
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
		console.log('║           LazyLotto Remove Prizes (Admin)                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		// Check pool status
		console.log('🔍 Checking pool status...');

		const encodedQuery = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		const poolBasicInfo = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedQuery,
			operatorId,
			false,
		);
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken] =
			lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolBasicInfo);

		if (!closed) {
			console.error('\n❌ Pool is not closed. Must close pool first.');
			process.exit(1);
		}

		console.log(`Total prizes in pool: ${Number(prizeCount)}`);

		// Get prize packages from pool
		if (Number(prizeCount) === 0) {
			console.log('\n⚠️  No prizes to remove');
			process.exit(0);
		}

		console.log(`\nPrizes to remove: ${prizes.length} packages\n`);

		// Display prizes
		for (let i = 0; i < prizes.length; i++) {
			console.log(`Prize Package #${i}:`);

			// FT components
			if (prizes[i].ftComponents && prizes[i].ftComponents.length > 0) {
				console.log('  Fungible Tokens:');
				for (const ft of prizes[i].ftComponents) {
					const tokenId = await convertToHederaId(ft.tokenAddress);
					console.log(`    - ${ethers.formatUnits(ft.amount, ft.decimals)} ${tokenId}`);
				}
			}

			// NFT components
			if (prizes[i].nftComponents && prizes[i].nftComponents.length > 0) {
				console.log('  NFTs:');
				for (const nft of prizes[i].nftComponents) {
					const tokenId = await convertToHederaId(nft.tokenAddress);
					console.log(`    - ${nft.serials.length} serials from ${tokenId}`);
				}
			}
		}

		// Estimate gas
		console.log('\n⛽ Estimating gas...');
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'removePrizes', [poolId], 500000);
		const gasEstimate = gasInfo.gasLimit;
		console.log(`   Estimated: ~${gasEstimate} gas\n`);

		// Confirm
		console.log('⚠️  This will remove ALL prizes from the pool and return them to your account.');
		const confirm = await prompt(`Remove ${prizes.length} prize packages from pool #${poolId}? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Removing prizes...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'removePrizes',
			[poolId],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Prizes removed successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);
		console.log('💰 Prizes returned to your account\n');

	}
	catch (error) {
		console.error('\n❌ Error removing prizes:', error.message);
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
removePrizes();
