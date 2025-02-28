const {
	Client,
	AccountId,
	PrivateKey,
} = require('@hashgraph/sdk');
require('dotenv').config();
const { getArgFlag } = require('../../utils/nodeHelpers');
const readlineSync = require('readline-sync');
const { mintNFT } = require('../../utils/hederaHelpers');

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
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: createTestNFT.js "Token Name" "Token Symbol" <quantity>');
		console.log('Example: createTestNFT.js "Test NFT" "TST" 10');
		return;
	}

	const nftName = args[0];
	const nftSymbol = args[1];
	const quantity = parseInt(args[2]);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using NFT Name:', nftName);
	console.log('\n-Using NFT Symbol:', nftSymbol);
	console.log('\n-Using Quantity:', quantity);

	// ask user if they want to skip royalties
	const includeFee = readlineSync.keyInYNStrict('Do you want to add royalties?');
	// if yes, check if user wants a fallback fee
	const includeFallback = includeFee ? readlineSync.keyInYNStrict('Do you want to add a fallback fee?') : false;

	const proceed = readlineSync.keyInYNStrict('Do you want to proceed?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const [result, tokenId] = await mintNFT(
		client,
		operatorId,
		nftName,
		nftSymbol,
		quantity,
		50,
		null,
		null,
		!includeFallback,
		!includeFee,
	);

	console.log('Result:', result);
	console.log('Token ID:', tokenId.toString());

};


main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
