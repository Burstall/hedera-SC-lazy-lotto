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
	if (args.length < 3 || getArgFlag('h')) {
		console.log('Usage: getUserEntries.js 0.0.LTL POOL_ID USER_ADDRESS');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       POOL_ID is the pool index (uint256)');
		console.log('       USER_ADDRESS is the user EVM address (0x...)');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const poolId = args[1];
	const userAddress = args[2];
	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Querying Pool ID:', poolId);
	console.log('-User Address:', userAddress);

	const ltlJSON = JSON.parse(
		fs.readFileSync('./abi/' + contractName + '.json')
	);
	const ltlIface = new ethers.Interface(ltlJSON);

	const userEntriesCommand = ltlIface.encodeFunctionData('getUserEntries', [poolId, userAddress]);
	const userEntriesResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, userEntriesCommand, operatorId, false
	);
	const userEntries = ltlIface.decodeFunctionResult('getUserEntries', userEntriesResponse);

	console.log('\n----- LazyLotto: getUserEntries -----');
	console.log('User Entries:', userEntries);
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
