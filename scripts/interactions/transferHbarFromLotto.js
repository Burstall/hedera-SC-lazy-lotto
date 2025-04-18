const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { checkMirrorHbarBalance } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
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
	if (args.length !== 3 || getArgFlag('h')) {
		console.log('Usage: transferHbarFromLotto.js 0.0.LTL <receiver> <amount>');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       <receiver> is the Hedera account ID to receive the HBAR');
		console.log('       <amount> is the amount of HBAR to transfer');
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
	const receiverAccount = AccountId.fromString(args[1]);
	let amount;

	try {
		amount = Number(args[2]);
		if (isNaN(amount) || amount <= 0) {
			throw new Error('Invalid amount');
		}
	}
	catch (error) {
		console.log('ERROR: Amount must be a positive number');
		return;
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Receiver:', receiverAccount.toString());
	console.log('\n-Amount to transfer:', amount, 'HBAR');

	// Get contract balance
	const contractBalance = await checkMirrorHbarBalance(env, contractId);

	if (!contractBalance) {
		console.log('ERROR: Could not retrieve contract balance. Exiting.');
		return;
	}

	const contractBalanceInHbar = contractBalance / 100_000_000;
	console.log('\n-Current Contract HBAR Balance:', contractBalanceInHbar, 'HBAR');

	if (contractBalanceInHbar < amount) {
		console.log(`ERROR: Contract only has ${contractBalanceInHbar} HBAR, cannot transfer ${amount} HBAR`);
		return;
	}

	const proceed = readlineSync.keyInYNStrict(`Are you sure you want to transfer ${amount} HBAR from the contract to ${receiverAccount.toString()}?`);
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Additional confirmation for safety
	const confirmProceed = readlineSync.keyInYNStrict('This operation will transfer funds from the contract. Are you absolutely sure?');
	if (!confirmProceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Convert amount to tinybars
	const amountInTinybars = new Hbar(amount, HbarUnit.Hbar).toTinybars().toNumber();

	// Transfer HBAR
	const result = await contractExecuteFunction(
		contractId,
		ltlIface,
		client,
		400_000,
		'transferHbar',
		[receiverAccount.toSolidityAddress(), amountInTinybars],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error transferring HBAR:', result);
		return;
	}

	console.log('\nHBAR transferred successfully!');
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