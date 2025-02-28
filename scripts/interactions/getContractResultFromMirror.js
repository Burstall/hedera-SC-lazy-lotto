require('dotenv').config();
const { getArgFlag } = require('../../utils/nodeHelpers');
const { translateTransactionForWebCall, getContractResult } = require('../../utils/hederaMirrorHelpers');
const fs = require('fs');
const { ethers } = require('ethers');

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {

	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: getContractResultFromMirror.js <contract name> <txId>');
		console.log('       contract name is the contract name');
		console.log('       txId is the transaction hash');
		console.log('       Example: getTransactionReceipt.js MissionFactory 0.0.3566849@1708780635.278906242');
		return;
	}

	const contractName = args[0];
	const txId = args[1];
	const txIdParsed = translateTransactionForWebCall(txId);

	// import ABI
	const contractJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const contractIface = new ethers.Interface(contractJSON.abi);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Checking Transaction:', txId);
	console.log('\n-Parsed Transaction:', txIdParsed);
	console.log('\n-Using Contract Name:', contractName);

	const result = await getContractResult(env, txIdParsed, contractIface);

	console.log('\n-Transaction Receipt:', result);
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
