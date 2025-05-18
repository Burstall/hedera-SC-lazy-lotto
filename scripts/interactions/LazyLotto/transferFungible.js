require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('transferFungible');

	// Args: token, recipient, amount
	const [token, recipient, amount] = process.argv.slice(2);
	if (!token || !recipient || !amount) {
		console.error('Usage: node transferFungible.js <tokenAddress> <recipientAddress> <amount>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addAddress(token)
		.addAddress(recipient)
		.addUint256(amount);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'transferFungible', 100000);
	await tx.getReceipt(client);
	console.log('transferFungible executed successfully.');
})();
