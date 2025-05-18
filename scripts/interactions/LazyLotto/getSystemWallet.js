const { AccountId, ContractId } = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');

let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
} catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'LazyTradeLotto';
const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	if (operatorId === undefined || operatorId == null) {
		console.log('Environment required, please specify ACCOUNT_ID in the .env file');
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length === 0 || getArgFlag('h')) {
		console.log('Usage: getSystemWallet.js 0.0.LTL');
		console.log('       LTL is the LazyTradeLotto contract address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	const ltlJSON = JSON.parse(
		fs.readFileSync('./abi/' + contractName + '.json')
	);
	const ltlIface = new ethers.Interface(ltlJSON);

	const systemWalletCommand = ltlIface.encodeFunctionData('systemWallet');
	const systemWalletResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, systemWalletCommand, operatorId, false
	);
	const systemWallet = ltlIface.decodeFunctionResult('systemWallet', systemWalletResponse)[0];

	console.log('\n----- LazyLotto: systemWallet -----');
	console.log('System Wallet:', systemWallet);
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
