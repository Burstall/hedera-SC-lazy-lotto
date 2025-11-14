const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'LazyTradeLotto';

const env = process.env.ENVIRONMENT ?? null;
let client;

const main = async () => {
	// configure the client object
	if (
		operatorKey === undefined ||
		operatorKey == null ||
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	console.log('\n-Using ENVIRONMENT:', env);

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('Using *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('Using *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('Using *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('Using *LOCAL*');
	}
	else {
		console.log(
			'ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file',
		);
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length !== 2 || getArgFlag('h')) {
		console.log('Usage: updateLottoBurnPercentage.js 0.0.LTL <percentage>');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       <percentage> is the new burn percentage (integer from 0-100)');
		return;
	}

	// import ABI
	const ltlJSON = JSON.parse(
		fs.readFileSync(
			`./abi/${contractName}.json`,
		),
	);

	const ltlIface = new ethers.Interface(ltlJSON);

	const contractId = ContractId.fromString(args[0]);
	const newBurnPercentage = Number(args[1]);

	// Validate percentage
	if (isNaN(newBurnPercentage) || newBurnPercentage < 0 || newBurnPercentage > 100) {
		console.log('ERROR: Burn percentage must be an integer between 0 and 100');
		return;
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-New Burn Percentage:', newBurnPercentage, '%');

	// Get current burn percentage
	const burnPercentageCommand = ltlIface.encodeFunctionData('burnPercentage');
	const burnPercentageResponse = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		burnPercentageCommand,
		operatorId,
		false,
	);
	const currentBurnPercentage = Number(ltlIface.decodeFunctionResult('burnPercentage', burnPercentageResponse)[0]);

	console.log('\n-Current Burn Percentage:', currentBurnPercentage, '%');

	const proceed = readlineSync.keyInYNStrict('Do you want to update the burn percentage?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Update burn percentage
	const result = await contractExecuteFunction(
		contractId,
		ltlIface,
		client,
		300_000,
		'updateBurnPercentage',
		[newBurnPercentage],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error updating burn percentage:', result);
		return;
	}

	console.log('\nBurn percentage updated successfully!');
	console.log('Transaction ID:', result[2]?.transactionId?.toString());
};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});