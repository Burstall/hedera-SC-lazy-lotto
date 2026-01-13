/**
 * Roll Command
 *
 * Roll pending entries to play the lottery.
 *
 * Usage: lazy-lotto roll <poolId> [count] [--json]
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const path = require('path');

const { LazyLottoABI } = require('../../index');

const utilsPath = path.join(__dirname, '../../utils');
const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require(`${utilsPath}/solidityHelpers`);
const { estimateGas } = require(`${utilsPath}/gasHelpers`);

module.exports = async function roll(args) {
	const outputJson = args.includes('--json');
	const numericArgs = args.filter(a => !a.startsWith('-') && !isNaN(parseInt(a)));
	const poolIdArg = numericArgs[0];
	const countArg = numericArgs[1];

	if (!poolIdArg) {
		console.error('Usage: lazy-lotto roll <poolId> [count] [--json]');
		process.exit(1);
	}

	const poolId = parseInt(poolIdArg);
	let quantity = countArg ? parseInt(countArg) : null;

	if (isNaN(poolId) || poolId < 0) {
		console.error('Invalid pool ID. Must be a non-negative integer.');
		process.exit(1);
	}

	const env = process.env.ENVIRONMENT ?? 'testnet';
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

	// Initialize client
	let client;
	const envUpper = env.toUpperCase();
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
		console.error(`Unknown environment: ${env}`);
		process.exit(1);
	}
	client.setOperator(operatorId, operatorKey);

	const lazyLottoIface = new ethers.Interface(LazyLottoABI);

	try {
		// Get user's entries
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();
		let encoded = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		let data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const totalEntries = Number(lazyLottoIface.decodeFunctionResult('getUsersEntries', data)[0]);

		if (totalEntries === 0) {
			const result = {
				success: false,
				error: 'No entries in this pool',
				poolId,
			};
			if (outputJson) {
				console.log(JSON.stringify(result, null, 2));
			}
			else {
				console.error(`You have no entries in pool #${poolId}`);
			}
			process.exit(1);
		}

		// Default to rolling all entries
		const rollAll = !quantity;
		if (rollAll) {
			quantity = totalEntries;
		}
		else if (quantity > totalEntries) {
			quantity = totalEntries;
		}

		// Get pool win rate
		encoded = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const [, , winRate] = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', data);

		// Get user boost
		encoded = lazyLottoIface.encodeFunctionData('calculateBoost', [userEvmAddress]);
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const boostBps = Number(lazyLottoIface.decodeFunctionResult('calculateBoost', data)[0]);

		const baseWinRate = Number(winRate);
		const boostedWinRate = baseWinRate + boostBps;
		const winRatePercent = (boostedWinRate / 1_000_000 * 100).toFixed(4);

		// Determine function to call
		let functionName;
		let functionArgs;

		if (rollAll) {
			functionName = 'rollAll';
			functionArgs = [poolId];
		}
		else {
			functionName = 'rollBatch';
			functionArgs = [poolId, quantity];
		}

		// Estimate gas with 2x multiplier for PRNG uncertainty
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, functionName, functionArgs, 800000);
		const gasEstimate = Math.floor(gasInfo.gasLimit * 2);

		if (!outputJson) {
			console.log(`\nRolling ${quantity} entries in pool #${poolId}...`);
			console.log(`Win rate: ${winRatePercent}%`);
		}

		// Execute roll
		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate,
			functionName,
			functionArgs,
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('Transaction failed');
			process.exit(1);
		}

		// Decode results
		let wins = 0;
		if (results && results.length >= 1) {
			wins = Number(results[0]);
		}

		// Wait for mirror node
		await new Promise(resolve => setTimeout(resolve, 5000));

		// Get updated state
		encoded = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const remainingEntries = Number(lazyLottoIface.decodeFunctionResult('getUsersEntries', data)[0]);

		// Get pending prizes count
		encoded = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userEvmAddress]);
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const pendingPrizes = Number(lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', data)[0]);

		const actualWinRate = quantity > 0 ? ((wins / quantity) * 100).toFixed(2) : '0.00';

		const result = {
			success: true,
			transaction: {
				id: record.transactionId.toString(),
				poolId,
				entriesRolled: quantity,
			},
			results: {
				wins,
				actualWinRate: `${actualWinRate}%`,
				expectedWinRate: `${winRatePercent}%`,
			},
			state: {
				remainingEntries,
				pendingPrizes,
			},
			metadata: {
				contract: contractId.toString(),
				environment: env,
				timestamp: new Date().toISOString(),
			},
		};

		if (outputJson) {
			console.log(JSON.stringify(result, null, 2));
		}
		else {
			console.log(`\nRoll complete!`);
			console.log(`Transaction: ${record.transactionId.toString()}`);
			console.log(`\nResults:`);
			console.log(`  Entries rolled: ${quantity}`);
			console.log(`  Wins: ${wins}`);
			console.log(`  Win rate: ${actualWinRate}% (expected ${winRatePercent}%)`);
			console.log(`\nState:`);
			console.log(`  Remaining entries: ${remainingEntries}`);
			console.log(`  Pending prizes: ${pendingPrizes}`);

			if (wins > 0) {
				console.log(`\nCongratulations! Use "lazy-lotto claim" to claim your prizes.`);
			}
		}
	}
	catch (error) {
		const result = {
			success: false,
			error: error.message,
		};
		if (outputJson) {
			console.log(JSON.stringify(result, null, 2));
		}
		else {
			console.error(`Error: ${error.message}`);
		}
		process.exit(1);
	}
	finally {
		client.close();
	}
};
