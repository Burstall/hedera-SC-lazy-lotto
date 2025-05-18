require('dotenv').config();
const { getClient, getContractId } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');

	// Args: poolId, batchSize
	const [poolId, batchSize] = process.argv.slice(2);
	if (!poolId || !batchSize) {
		console.error('Usage: node rollBatch.js <poolId> <batchSize>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(poolId)
		.addUint256(batchSize);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'rollBatch', 200000);
	await tx.getReceipt(client);
	console.log('rollBatch executed successfully.');
})();
