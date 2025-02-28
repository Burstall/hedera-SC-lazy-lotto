const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { contractDeployFunction } = require('../../utils/solidityHelpers');

require('dotenv').config();

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
const lazyGasStationName = 'LazyGasStation';


const env = process.env.ENVIRONMENT ?? null;

let lazyTokenId;
let client;
let lazySCT;
let lazyGasStationId;

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

	console.log('\n-Using ENIVRONMENT:', env);

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
	// deploy the contract
	console.log('\n-Using Operator:', operatorId.toString());

	if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
		console.log(
			'\n-Using existing LAZY SCT:',
			process.env.LAZY_SCT_CONTRACT_ID,
		);
		lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);

		lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
		console.log('\n-Using existing LAZY Token ID:', lazyTokenId.toString());
	}
	else {
		console.log('LAZY_SCT_CONTRACT_ID ->', process.env.LAZY_SCT_CONTRACT_ID);
		console.log('LAZY_TOKEN_ID ->', process.env.LAZY_TOKEN_ID);
		console.log('Missing from .env file, please deploy the LAZY SCT contract first');
		return;
	}

	const lazyGasStationJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
		),
	);

	if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
		console.log(
			'\n-Using existing Lazy Gas Station:',
			process.env.LAZY_GAS_STATION_CONTRACT_ID,
		);
		lazyGasStationId = ContractId.fromString(
			process.env.LAZY_GAS_STATION_CONTRACT_ID,
		);
	}
	else {
		console.log('LAZY_GAS_STATION_CONTRACT_ID ->', process.env.LAZY_GAS_STATION_CONTRACT_ID);
		const proceed = readlineSync.keyInYNStrict('No Lazy Gas Station found, do you want to deploy it?');

		if (!proceed) {
			console.log('Aborting');
			return;
		}

		const gasLimit = 1_500_000;
		console.log(
			'\n- Deploying contract...',
			lazyGasStationName,
			'\n\tgas@',
			gasLimit,
		);

		const lazyGasStationBytecode = lazyGasStationJSON.bytecode;

		const lazyGasStationParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazySCT.toSolidityAddress());

		[lazyGasStationId] = await contractDeployFunction(
			client,
			lazyGasStationBytecode,
			gasLimit,
			lazyGasStationParams,
		);

		console.log(
			`Lazy Gas Station contract created with ID: ${lazyGasStationId} / ${lazyGasStationId.toSolidityAddress()}`,
		);
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
