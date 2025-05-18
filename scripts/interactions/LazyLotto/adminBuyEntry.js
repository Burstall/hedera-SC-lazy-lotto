require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('adminBuyEntry');

	// Args: poolId, numEntries, recipient
	const [poolId, numEntries, recipient] = process.argv.slice(2);
	if (!poolId || !numEntries || !recipient) {
		console.error('Usage: node adminBuyEntry.js <poolId> <numEntries> <recipientAddress>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(poolId)
		.addUint256(numEntries)
		.addAddress(recipient);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'adminBuyEntry', 200000);
	await tx.getReceipt(client);
	console.log('adminBuyEntry executed successfully.');
})();
