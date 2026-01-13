/**
 * Info Command
 *
 * Display LazyLotto contract configuration.
 *
 * Usage: lazy-lotto info [--json]
 */

const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const path = require('path');

const { LazyLottoABI } = require('../../index');

const utilsPath = path.join(__dirname, '../../utils');
const { readOnlyEVMFromMirrorNode } = require(`${utilsPath}/solidityHelpers`);
const { homebrewPopulateAccountNum, EntityType } = require(`${utilsPath}/hederaMirrorHelpers`);

module.exports = async function info(args) {
	const outputJson = args.includes('--json');
	const env = process.env.ENVIRONMENT ?? 'testnet';
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

	const lazyLottoIface = new ethers.Interface(LazyLottoABI);

	// Fetch configuration
	async function fetchValue(fnName) {
		const encoded = lazyLottoIface.encodeFunctionData(fnName);
		const data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return lazyLottoIface.decodeFunctionResult(fnName, data)[0];
	}

	const [lazyToken, lazyGasStation, lazyDelegateRegistry, prng, storageContract, burnPercentage, isPaused, totalPools] = await Promise.all([
		fetchValue('lazyToken'),
		fetchValue('lazyGasStation'),
		fetchValue('lazyDelegateRegistry'),
		fetchValue('prng'),
		fetchValue('storageContract'),
		fetchValue('burnPercentage'),
		fetchValue('paused'),
		fetchValue('totalPools'),
	]);

	// Convert addresses
	const lazyTokenId = await homebrewPopulateAccountNum(env, lazyToken, EntityType.TOKEN);
	const lazyGasStationId = await homebrewPopulateAccountNum(env, lazyGasStation, EntityType.CONTRACT);
	const lazyDelegateRegistryId = await homebrewPopulateAccountNum(env, lazyDelegateRegistry, EntityType.CONTRACT);
	const prngId = await homebrewPopulateAccountNum(env, prng, EntityType.CONTRACT);
	const storageId = await homebrewPopulateAccountNum(env, storageContract, EntityType.CONTRACT);

	const result = {
		success: true,
		config: {
			contractId: contractId.toString(),
			paused: isPaused,
			burnPercentage: Number(burnPercentage),
			totalPools: Number(totalPools),
			lazyToken: lazyTokenId,
			connectedContracts: {
				lazyGasStation: lazyGasStationId,
				lazyDelegateRegistry: lazyDelegateRegistryId,
				prng: prngId,
				storage: storageId,
			},
		},
		metadata: {
			environment: env,
			timestamp: new Date().toISOString(),
		},
	};

	if (outputJson) {
		console.log(JSON.stringify(result, null, 2));
	}
	else {
		console.log('\nLazyLotto Contract Configuration');
		console.log('='.repeat(50));
		console.log(`Contract:          ${contractId.toString()}`);
		console.log(`Environment:       ${env.toUpperCase()}`);
		console.log(`Status:            ${isPaused ? '🔴 Paused' : '🟢 Active'}`);
		console.log(`Burn Percentage:   ${burnPercentage}%`);
		console.log(`Total Pools:       ${totalPools}`);

		console.log('\nConnected Contracts:');
		console.log('-'.repeat(50));
		console.log(`LAZY Token:        ${lazyTokenId}`);
		console.log(`Gas Station:       ${lazyGasStationId}`);
		console.log(`Delegate Registry: ${lazyDelegateRegistryId}`);
		console.log(`PRNG:              ${prngId}`);
		console.log(`Storage:           ${storageId}`);
		console.log();
	}
};
