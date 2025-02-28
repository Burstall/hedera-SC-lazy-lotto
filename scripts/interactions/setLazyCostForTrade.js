const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');

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

const contractName = 'LazySecureTrade';
const LAZY_TOKEN_ID = process.env.LAZY_TOKEN_ID;

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

	if (!LAZY_TOKEN_ID) {
		console.log('ERROR: Must specify LAZY_TOKEN_ID in the .env file');
		process.exit(1);
	}

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('testing in *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('testing in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('testing in *LOCAL*');
	}
	else {
		console.log(
			'ERROR: Must specify either MAIN or TEST or LOCAL as environment in .env file',
		);
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: setLazyCostForTrade.js 0.0.LST <cost>');
		console.log('		LST is the Lazy Secure Trade Contract address');
		console.log('		<cost> in $LAZY');
		return;
	}

	// import ABI
	const lstJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const lstIface = new ethers.Interface(lstJSON.abi);

	const contractId = ContractId.fromString(args[0]);
	const lazy = Number(args[1]);
	const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);

	// get the $LAZY decimal from mirror node
	const lazyTokenDetails = await getTokenDetails(env, lazyToken);
	const lazyTokenDecimals = lazyTokenDetails.decimals;

	if (lazyTokenDecimals == null || lazyTokenDecimals == undefined) {
		console.log('ERROR: Unable to get $LAZY decimals');
		return;
	}

	// get the current contractSunset from the mirror nodes
	const encodedCommand = lstIface.encodeFunctionData(
		'lazyCostForTrade',
		[],
	);

	const cS = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const currentLazyCost = Number(lstIface.decodeFunctionResult('lazyCostForTrade', cS)[0]);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Using $LAZY:', lazy);
	console.log('\n-Current cost:', currentLazyCost / 10 ** lazyTokenDecimals, '$LAZY');
	console.log('\n-New value (allowing for decimal):', Math.floor(lazy * 10 ** lazyTokenDecimals));


	const proceed = readlineSync.keyInYNStrict('Do you want to update the cost?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const result = await contractExecuteFunction(
		contractId,
		lstIface,
		client,
		300_000,
		'setLazyCostForTrade',
		[Math.floor(lazy * 10 ** lazyTokenDecimals)],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error updating:', result);
		return;
	}

	console.log('$LAZY cost updated. Transaction ID:', result[2]?.transactionId?.toString());
};


main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
