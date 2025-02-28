const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	HbarUnit,
	Hbar,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag, isBytes32 } = require('../../utils/nodeHelpers');
const { checkMirrorBalance, checkMirrorAllowance, checkHbarAllowances, checkMirrorHbarBalance, getTokenDetails } = require('../../utils/hederaMirrorHelpers');
const { setFTAllowance, setHbarAllowance, associateTokenToAccount } = require('../../utils/hederaHelpers');

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
const LAZY_GAS_STATION_CONTRACT_ID = process.env.LAZY_GAS_STATION_CONTRACT_ID;

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

	if (!LAZY_GAS_STATION_CONTRACT_ID) {
		console.log('ERROR: Must specify LAZY_GAS_STATION_CONTRACT_ID in the .env file');
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
		console.log('Usage: executeTrade.js 0.0.LST [-i | <hash>');
		console.log('		LST is the Lazy Secure Trade Contract address');
		console.log('		-i to interactively to enter token/serial to obtain hash');
		console.log('		<hash> is the hash of the trade (token/serial)');
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
	const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// get the $LAZY decimal from mirror node
	const lazyTokenDetails = await getTokenDetails(env, lazyToken);
	const lazyTokenDecimals = lazyTokenDetails.decimals;

	if (lazyTokenDecimals == null || lazyTokenDecimals == undefined) {
		console.log('ERROR: Unable to get $LAZY decimals');
		return;
	}

	let hash, token, serial;

	if (getArgFlag('i')) {
		// interactively get the token and serial


		// ask the user for the token to sell
		const tokenToCancel = readlineSync.question('Enter the token to cancel: ');
		const serialToCancel = readlineSync.question('Enter the serial number: ');

		token = TokenId.fromString(tokenToCancel);
		serial = parseInt(serialToCancel);

		console.log('\n-Using Token:', token.toString());
		console.log('\n-Using Serial:', serial);

		console.log('\n\t...fetching trade details for token:', token.toString(), 'serial:', serial);

		hash = ethers.solidityPackedKeccak256(['address', 'uint256'], [token.toSolidityAddress(), serial]);
	}
	else {
		hash = args[1];

		if (!isBytes32(hash)) {
			throw new Error('Invalid hash: must be a bytes32 string');
		}
	}

	console.log('\n-Using Hash:', hash);

	let encodedCommand = lstIface.encodeFunctionData(
		'getTrade',
		[hash],
	);

	let execResults = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const tradeDets = lstIface.decodeFunctionResult('getTrade', execResults)[0];

	// check if the trade exists [seller <> ZeroAddress]
	if (tradeDets[0] == ethers.ZeroAddress) {
		console.log('Trade does not exist - exiting');
		return;
	}

	console.log('\n-Trade Details:', tradeDets);

	// check if user is buyer or buyer == ZeroAddress
	// ensure operator is not the seller
	const isSeller = tradeDets[0].slice(2).toLowerCase() == operatorId.toSolidityAddress();
	const isBuyer = tradeDets[1].slice(2).toLowerCase() == operatorId.toSolidityAddress();
	const isZeroBuyer = tradeDets[1] == ethers.ZeroAddress;

	if (isSeller) {
		console.log('ERROR: Operator is seller and can not execute own trade - exiting');
		return;
	}

	if (!isBuyer && !isZeroBuyer) {
		console.log('ERROR: Operator is not the designated buyer or buyer is not set to *ANY* - unable to execute - exiting');
		return;
	}

	console.log('\n-Seller:', AccountId.fromEvmAddress(0, 0, tradeDets[0]).toString());
	console.log('\n-Buyer:', tradeDets[1] == ethers.ZeroAddress ? 'Anyone' : AccountId.fromEvmAddress(0, 0, tradeDets[1]).toString());
	console.log('\n-Trade token:', TokenId.fromSolidityAddress(tradeDets[2]).toString(), 'Serial:', Number(tradeDets[3]));

	// get the cost of the trade
	const hbarCost = new Hbar(Number(tradeDets[4]), HbarUnit.Tinybar);
	const lazyCost = Number(tradeDets[5]);

	console.log('\n-Trade Costs:', hbarCost.toString(), lazyCost / 10 ** lazyTokenDecimals, '$LAZY');

	const expiry = Number(tradeDets[6]);
	const expires = expiry == 0 ? 'Never' : new Date(expiry * 1000).toLocaleString();

	console.log('\n-Expiry Time:', expires);

	// check if the trade is valid for the user
	encodedCommand = lstIface.encodeFunctionData(
		'isTradeValid',
		[hash, operatorId.toSolidityAddress()],
	);

	execResults = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const isValid = lstIface.decodeFunctionResult('isTradeValid', execResults);

	if (!isValid[0]) {
		console.log('ERROR: Trade is not valid for operator - unable to execute - exiting');
		return;
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to execute the trade?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	// if lazy cost is not zero, check if the user has enough $LAZY and set allowances to LGS if needed
	if (lazyCost > 0) {
		// check if the user has enough $LAZY
		const userLazyBalance = await checkMirrorBalance(env, operatorId, lazyToken);

		if (!userLazyBalance) {
			console.log('ERROR: Operator does not have any $LAZY - exiting');
			return;
		}

		if (userLazyBalance < lazyCost) {
			console.log('ERROR: Operator does not have enough $LAZY to execute the trade - exiting');
			return;
		}

		// check the $LAZY allowance to LGS
		const userLazyAllowance = await checkMirrorAllowance(
			env,
			operatorId,
			lazyToken,
			LAZY_GAS_STATION_CONTRACT_ID,
		);

		if (userLazyAllowance < lazyCost) {
			// request the user to set the allowance
			const setLazyAllowance = readlineSync.keyInYNStrict('Do you want to set the allowance for Lazy Gas Station (required)?');
			if (!setLazyAllowance) {
				console.log('User Aborted');
				return;
			}

			const lazyApproval = await setFTAllowance(
				client,
				lazyToken,
				operatorId,
				AccountId.fromString(LAZY_GAS_STATION_CONTRACT_ID),
				lazyCost,
			);

			console.log('\n-Setting $LAZY Allowance:', lazyApproval);
		}
	}

	// check if the user has enough hbar to execute the trade
	const userHbarBalance = await checkMirrorHbarBalance(env, operatorId);

	if (!userHbarBalance) {
		console.log('ERROR: Operator does not have any hbar - exiting');
		return;
	}

	// ensure payment is avaible for the trade + 5 hbar buffer for execution(s)
	if (userHbarBalance < (Number(hbarCost.toTinybars()) + Number(new Hbar(5).toTinybars()))) {
		console.log('ERROR: Operator does not have enough hbar to execute the trade - exiting');
		return;
	}

	// check if the token to buy is associated to the buyer
	const tokensToPurchaseAlreadyOwned = await checkMirrorBalance(env, operatorId, TokenId.fromSolidityAddress(tradeDets[2]));

	if (tokensToPurchaseAlreadyOwned == null || tokensToPurchaseAlreadyOwned == undefined) {
		// ask user to associate the token
		const associateToken = readlineSync.keyInYNStrict('Token to be purchased not associated - Do you want to associate the token?');
		if (!associateToken) {
			console.log('User Aborted');
			return;
		}

		const associationResult = await associateTokenToAccount(
			client,
			operatorId,
			operatorKey,
			TokenId.fromSolidityAddress(tradeDets[2]),
		);

		console.log('\n-Associating Token:', associationResult);
	}

	// set 1 tinybar allowance to LST contract
	const hbarCurrentAllowance = await checkHbarAllowances(
		env,
		operatorId,
	);

	// iterate to find the LST contract allowance
	let lstAllowance = 0;
	for (let i = 0; i < hbarCurrentAllowance.length; i++) {
		if (hbarCurrentAllowance[i].spender == contractId.toString()) {
			lstAllowance = hbarCurrentAllowance[i].amount;
			break;
		}
	}

	if (lstAllowance < 1) {
		// need to set the allowance
		const configureHbarAllowance = readlineSync.keyInYNStrict('Do you want to set the 1 tinybar allowance for the contract (required)?');
		if (!configureHbarAllowance) {
			console.log('User Aborted');
			return;
		}

		const hbarApproval = await setHbarAllowance(
			client,
			operatorId,
			AccountId.fromString(contractId.toString()),
			1,
			HbarUnit.Tinybar,
		);

		console.log('\n-Setting 1 tinybar Allowance:', hbarApproval);
	}

	const gas = lazyCost > 0 ? 650_000 : 400_000;

	const result = await contractExecuteFunction(
		contractId,
		lstIface,
		client,
		gas,
		'executeTrade',
		[
			hash,
		],
		hbarCost,
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error executing trade:', result);
		return;
	}

	console.log('Trade Executed. Transaction ID:', result[2]?.transactionId?.toString());
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
