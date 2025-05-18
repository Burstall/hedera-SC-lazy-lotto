require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('addMultipleFungiblePrizes');

	// Args: poolId, token, amounts (comma-separated string)
	const [poolId, token, amountsStr] = process.argv.slice(2);
	if (!poolId || !token || !amountsStr) {
		console.error('Usage: node addMultipleFungiblePrizes.js <poolId> <token> <amountsCommaSeparated>');
		process.exit(1);
	}
	const amounts = amountsStr.split(',').map(x => BigInt(x.trim()));
	const params = new ContractFunctionParameters()
		.addUint256(poolId)
		.addAddress(token)
		.addUint256Array(amounts);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'addMultipleFungiblePrizes', 200000);
	await tx.getReceipt(client);
	console.log('addMultipleFungiblePrizes executed successfully.');
})();
