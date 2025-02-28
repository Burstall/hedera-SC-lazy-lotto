const { AccountAllowanceApproveTransaction, AccountId, TokenId, PrivateKey, Client } = require('@hashgraph/sdk');
const axios = require('axios');
const readlineSync = require('readline-sync');
const { checkHbarAllowances } = require('../../utils/hederaMirrorHelpers');
require('dotenv').config();

const env = process.env.ENVIRONMENT;

let client, operatorKey, operatorId;

try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

async function main() {
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


	console.log('\n-Using ENIVRONMENT:', env);

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('operating in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('operating in *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('operating in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('operating in *LOCAL*');
	}
	else {
		throw new Error('ERROR: Must specify either MAIN, TEST, LOCAL or PREVIEW as environment');
	}
	client.setOperator(operatorId, operatorKey);

	console.log('Checking:', operatorId.toString());

	let proceed = readlineSync.keyInYNStrict('Do you want strip all FT allowances?');

	if (proceed) {
		let b = 0;
		const url = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${operatorId.toString()}/allowances/tokens?limit=100`;
		await axios(url).then((res) => {
			const allowances = res.data.allowances;
			// user an outer / inner loop to operate on batches of 20 allowances at a time
			for (let i = 0; i < allowances.length; i += 20) {
				const batch = allowances.slice(i, i + 20);
				const approvalTx =
				new AccountAllowanceApproveTransaction();
				for (let j = 0; j < batch.length; j++) {
					const allowance = batch[j];
					console.log(' -', allowance.owner, 'has allowance of', allowance.amount, 'for token', allowance.token_id, 'to', allowance.spender);
					approvalTx.approveTokenAllowance(TokenId.fromString(allowance.token_id), AccountId.fromString(allowance.owner), AccountId.fromString(allowance.spender), 0);
				}
				approvalTx.setTransactionMemo(`FT allowance reset (batch ${b++})`);
				approvalTx.freezeWith(client);
				approvalTx.execute(client).then((resp) => {
					resp.getReceipt(client).then((receipt) => {
						console.log('Receipt:', receipt.status.toString());
					});
				}).catch((err) => {
					console.error(err);
				});
			}
		}).catch(function(err) {
			console.error('Error Finding allowances', err);
		});
	}

	// ask on hbar allowances
	proceed = readlineSync.keyInYNStrict('Do you want strip all hbar allowances?');

	if (!proceed) {
		process.exit(0);
	}

	const hbarAllowances = await checkHbarAllowances(env, operatorId.toString());

	if (hbarAllowances.length === 0) {
		console.log('No HBAR allowances found');
		process.exit(0);
	}

	let b = 0;

	for (let i = 0; i < hbarAllowances.length; i += 20) {
		const batch = hbarAllowances.slice(i, i + 20);
		const approvalTx = new AccountAllowanceApproveTransaction();
		for (let j = 0; j < batch.length; j++) {
			const allowance = batch[j];
			console.log(' -', allowance.owner, 'has allowance of', allowance.amount, 'for HBAR to', allowance.spender);
			approvalTx.approveHbarAllowance(AccountId.fromString(allowance.owner), AccountId.fromString(allowance.spender), 0);
		}
		approvalTx.setTransactionMemo(`HBAR allowance reset (batch ${b++})`);
		approvalTx.freezeWith(client);
		approvalTx.execute(client).then((resp) => {
			resp.getReceipt(client).then((receipt) => {
				console.log('Receipt:', receipt.status.toString());
			});
		}).catch((err) => {
			console.error(err);
		});
	}
}

main();