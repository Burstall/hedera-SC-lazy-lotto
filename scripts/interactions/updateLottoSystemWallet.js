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
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');

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
	if (args.length !== 2 || getArgFlag('h')) {
		console.log('Usage: updateLottoSystemWallet.js 0.0.LTL 0.0.WALLET');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       WALLET is the Hedera account ID or EVM address of the new system wallet');
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
	let newWalletAddress;

	// Check if the wallet is an account ID or EVM address
	if (args[1].startsWith('0x')) {
		// EVM address provided
		newWalletAddress = args[1];
	}
	else {
		try {
			// Try to parse as Hedera account ID
			const newWalletAccount = AccountId.fromString(args[1]);
			newWalletAddress = newWalletAccount.toSolidityAddress();
		}
		catch (error) {
			console.log('ERROR: Invalid wallet address format. Please provide a valid Hedera account ID or EVM address.');
			return;
		}
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Get current system wallet
	const systemWalletCommand = ltlIface.encodeFunctionData('systemWallet');
	const systemWalletResponse = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		systemWalletCommand,
		operatorId,
		false,
	);
	const currentSystemWallet = ltlIface.decodeFunctionResult('systemWallet', systemWalletResponse)[0];

	console.log('\n-Current System Wallet: ', `${currentSystemWallet} (${AccountId.fromEvmAddress(0, 0, currentSystemWallet).toString()})`);
	console.log('\n-New System Wallet: ', `${newWalletAddress} (${args[1]})`);

	const proceed = readlineSync.keyInYNStrict('Do you want to update the system wallet?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	const warningMessage = 'WARNING: This will change the system wallet used to sign lotto transactions!\n' +
		'Make sure you have the private key for this new wallet address, otherwise you won\'t be able to sign any lotto rolls!';
	console.log(`\n${warningMessage}`);

	const confirmProceed = readlineSync.keyInYNStrict('Are you sure you want to proceed?');
	if (!confirmProceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Update system wallet
	const result = await contractExecuteFunction(
		contractId,
		ltlIface,
		client,
		300_000,
		'updateSystemWallet',
		[newWalletAddress],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error updating system wallet:', result);
		return;
	}

	console.log('\nSystem wallet updated successfully!');
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