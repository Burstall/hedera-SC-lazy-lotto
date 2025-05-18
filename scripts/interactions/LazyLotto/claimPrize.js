require('dotenv').config();
const { getClient, getContractId } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');

	// Args: poolId, entryId
	const [poolId, entryId] = process.argv.slice(2);
	if (!poolId || !entryId) {
		console.error('Usage: node claimPrize.js <poolId> <entryId>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(poolId)
		.addUint256(entryId);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'claimPrize', 200000);
	await tx.getReceipt(client);
	console.log('claimPrize executed successfully.');
})();
