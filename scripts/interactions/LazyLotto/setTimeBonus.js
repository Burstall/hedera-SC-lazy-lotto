require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('setTimeBonus');

	const start = Number(process.argv[2]);
	const end = Number(process.argv[3]);
	const bonusBps = Number(process.argv[4]);
	if (!start || !end || !bonusBps) {
		console.error('Usage: node setTimeBonus.js <start> <end> <bonusBps>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(start)
		.addUint256(end)
		.addUint256(bonusBps);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'setTimeBonus', 100000);
	await tx.getReceipt(client);
	console.log('setTimeBonus executed successfully.');
})();
