require('dotenv').config();
const { getClient, getContractId } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');

	// Args: poolId, entryId, nftToken, nftSerial
	const [poolId, entryId, nftToken, nftSerial] = process.argv.slice(2);
	if (!poolId || !entryId || !nftToken || !nftSerial) {
		console.error('Usage: node redeemPrizeToNFT.js <poolId> <entryId> <nftToken> <nftSerial>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(poolId)
		.addUint256(entryId)
		.addAddress(nftToken)
		.addUint256(nftSerial);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'redeemPrizeToNFT', 200000);
	await tx.getReceipt(client);
	console.log('redeemPrizeToNFT executed successfully.');
})();
