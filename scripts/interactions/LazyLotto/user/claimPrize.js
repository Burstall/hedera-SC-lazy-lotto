/**
 * LazyLotto Claim Prize Script
 *
 * Claim a single pending prize (memory or NFT format).
 *
 * Usage: node scripts/interactions/LazyLotto/user/claimPrize.js [prizeIndex]
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

// Helper: Format HBAR
function formatHbar(tinybars) {
	return (Number(tinybars) / 100_000_000).toFixed(8) + ' ℏ';
}

async function claimPrize() {
	let client;

	try {
		// Get prize index
		let prizeIndexStr = process.argv[2];

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
		console.log('║              LazyLotto Claim Prize                        ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		console.log('🔍 Fetching your pending prizes...\n');

		// Get pending prizes
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();
		// Get pending prizes count first
		let countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userEvmAddress]);
		let countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false);
		const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult)[0];

		// Get all pending prizes
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userEvmAddress, 0, Number(prizeCount)]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', result);

		if (pendingPrizes[0].length === 0) {
			console.log('❌ You have no pending prizes to claim\n');
			process.exit(0);
		}

		console.log(`✅ You have ${pendingPrizes[0].length} pending prize(s)\n`);

		// Display prizes
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  YOUR PENDING PRIZES');
		console.log('═══════════════════════════════════════════════════════════');

		for (let i = 0; i < pendingPrizes[0].length; i++) {
			const pendingPrize = pendingPrizes[0][i];
			const prize = pendingPrize.prize;

			console.log(`  [${i}] Pool #${pendingPrize.poolId}`);
			console.log(`      Format: ${pendingPrize.asNFT ? 'Prize NFT' : 'Memory'}`);

			const prizeItems = [];
			if (prize.amount > 0) {
				const tokenId = await convertToHederaId(prize.token);
				prizeItems.push(tokenId === 'HBAR' ? formatHbar(prize.amount) : `${prize.amount} ${tokenId}`);
			}
			if (prize.nftTokens.length > 0) {
				const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
				if (nftTokens.length > 0) {
					prizeItems.push(`${prize.nftSerials.length} NFT(s)`);
				}
			}

			console.log(`      Contents: ${prizeItems.join(' + ')}`);
			console.log();
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Get prize index to claim
		if (!prizeIndexStr) {
			prizeIndexStr = await prompt(`Enter prize index to claim (0-${pendingPrizes[0].length - 1}): `);
		}

		const prizeIndex = parseInt(prizeIndexStr);

		if (isNaN(prizeIndex) || prizeIndex < 0 || prizeIndex >= pendingPrizes[0].length) {
			console.error(`❌ Invalid prize index (must be 0-${pendingPrizes[0].length - 1})`);
			process.exit(1);
		}

		const selectedPrize = pendingPrizes[0][prizeIndex];
		const prize = selectedPrize.prize;

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CLAIMING PRIZE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Index:    ${prizeIndex}`);
		console.log(`  Pool:     #${selectedPrize.poolId}`);
		console.log(`  Format:   ${selectedPrize.asNFT ? 'Prize NFT' : 'Memory'}`);

		const prizeItems = [];
		if (prize.amount > 0) {
			const tokenId = await convertToHederaId(prize.token);
			prizeItems.push(tokenId === 'HBAR' ? formatHbar(prize.amount) : `${prize.amount} ${tokenId}`);
		}
		if (prize.nftTokens.length > 0) {
			const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
			if (nftTokens.length > 0) {
				prizeItems.push(`${prize.nftSerials.length} NFT(s)`);
			}
		}

		console.log(`  Contents: ${prizeItems.join(' + ')}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'claimPrize', [prizeIndex], 500000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm claim
		const confirm = await prompt('Proceed with claim? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Claim cancelled');
			process.exit(0);
		}

		// Execute claim
		console.log('\n🔄 Claiming prize...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'claimPrize',
			[prizeIndex],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Prize claimed successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		// Get updated pending prizes
		// Get updated pending prizes
		countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userEvmAddress]);
		countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false);
		const newPrizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult)[0];

		encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userEvmAddress, 0, Number(newPrizeCount)]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const newPendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED STATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Remaining pending prizes: ${newPendingPrizes[0].length}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (newPendingPrizes[0].length > 0) {
			console.log('💡 You still have prizes to claim!');
			console.log('   Use claimAllPrizes.js to claim them all at once\n');
		}
		else {
			console.log('🎉 All prizes claimed!\n');
		}

	}
	catch (error) {
		console.error('\n❌ Error claiming prize:', error.message);
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
claimPrize();
