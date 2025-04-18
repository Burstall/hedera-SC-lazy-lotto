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

const contractName = 'LazyTradeLotto';
const LAZY_TOKEN_ID = process.env.LAZY_TOKEN_ID;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;

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
		console.log('Usage: boostLottoJackpot.js 0.0.LTL <amount>');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       <amount> is the amount to boost the jackpot by (in $LAZY)');
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
	const boostAmount = Number(args[1]);

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Boost Amount:', boostAmount, '$LAZY');

	// Get the lazy token decimal from mirror node
	let lazyTokenDecimals = LAZY_DECIMAL;
	if (LAZY_TOKEN_ID) {
		const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);
		const lazyTokenDetails = await getTokenDetails(env, lazyToken);
		if (lazyTokenDetails && lazyTokenDetails.decimals !== undefined) {
			lazyTokenDecimals = lazyTokenDetails.decimals;
		}
	}

	// Get current jackpot stats
	const lottoStatsCommand = ltlIface.encodeFunctionData('getLottoStats');
	const lottoStatsResponse = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		lottoStatsCommand,
		operatorId,
		false,
	);
	const lottoStats = ltlIface.decodeFunctionResult('getLottoStats', lottoStatsResponse);
	const currentJackpot = Number(lottoStats[0]) / (10 ** lazyTokenDecimals);

	console.log('\n-Current Jackpot Pool:', currentJackpot, '$LAZY');
	console.log('\n-New Jackpot Pool will be:', currentJackpot + boostAmount, '$LAZY');

	// Calculate the boost amount with decimals
	const boostAmountWithDecimals = Math.floor(boostAmount * (10 ** lazyTokenDecimals));

	const proceed = readlineSync.keyInYNStrict('Do you want to boost the jackpot?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Boost jackpot
	const result = await contractExecuteFunction(
		contractId,
		ltlIface,
		client,
		300_000,
		'boostJackpot',
		[boostAmountWithDecimals],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error boosting jackpot:', result);
		return;
	}

	console.log('\nJackpot boosted successfully!');
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