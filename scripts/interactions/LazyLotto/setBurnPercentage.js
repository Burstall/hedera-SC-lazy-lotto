// Set burn percentage for LazyLotto
const { Client, AccountId, PrivateKey, ContractId } = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');

const contractName = 'LazyLotto';
let operatorKey, operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
} catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	if (!operatorKey || !operatorId) {
		console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
		process.exit(1);
	}
	if (!env) {
		console.log('ERROR: Must specify ENVIRONMENT in .env file');
		process.exit(1);
	}
	if (env.toUpperCase() == 'TEST') client = Client.forTestnet();
	else if (env.toUpperCase() == 'MAIN') client = Client.forMainnet();
	else if (env.toUpperCase() == 'PREVIEW') client = Client.forPreviewnet();
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
	} else {
		console.log('ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file');
		return;
	}
	client.setOperator(operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length !== 2 || getArgFlag('h')) {
		console.log('Usage: setBurnPercentage.js <contractId> <percentage>');
		return;
	}
	const contractId = ContractId.fromString(args[0]);
	const percentage = Number(args[1]);
	if (isNaN(percentage) || percentage < 0 || percentage > 100) {
		console.log('ERROR: Burn percentage must be an integer between 0 and 100');
		return;
	}

	// import ABI
	const abi = JSON.parse(fs.readFileSync(`./abi/${contractName}.json`));
	const iface = new ethers.Interface(abi);

	const proceed = readlineSync.keyInYNStrict(`Set burn percentage to ${percentage}% for contract ${contractId.toString()}?`);
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	const result = await contractExecuteFunction(
		contractId,
		iface,
		client,
		200_000,
		'setBurnPercentage',
		[percentage]
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error setting burn percentage:', result);
		return;
	}
	console.log('Burn percentage set successfully!');
	console.log('Transaction ID:', result[2]?.transactionId?.toString());
};

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
