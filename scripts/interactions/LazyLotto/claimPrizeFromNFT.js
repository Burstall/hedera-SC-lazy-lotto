require('dotenv').config();
const { getClient, getContractId } = require('../utils/cliHelpers');
const { ContractFunctionParameters } = require('@hashgraph/sdk');

(async () => {
	const client = await getClient();
	const contractId = await getContractId('LazyLotto');

	// Args: poolId, nftToken, nftSerial
	const [poolId, nftToken, nftSerial] = process.argv.slice(2);
	if (!poolId || !nftToken || !nftSerial) {
		console.error('Usage: node claimPrizeFromNFT.js <poolId> <nftToken> <nftSerial>');
		process.exit(1);
	}

	const params = new ContractFunctionParameters()
		.addUint256(poolId)
		.addAddress(nftToken)
		.addUint256(nftSerial);

	const { contractExecuteFunction } = require('../../utils/solidityHelpers');
	const tx = await contractExecuteFunction(client, contractId, params, 0, 'claimPrizeFromNFT', 200000);
	await tx.getReceipt(client);
	console.log('claimPrizeFromNFT executed successfully.');
})();
