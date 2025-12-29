/**
 * LazyTradeLotto - Pause Contract (Admin)
 *
 * Pauses the LazyTradeLotto contract to prevent any new lotto rolls.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/pauseLottoContract.js 0.0.LTL
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/pauseLottoContract.js 0.0.LTL --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/pauseLottoContract.js --multisig-help
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
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

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

	const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
	if (args.length !== 1 || getArgFlag('h')) {
		console.log('Usage: pauseLottoContract.js 0.0.LTL');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('\nMulti-sig: Add --multisig flag for multi-signature mode');
		console.log('           Use --multisig-help for multi-sig options');
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

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	// First check if the contract is already paused using mirror node
	try {
		const isPausedCommand = ltlIface.encodeFunctionData('isPaused');
		const isPausedResponse = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			isPausedCommand,
			operatorId,
			false,
		);
		const isPaused = ltlIface.decodeFunctionResult('isPaused', isPausedResponse)[0];

		if (isPaused) {
			console.log('\nThe contract is already paused. No action needed.');
			return;
		}
	}
	catch (error) {
		console.log('Warning: Could not check pause status via mirror node:', error.message);
		// Continue with pause operation anyway
	}

	const proceed = readlineSync.keyInYNStrict('Are you sure you want to pause the LazyTradeLotto contract?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Additional confirmation for safety
	const confirmProceed = readlineSync.keyInYNStrict('This will prevent users from rolling the lotto. Are you absolutely sure?');
	if (!confirmProceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Pause the contract using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'pause',
		params: [],
		gas: 400_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error pausing the contract:', result.error);
		return;
	}

	console.log('\nContract paused successfully!');
	const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
	console.log('Transaction ID:', txId);
};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
