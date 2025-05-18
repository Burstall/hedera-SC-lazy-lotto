require('dotenv').config();
const { getClient, getContractId, confirmAdminAction } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');
	await confirmAdminAction('addPrizePackage');

	// Args: poolId, token, amount, isNFT, nftToken, nftSerial
	const [poolId, token, amount, isNFT, nftToken, nftSerial] = process.argv.slice(2);
	if (!poolId || !token || !amount || typeof isNFT === 'undefined' || !nftToken || typeof nftSerial === 'undefined') {
		console.error('Usage: node addPrizePackage.js <poolId> <token> <amount> <isNFT> <nftToken> <nftSerial>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(poolId)
		.addAddress(token)
		.addUint256(amount)
		.addBool(isNFT === 'true' || isNFT === true)
		.addAddress(nftToken)
		.addUint256(nftSerial);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'addPrizePackage', 200000);
	await tx.getReceipt(client);
	console.log('addPrizePackage executed successfully.');
})();
