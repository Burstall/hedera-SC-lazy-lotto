require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('createPool');

	// PoolConfig: token, ticketPrice, minEntries, maxEntriesPerUser, houseEdge, duration
	const [token, ticketPrice, minEntries, maxEntriesPerUser, houseEdge, duration] = process.argv.slice(2);
	if (!token || !ticketPrice || !minEntries || !maxEntriesPerUser || !houseEdge || !duration) {
		console.error('Usage: node createPool.js <token> <ticketPrice> <minEntries> <maxEntriesPerUser> <houseEdge> <duration>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addAddress(token)
		.addUint256(ticketPrice)
		.addUint256(minEntries)
		.addUint256(maxEntriesPerUser)
		.addUint256(houseEdge)
		.addUint256(duration);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'createPool', 200000);
	await tx.getReceipt(client);
	console.log('createPool executed successfully.');
})();
