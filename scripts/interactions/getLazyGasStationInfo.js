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

const contractName = 'LazyGasStation';

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
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: getLazyGasStationInfo.js 0.0.LGS');
		console.log('       LGS is the LazyGasStation address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// import ABI
	const lgsJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const lgsIface = new ethers.Interface(lgsJSON.abi);

	// query the EVM via mirror node (readOnlyEVMFromMirrorNode) to know
	// 1) getAdmins

	let encodedCommand = lgsIface.encodeFunctionData('getAdmins', []);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const admins = lgsIface.decodeFunctionResult(
		'getAdmins',
		result,
	);

	console.log('Admins:', admins[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	// 2) getAuthorizers

	encodedCommand = lgsIface.encodeFunctionData('getAuthorizers', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const authorizers = lgsIface.decodeFunctionResult(
		'getAuthorizers',
		result,
	);

	console.log('Authorizers:', authorizers[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	// 3) getContractUsers

	encodedCommand = lgsIface.encodeFunctionData('getContractUsers', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const contractUsers = lgsIface.decodeFunctionResult(
		'getContractUsers',
		result,
	);

	console.log('Contract Users:', contractUsers[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
