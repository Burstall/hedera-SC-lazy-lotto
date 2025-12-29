/**
 * LazyTradeLotto - Transfer HBAR from Contract (Admin)
 *
 * Withdraws HBAR from the LazyTradeLotto contract to a specified receiver.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/transferHbarFromLotto.js 0.0.LTL <receiver> <amount>
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/transferHbarFromLotto.js 0.0.LTL <receiver> <amount> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/transferHbarFromLotto.js --multisig-help
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
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const { checkMirrorHbarBalance } = require('../../../../utils/hederaMirrorHelpers');
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
	if (args.length !== 3 || getArgFlag('h')) {
		console.log('Usage: transferHbarFromLotto.js 0.0.LTL <receiver> <amount>');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       <receiver> is the Hedera account ID to receive the HBAR');
		console.log('       <amount> is the amount of HBAR to transfer');
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
	const receiverAccount = AccountId.fromString(args[1]);
	let amount;

	try {
		amount = Number(args[2]);
		if (isNaN(amount) || amount <= 0) {
			throw new Error('Invalid amount');
		}
	}
	catch {
		console.log('ERROR: Amount must be a positive number');
		return;
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

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

	// Transfer HBAR using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'transferHbar',
		params: [receiverAccount.toSolidityAddress(), amountInTinybars],
		gas: 400_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error transferring HBAR:', result.error);
		return;
	}

	console.log('\nHBAR transferred successfully!');
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
