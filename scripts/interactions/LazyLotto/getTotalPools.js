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
		console.log('Usage: getTotalPools.js 0.0.LTL');
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

	const totalPoolsCommand = ltlIface.encodeFunctionData('totalPools');
	const totalPoolsResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, totalPoolsCommand, operatorId, false
	);
	const totalPools = ltlIface.decodeFunctionResult('totalPools', totalPoolsResponse)[0];

	console.log('\n----- LazyLotto: totalPools -----');
	console.log('Total Pools:', Number(totalPools));
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
