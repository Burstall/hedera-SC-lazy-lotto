/**
 * LazyTradeLotto - Update System Wallet (Admin)
 *
 * Updates the system wallet address used to sign lotto roll transactions.
 * Only the contract owner can perform this operation.
 *
 * WARNING: This is a critical operation! Make sure you have the private key
 * for the new wallet address, otherwise you won't be able to sign any lotto rolls!
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js 0.0.LTL 0.0.WALLET
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js 0.0.LTL 0.0.WALLET --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js --multisig-help
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
		console.log('Usage: updateLottoSystemWallet.js 0.0.LTL 0.0.WALLET');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       WALLET is the Hedera account ID or EVM address of the new system wallet');
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
		catch {
			console.log('ERROR: Invalid wallet address format. Please provide a valid Hedera account ID or EVM address.');
			return;
		}
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

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

	// Update system wallet using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'updateSystemWallet',
		params: [newWalletAddress],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error updating system wallet:', result.error);
		return;
	}

	console.log('\nSystem wallet updated successfully!');
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
