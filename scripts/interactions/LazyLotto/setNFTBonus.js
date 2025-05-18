require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('setNFTBonus');

	const nftToken = process.argv[2];
	const bonusBps = Number(process.argv[3]);
	if (!nftToken || !bonusBps) {
		console.error('Usage: node setNFTBonus.js <nftToken> <bonusBps>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addAddress(nftToken)
		.addUint256(bonusBps);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'setNFTBonus', 100000);
	await tx.getReceipt(client);
	console.log('setNFTBonus executed successfully.');
})();
