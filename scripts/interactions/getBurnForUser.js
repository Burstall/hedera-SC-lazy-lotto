const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
}

const contractName = 'LazyTradeLotto';

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	// configure the client object
	if (
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: getBurnForUser.js 0.0.LTL 0.0.USER_ACCOUNT');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       USER_ACCOUNT is the Hedera account to check the burn rate for');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const userAccount = AccountId.fromString(args[1]);
	const userAddress = userAccount.toSolidityAddress();

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Checking burn rate for user:', userAccount.toString());
	console.log(' EVM address:', userAddress);

	// import ABI
	const ltlJSON = JSON.parse(
		fs.readFileSync(
			`./abi/${contractName}.json`,
		),
	);

	const ltlIface = new ethers.Interface(ltlJSON);

	// Query the LazyTradeLotto contract for the burn rate for the user
	const encodedCommand = ltlIface.encodeFunctionData('getBurnForUser', [userAddress]);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const burnRate = ltlIface.decodeFunctionResult(
		'getBurnForUser',
		result,
	);

	console.log('\n-Burn rate for user', userAccount.toString(), 'is:', Number(burnRate[0].toString()), '%');

	if (burnRate[0].toString() === '0') {
		console.log('\nThis user owns LSH NFTs so will experience no burn rate.');
	}
	else {
		console.log('\nThis user does not own or have any LSH tokens delegated to them.');
		console.log('To qualify for burn rewards, the user needs to:');
		console.log(' - Own LSH Gen1, LSH Gen2, or LSH Gen1 Mutant NFTs');
		console.log(' - OR have any of these tokens delegated to them through the LazyDelegateRegistry');
	}
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});