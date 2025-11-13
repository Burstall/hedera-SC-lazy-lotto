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
const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
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
	if (args.length !== 1 || getArgFlag('h')) {
		console.log('Usage: unpauseLottoContract.js 0.0.LTL');
		console.log('       LTL is the LazyTradeLotto contract address');
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

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// First check if the contract is already unpaused
	try {
		const pauseStatusResult = await contractExecuteFunction(
			contractId,
			ltlIface,
			client,
			100_000,
			'isPaused',
			[],
		);

		const isPaused = pauseStatusResult[2]?.contractFunctionResult?.getBool(0);
		if (!isPaused) {
			console.log('\nThe contract is already active (not paused). No action needed.');
			return;
		}
	}
	catch (error) {
		console.log('Error checking pause status:', error.message);
		// Continue with unpause operation anyway
	}

	const proceed = readlineSync.keyInYNStrict('Are you sure you want to unpause the LazyTradeLotto contract?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Additional confirmation for safety
	const confirmProceed = readlineSync.keyInYNStrict('This will allow users to start rolling the lotto again. Are you absolutely sure?');
	if (!confirmProceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Unpause the contract
	const result = await contractExecuteFunction(
		contractId,
		ltlIface,
		client,
		400_000,
		'unpause',
		[],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error unpausing the contract:', result);
		return;
	}

	console.log('\nContract unpaused successfully!');
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