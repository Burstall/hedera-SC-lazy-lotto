require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('removePrizes');

	const poolId = process.argv[2];
	if (!poolId) {
		console.error('Usage: node removePrizes.js <poolId>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters().addUint256(poolId);
	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'removePrizes', 200000);
	await tx.getReceipt(client);
	console.log('removePrizes executed successfully.');
})();
