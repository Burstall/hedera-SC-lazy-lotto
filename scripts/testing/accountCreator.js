const { PrivateKey, AccountId, Client } = require('@hashgraph/sdk');
const { accountCreator } = require('../../utils/hederaHelpers');
require('dotenv').config();

const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

async function main() {
	// check arguments on command line if none supplied spit out usage
	// test or preview expected
	const env = process.argv[2];
	if (env == null) {
		console.log('Usage: node accountCreator.js <test|preview>');
		return;
	}

	let client;

	if (env.toLowerCase() == 'test') {
		client = Client.forTestnet();
	}
	else if (env.toLowerCase() == 'preview') {
		client = Client.forPreviewnet();
	}
	else {
		console.log('Usage: node accountCreator.js <test|preview>');
		return;
	}

	client.setOperator(operatorId, operatorKey);
	const bobPK = PrivateKey.generateED25519();
	const bobId = await accountCreator(client, bobPK, 25);
	console.log(
		'Bob account ID:',
		bobId.toString(),
		'\nkey:',
		bobPK.toString(),
	);
}

main();