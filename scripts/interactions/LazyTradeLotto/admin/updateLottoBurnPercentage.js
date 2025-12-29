/**
 * LazyTradeLotto - Update Burn Percentage (Admin)
 *
 * Updates the burn percentage applied to non-NFT holders' winnings.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/updateLottoBurnPercentage.js 0.0.LTL <percentage>
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/updateLottoBurnPercentage.js 0.0.LTL <percentage> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/updateLottoBurnPercentage.js --multisig-help
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
	if (args.length !== 2 || getArgFlag('h')) {
		console.log('Usage: updateLottoBurnPercentage.js 0.0.LTL <percentage>');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       <percentage> is the new burn percentage (integer from 0-100)');
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
	const newBurnPercentage = Number(args[1]);

	// Validate percentage
	if (isNaN(newBurnPercentage) || newBurnPercentage < 0 || newBurnPercentage > 100) {
		console.log('ERROR: Burn percentage must be an integer between 0 and 100');
		return;
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	console.log('\n-New Burn Percentage:', newBurnPercentage, '%');

	// Get current burn percentage using mirror node
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

	// Update burn percentage using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'updateBurnPercentage',
		params: [newBurnPercentage],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error updating burn percentage:', result.error);
		return;
	}

	console.log('\nBurn percentage updated successfully!');
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
