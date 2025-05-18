require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('removeTimeBonus');

	const start = Number(process.argv[2]);
	const end = Number(process.argv[3]);
	if (!start || !end) {
		console.error('Usage: node removeTimeBonus.js <start> <end>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(start)
		.addUint256(end);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'removeTimeBonus', 100000);
	await tx.getReceipt(client);
	console.log('removeTimeBonus executed successfully.');
})();
