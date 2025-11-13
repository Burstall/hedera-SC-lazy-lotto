/**
 * LazyLotto Claim All Prizes Script
 *
 * Claims all pending prizes at once.
 * Convenience function that internally calls claimPrize for each pending prize.
 *
 * Usage: node scripts/interactions/LazyLotto/user/claimAllPrizes.js
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

async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	const { homebrewPopulateAccountNum } = require('../../../utils/hederaMirrorHelpers');
	return await homebrewPopulateAccountNum(env, evmAddress);
}

// Helper: Format HBAR
function formatHbar(tinybars) {
	return (Number(tinybars) / 100_000_000).toFixed(8) + ' ℏ';
}

async function claimAllPrizes() {
	let client;

	try {
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
		console.log('║            LazyLotto Claim All Prizes                     ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../utils/gasHelpers');

		console.log('🔍 Fetching your pending prizes...\n');

		// Get pending prizes
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizes', [userEvmAddress]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizes', result);

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

			console.log(`  Prize #${i}:`);
			console.log(`    Pool:     #${pendingPrize.poolId}`);
			console.log(`    Format:   ${pendingPrize.asNFT ? 'Prize NFT' : 'Memory'}`);

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

			console.log(`    Contents: ${prizeItems.join(' + ')}`);
			console.log();
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas
		encodedCommand = lazyLottoIface.encodeFunctionData('claimAllPrizes');
		const gasEstimate = await estimateGas(env, contractId, encodedCommand, operatorId);
		console.log(`⛽ Estimated gas: ~${gasEstimate} gas\n`);

		// Confirm claim
		const confirm = await prompt(`Claim all ${pendingPrizes[0].length} prize(s)? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Claim cancelled');
			process.exit(0);
		}

		// Execute claim
		console.log('\n🔄 Claiming all prizes...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [success, txReceipt] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'claimAllPrizes',
			[],
		);

		if (!success) {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ All prizes claimed successfully!');
		console.log(`📋 Transaction: ${txReceipt.transactionId.toString()}\n`);

		console.log('🎉 All prizes have been transferred to your account!\n');

	}
	catch (error) {
		console.error('\n❌ Error claiming prizes:', error.message);
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
claimAllPrizes();
