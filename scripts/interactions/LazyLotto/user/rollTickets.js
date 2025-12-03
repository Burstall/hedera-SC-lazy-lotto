/**
 * LazyLotto Roll Tickets Script
 *
 * Roll (play) your memory entries to win prizes.
 * Uses 2x gas multiplier due to PRNG uncertainty.
 *
 * Supports:
 * - Roll all entries at once
 * - Roll specific quantity in batches
 * - Roll with NFT boost (provide NFT serial)
 *
 * Usage: node scripts/interactions/LazyLotto/user/rollTickets.js [poolId] [quantity] [nftSerial]
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

async function rollTickets() {
	let client;

	try {
		// Get parameters
		let poolIdStr = process.argv[2];
		let quantityStr = process.argv[3];
		const nftSerialStr = process.argv[4];

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
		console.log('║              LazyLotto Roll Tickets                       ║');
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
		const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		console.log('🔍 Checking your entries...\n');

		// Get user's entries
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();
		let encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const entries = lazyLottoIface.decodeFunctionResult('getUsersEntries', result);

		const totalEntries = Number(entries[0]);

		if (totalEntries === 0) {
			console.error('❌ You have no entries in this pool');
			process.exit(1);
		}

		console.log(`✅ You have ${totalEntries} entries in pool #${poolId}\n`);

		// Get pool details
		encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken] =
			lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);

		// Get user's boost
		encodedCommand = lazyLottoIface.encodeFunctionData('calculateBoost', [userEvmAddress]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const boostBps = lazyLottoIface.decodeFunctionResult('calculateBoost', result);

		const baseWinRate = Number(winRate);
		const boostedWinRate = baseWinRate + Number(boostBps[0]);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Base Win Rate:    ${formatWinRate(baseWinRate)}`);
		console.log(`  Your Boost:       +${formatWinRate(Number(boostBps[0]))}`);
		console.log(`  Boosted Win Rate: ${formatWinRate(boostedWinRate)}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Determine quantity to roll
		let quantity;
		let rollAll = false;

		if (!quantityStr) {
			const response = await prompt(`Roll all ${totalEntries} entries? (yes/no): `);
			if (response.toLowerCase() === 'yes' || response.toLowerCase() === 'y') {
				quantity = totalEntries;
				rollAll = true;
			}
			else {
				quantityStr = await prompt(`Enter quantity to roll (1-${totalEntries}): `);
				quantity = parseInt(quantityStr);
			}
		}
		else {
			quantity = parseInt(quantityStr);
		}

		if (isNaN(quantity) || quantity <= 0 || quantity > totalEntries) {
			console.error(`❌ Invalid quantity (must be 1-${totalEntries})`);
			process.exit(1);
		}

		// Check for NFT boost
		let nftSerial = null;
		if (nftSerialStr) {
			nftSerial = parseInt(nftSerialStr);
			if (isNaN(nftSerial)) {
				console.error('❌ Invalid NFT serial');
				process.exit(1);
			}

			// Verify ownership
			const poolTokenId = await convertToHederaId(poolDetails.poolTokenId);
			const { getSerialsOwned } = require('../../../../utils/hederaMirrorHelpers');
			const ownedSerials = await getSerialsOwned(env, operatorId.toString(), poolTokenId);

			if (!ownedSerials.includes(nftSerial)) {
				console.error(`❌ You don't own serial #${nftSerial} of ${poolTokenId}`);
				process.exit(1);
			}

			console.log(`🎫 Using NFT boost: ${poolTokenId} serial #${nftSerial}\n`);
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  ROLL SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Quantity:         ${quantity} entries`);
		console.log(`  Win Rate:         ${formatWinRate(boostedWinRate)}`);
		if (nftSerial !== null) {
			console.log(`  NFT Boost:        Serial #${nftSerial}`);
		}
		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas with 2x multiplier for PRNG uncertainty
		console.log('⛽ Estimating gas (2x multiplier for PRNG)...');

		let functionName;
		let functionArgs;

		if (nftSerial !== null) {
			functionName = 'rollWithNFT';
			functionArgs = [poolId, quantity, nftSerial];
		}
		else if (rollAll) {
			functionName = 'rollAll';
			functionArgs = [poolId];
		}
		else {
			functionName = 'rollBatch';
			functionArgs = [poolId, quantity];
		}

		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, functionName, functionArgs, 800000);
		const baseGasEstimate = gasInfo.gasLimit;
		const gasEstimate = Math.floor(baseGasEstimate * 2); console.log(`   Base estimate: ${baseGasEstimate} gas`);
		console.log(`   With 2x multiplier: ${gasEstimate} gas\n`);

		// Confirm roll
		const confirm = await prompt('Proceed with rolling? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Roll cancelled');
			process.exit(0);
		}

		// Execute roll
		console.log('\n🎲 Rolling tickets...');

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate,
			functionName,
			functionArgs,
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Tickets rolled successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		// Get updated state
		encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const newEntries = lazyLottoIface.decodeFunctionResult('getUsersEntries', result);

		// Get updated pending prizes count
		const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userEvmAddress]);
		const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false);
		const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult)[0];

		encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userEvmAddress, 0, Number(prizeCount)]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED STATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Remaining entries: ${newEntries[0]}`);
		console.log(`  Pending prizes:    ${pendingPrizes[0].length}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (pendingPrizes[0].length > 0) {
			console.log('🎉 You have prizes to claim!');
			console.log('💡 Use claimPrize.js or claimAllPrizes.js to claim them\n');
		}
		else {
			console.log('😔 No prizes won this round. Better luck next time!\n');
		}

	}
	catch (error) {
		console.error('\n❌ Error rolling tickets:', error.message);
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
rollTickets();
