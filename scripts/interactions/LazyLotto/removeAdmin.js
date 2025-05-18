// Remove an admin from LazyLotto
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
		console.log('Usage: removeAdmin.js <contractId> <adminAccountId>');
		return;
	}
	const contractId = ContractId.fromString(args[0]);
	const adminToRemove = AccountId.fromString(args[1]);

	// import ABI
	const abi = JSON.parse(fs.readFileSync(`./abi/${contractName}.json`));
	const iface = new ethers.Interface(abi);

	const proceed = readlineSync.keyInYNStrict(`Remove ${adminToRemove.toString()} as admin from contract ${contractId.toString()}?`);
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	const result = await contractExecuteFunction(
		contractId,
		iface,
		client,
		200_000,
		'removeAdmin',
		[adminToRemove.toSolidityAddress()]
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error removing admin:', result);
		return;
	}
	console.log('Admin removed successfully!');
	console.log('Transaction ID:', result[2]?.transactionId?.toString());
};

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
