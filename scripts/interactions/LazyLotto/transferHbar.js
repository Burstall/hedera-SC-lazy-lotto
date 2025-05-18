require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('transferHbar');

	// Args: recipient, amount
	const [recipient, amount] = process.argv.slice(2);
	if (!recipient || !amount) {
		console.error('Usage: node transferHbar.js <recipientAddress> <amountTinybars>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addAddress(recipient)
		.addUint256(amount);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'transferHbar', 100000);
	await tx.getReceipt(client);
	console.log('transferHbar executed successfully.');
})();
