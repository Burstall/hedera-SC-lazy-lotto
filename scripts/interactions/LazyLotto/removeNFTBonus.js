require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('removeNFTBonus');

	const nftToken = process.argv[2];
	if (!nftToken) {
		console.error('Usage: node removeNFTBonus.js <nftToken>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters().addAddress(nftToken);
	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'removeNFTBonus', 100000);
	await tx.getReceipt(client);
	console.log('removeNFTBonus executed successfully.');
})();
