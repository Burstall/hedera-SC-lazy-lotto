/**
 * LazyLotto Remove Prizes Script
 *
 * Remove prizes from CLOSED pools and return them to caller.
 * Requires ADMIN role. Pool must be closed.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/removePrizes.js [poolId]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/removePrizes.js [poolId] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/removePrizes.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
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

const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

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
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		let poolIdStr = process.argv[2];

		// Filter out flag arguments
		if (poolIdStr && poolIdStr.startsWith('--')) {
			poolIdStr = null;
		}

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

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
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
		// eslint-disable-next-line no-unused-vars
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

		console.log('\n🔍 Fetching prize details...');
		const encodedPrizesQuery = lazyLottoIface.encodeFunctionData('getPrizes', [poolId]);
		const prizesResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedPrizesQuery,
			operatorId,
			false,
		);
		const [prizes] = lazyLottoIface.decodeFunctionResult('getPrizes', prizesResult);

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

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: 'removePrizes',
			params: [poolId],
			gas: gasLimit,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ Prizes removed successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);
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
