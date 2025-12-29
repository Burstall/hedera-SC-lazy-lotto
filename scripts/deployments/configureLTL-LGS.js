/**
 * Configure LazyTradeLotto with LazyGasStation
 *
 * Adds LazyTradeLotto as a contract user of LazyGasStation.
 * Only the LazyGasStation owner/admin can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/deployments/configureLTL-LGS.js
 *   Multi-sig:  node scripts/deployments/configureLTL-LGS.js --multisig
 *   Help:       node scripts/deployments/configureLTL-LGS.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../utils/scriptHelpers');
require('dotenv').config();

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

const lazyGasStationName = 'LazyGasStation';

const env = process.env.ENVIRONMENT ?? null;

let ltlContractId;
let client;
let lazyGasStationId;
let lazyGasStationIface;

try {
	ltlContractId = ContractId.fromString(process.env.LAZY_TRADE_LOTTO_CONTRACT_ID);
	lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
}
catch {
	console.log('ERROR: Must specify LAZY_TRADE_LOTTO_CONTRACT_ID and LAZY_GAS_STATION_CONTRACT_ID in the .env file');
}

const main = async () => {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

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

	// Normalize environment name
	const envUpper = env.toUpperCase();

	if (envUpper === 'TEST' || envUpper === 'TESTNET') {
		client = Client.forTestnet();
		console.log('Using *TESTNET*');
	}
	else if (envUpper === 'MAIN' || envUpper === 'MAINNET') {
		client = Client.forMainnet();
		console.log('Using *MAINNET*');
	}
	else if (envUpper === 'PREVIEW' || envUpper === 'PREVIEWNET') {
		client = Client.forPreviewnet();
		console.log('Using *PREVIEWNET*');
	}
	else if (envUpper === 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('Using *LOCAL*');
	}
	else {
		console.log(
			'ERROR: Must specify either MAIN/MAINNET, TEST/TESTNET, PREVIEW/PREVIEWNET, or LOCAL as environment in .env file',
		);
		return;
	}

	client.setOperator(operatorId, operatorKey);

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Lazy Trade Lotto Contract:', ltlContractId.toString());
	console.log('-Using Lazy Gas Station Contract:', lazyGasStationId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	const lazyGasStationJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
		),
	);

	lazyGasStationIface = new ethers.Interface(lazyGasStationJSON.abi);

	const proceed = readlineSync.keyInYNStrict('Do you want to update the Gas Station for this Lazy Trade Lotto Contract?');

	if (!proceed) {
		console.log('Exiting...');
		return;
	}

	// Add the Lazy Trade Lotto to the lazy gas station as a contract user
	const result = await executeContractFunction({
		contractId: lazyGasStationId,
		iface: lazyGasStationIface,
		client,
		functionName: 'addContractUser',
		params: [ltlContractId.toSolidityAddress()],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('ERROR adding LTL to LGS:', result.error);
		return;
	}

	console.log('Lazy Trade Lotto Contract added to Lazy Gas Station!');
	const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
	console.log('Transaction ID:', txId);
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
