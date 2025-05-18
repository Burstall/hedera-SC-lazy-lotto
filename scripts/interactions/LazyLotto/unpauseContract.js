require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('unpauseContract');

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, undefined, 0, 'unpauseContract', 100000);
	await tx.getReceipt(client);
	console.log('unpauseContract executed successfully.');
})();
