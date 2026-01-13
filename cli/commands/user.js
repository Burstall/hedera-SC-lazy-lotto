/**
 * User Command
 *
 * Get user state across all pools.
 *
 * Usage: lazy-lotto user [address] [--json]
 */

const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const path = require('path');

const { LazyLottoABI } = require('../../index');

const utilsPath = path.join(__dirname, '../../utils');
const { readOnlyEVMFromMirrorNode } = require(`${utilsPath}/solidityHelpers`);

module.exports = async function user(args) {
	const outputJson = args.includes('--json');
	const addressArg = args.find(a => !a.startsWith('-') && a.includes('0.0.'));

	const env = process.env.ENVIRONMENT ?? 'testnet';
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

	// User address - default to operator if not provided
	let userAddress;
	if (addressArg) {
		userAddress = AccountId.fromString(addressArg);
	}
	else {
		userAddress = operatorId;
	}

	const lazyLottoIface = new ethers.Interface(LazyLottoABI);

	// Get total pools
	let encoded = lazyLottoIface.encodeFunctionData('totalPools');
	let data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
	const totalPools = Number(lazyLottoIface.decodeFunctionResult('totalPools', data)[0]);

	const userState = {
		address: userAddress.toString(),
		pools: [],
		totals: {
			pendingEntries: 0,
			pendingPrizes: 0,
		},
	};

	// Check each pool for user state
	for (let poolId = 0; poolId < totalPools; poolId++) {
		try {
			encoded = lazyLottoIface.encodeFunctionData('getUserPoolState', [poolId, userAddress.toSolidityAddress()]);
			data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
			const state = lazyLottoIface.decodeFunctionResult('getUserPoolState', data);

			const pendingEntries = Number(state[0]);
			const pendingPrizes = Number(state[1]);

			if (pendingEntries > 0 || pendingPrizes > 0) {
				userState.pools.push({
					poolId,
					pendingEntries,
					pendingPrizes,
				});
				userState.totals.pendingEntries += pendingEntries;
				userState.totals.pendingPrizes += pendingPrizes;
			}
		}
		catch {
			// Pool might not exist or user has no state
		}
	}

	const result = {
		success: true,
		user: userState,
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
		console.log(`\nUser State: ${userAddress.toString()}`);
		console.log('='.repeat(50));
		console.log(`Contract: ${contractId.toString()}\n`);

		if (userState.pools.length === 0) {
			console.log('No pending entries or prizes in any pool.\n');
		}
		else {
			console.log('Pool | Pending Entries | Pending Prizes');
			console.log('-'.repeat(50));

			for (const pool of userState.pools) {
				console.log(`${pool.poolId.toString().padEnd(4)} | ${pool.pendingEntries.toString().padEnd(15)} | ${pool.pendingPrizes}`);
			}

			console.log('-'.repeat(50));
			console.log(`Total: ${userState.totals.pendingEntries} entries, ${userState.totals.pendingPrizes} prizes\n`);

			if (userState.totals.pendingEntries > 0) {
				console.log('Use "lazy-lotto roll <poolId>" to roll your entries.');
			}
			if (userState.totals.pendingPrizes > 0) {
				console.log('Use "lazy-lotto claim <poolId>" to claim your prizes.');
			}
			console.log();
		}
	}
};
