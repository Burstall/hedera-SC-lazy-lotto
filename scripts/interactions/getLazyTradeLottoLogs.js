const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { getEventsFromMirror } = require('../../utils/hederaMirrorHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
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
			'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: getLazyTradeLottoLogs.js 0.0.LTL');
		console.log('       LTL is the contract address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// import ABI
	const lotteryJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const ltlIface = new ethers.Interface(lotteryJSON.abi);

	// Call the function to fetch logs
	const logs = await getEventsFromMirror(env, contractId, ltlIface);

	const proceed = readlineSync.keyInYNStrict('Do you want to write logs to file?');
	if (!proceed) {
		if (logs) {
			for (const log of logs) {
				console.log(log);
			}
		}
		else { console.log('ERROR: No logs found'); }
		return;
	}

	// Write logs to a text file
	const now = new Date();
	const dateHour = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}`;
	const outputFile = `./logs/LazyTradeLotto-logs-${contractId}-${dateHour}.txt`;
	try {
		fs.writeFileSync(outputFile, logs.join('\n'));
	}
	catch (err) {
		console.error(err);
		console.log('Error writing logs to file - check smart-contracts/logs directory exists');
	}
	console.log(`Logs have been written to ${outputFile}`);
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});