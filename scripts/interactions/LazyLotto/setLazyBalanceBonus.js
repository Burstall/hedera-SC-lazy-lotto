require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('setLazyBalanceBonus');

	const threshold = BigInt(process.argv[2]);
	const bonusBps = Number(process.argv[3]);
	if (!threshold || !bonusBps) {
		console.error('Usage: node setLazyBalanceBonus.js <threshold> <bonusBps>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(threshold)
		.addUint256(bonusBps);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'setLazyBalanceBonus', 100000);
	await tx.getReceipt(client);
	console.log('setLazyBalanceBonus executed successfully.');
})();
