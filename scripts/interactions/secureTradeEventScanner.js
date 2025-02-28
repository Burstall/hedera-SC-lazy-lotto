const {
	ContractId,
	Hbar,
	HbarUnit,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const { ethers } = require('ethers');
const { default: axios } = require('axios');
const { createDirectus, rest, readItems, staticToken, updateItem, createItem, createItems } = require('@directus/sdk');

const operatorId = process.env.ACCOUNT_ID ?? '0.0.888';
const env = process.env.SECURE_TRADE_ENV ?? null;
const eventsTable = process.env.SECURE_TRADE_EVENTS_TABLE ?? 'secureTradeEvents';
const cacheTable = process.env.SECURE_TRADE_CACHE_TABLE ?? 'SecureTradesCache';
const client = createDirectus(process.env.DIRECTUS_DB_URL).with(rest());
const writeClient = createDirectus(process.env.DIRECTUS_DB_URL).with(staticToken(process.env.DIRECTUS_TOKEN)).with(rest());
const supressLogs = process.env.SECURE_TRADE_SUPRESS_LOGS === '1' || process.env.SECURE_TRADE_SUPRESS_LOGS === 'true';

const evmToHederaMap = new Map();
evmToHederaMap.set(ethers.ZeroAddress, '0.0.0');

const main = async () => {

	const args = process.argv.slice(2);
	if ((args.length > 1) || getArgFlag('h')) {
		console.log('Usage: secureTradeEventScanner.js [0.0.STC]');
		console.log('       STC is the secure trade contract if not supplied will use LAZY_SECURE_TRADE_CONTRACT_ID from the .env file');
		return;
	}

	let secureTradeContract;

	// if an argument is passed use that as the contract id
	if (args.length == 0) {
		secureTradeContract = process.env.LAZY_SECURE_TRADE_CONTRACT_ID ?? null;
	}
	else {
		secureTradeContract = args[0];
	}

	if (!secureTradeContract) {
		console.log('ERROR: No secure trade contract provided');
		return;
	}

	// validate environment is in set of allowed values [mainnet, testnet, previewnet, local]
	if (!['mainnet', 'testnet', 'previewnet', 'local'].includes(env)) {
		console.log('ERROR: Invalid environment provided');
		return;
	}

	const contractId = ContractId.fromString(secureTradeContract);

	if (!supressLogs) console.log('\n-Using ENIVRONMENT:', env, 'operatorId:', operatorId, 'contractId:', contractId.toString());

	// look up the last hash from the EVENTS table
	const lastRecord = await getLastHashFromDirectus(contractId.toString());

	if (!lastRecord) {
		if (!supressLogs) console.log('INFO: No last timestamp found in the events table - fetching all logs');
	}
	else if (!supressLogs) {
		console.log('INFO: Last timestamp found in the events table:', lastRecord, '[', new Date(lastRecord * 1000).toUTCString(), ']');
	}

	const stcIface = new ethers.Interface(
		[
			'event TradeCreated(address indexed seller, address indexed buyer, address indexed token, uint256 serial, uint256 tinybarPrice, uint256 lazyPrice, uint256 expiryTime, uint256 nonce)',
			'event TradeCancelled(address indexed seller, address indexed token, uint256 serial, uint256 nonce)',
			'event TradeCompleted(address indexed seller, address indexed buyer, address indexed token, uint256 serial, uint256 nonce)',
		],
	);

	// Call the function to fetch logs
	let tradesMap = await getEventsFromMirror(contractId, stcIface, lastRecord);

	// initialize the account numbers
	for (const [, trade] of tradesMap) {
		await trade.initialize();
	}

	if (!supressLogs) console.log('Found', tradesMap.size, 'trades');

	// get the max nonce from the cache table
	const maxNonce = await getMaxNonceFromDirectus(contractId.toString());

	if (!supressLogs) console.log('Max nonce in cache table:', maxNonce);

	// filter out trades that have nonce less than the max nonce
	tradesMap = new Map([...tradesMap].filter(([, value]) => value.nonce > maxNonce));

	if (!supressLogs) console.log('POST FILTER: Found', tradesMap.size, 'trades');

	if (tradesMap) {
		// split the trades into batches of 100
		const tradesArray = Array.from(tradesMap.values());
		const batchSize = 100;
		for (let i = 0; i < tradesArray.length; i += batchSize) {
			const batch = tradesArray.slice(i, i + batchSize);
			await uploadTradesToDirectus(contractId.toString(), batch);
		}

		for (const [hash, trade] of tradesMap) {
			if (!supressLogs) console.log(hash, '->', trade.toString());
		}
	}
	else if (!supressLogs) { console.log('INFO: No new trades found'); }
};

async function getEventsFromMirror(contractId, iface, lastTimestamp) {
	const baseUrl = getBaseURL();

	let url;

	if (!lastTimestamp) {
		// pull logs from the beginning
		url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=asc&limit=100`;
	}
	else {
		// pull logs from the last timestamp
		url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=asc&limit=100&timestamp=gt:${lastTimestamp}`;
	}

	const tradesMap = new Map();
	let maxTimestamp = 0;

	do {
		const response = await axios.get(url);
		console.log('INFO: Fetching logs from', url);
		const jsonResponse = response.data;
		jsonResponse.logs.forEach(log => {
			// decode the event data
			if (log.data == '0x') return;

			// update the max timestamp
			if (log.timestamp > maxTimestamp) {
				maxTimestamp = log.timestamp;
			}
			const event = iface.parseLog({ topics: log.topics, data: log.data });

			/*
			 struct Trade {
			0	address seller;
			1	address buyer;
			2	address token;
			3	uint256 serial;
			4	uint256 tinybarPrice;
			5	uint256 lazyPrice;
			6	uint256 expiryTime;
			7	uint256 nonce;
			}
			*/

			/*
			 event TradeCompleted(
			0	address indexed seller,
			1	address indexed buyer,
			2	address indexed token,
			3	uint256 serial,
			4	uint256 nonce
			);
			*/

			/*
			 event TradeCancelled(
			0	address indexed seller,
			1	address indexed token,
			2	uint256 serial,
			3	uint256 nonce
			);*/

			// hash = ethers.solidityPackedKeccak256(['address', 'uint256'], [token.toSolidityAddress(), serial]);
			switch (event.name) {
			case 'TradeCreated': {
				const tradeObj = new TradeObject(
					event.args[0],
					event.args[1],
					event.args[2],
					event.args[3],
					event.args[4],
					event.args[5],
					event.args[6],
					event.args[7],
				);
				tradesMap.set(ethers.solidityPackedKeccak256(['address', 'uint256'], [event.args[2], event.args[3]]), tradeObj);
				break;
			}
			case 'TradeCompleted':
				// if the trade is not in the map then it was created before the last timestamp
				// so we just need to update the DB with markTradeAsCompletedInDb
				if (!tradesMap.has(ethers.solidityPackedKeccak256(['address', 'uint256'], [event.args[2], event.args[3]]))) {
					markTradeAsCompletedOrCancelledInDb(contractId.toString(), event.args[2], Number(event.args[3]), Number(event.args[4]), true);
					return;
				}
				tradesMap.get(ethers.solidityPackedKeccak256(['address', 'uint256'], [event.args[2], event.args[3]]))?.complete();
				break;
			case 'TradeCancelled':
				// if the trade is not in the map then it was created before the last timestamp
				// so we just need to update the DB with markTradeAsCancelledInDb
				if (!tradesMap.has(ethers.solidityPackedKeccak256(['address', 'uint256'], [event.args[1], event.args[2]]))) {
					markTradeAsCompletedOrCancelledInDb(contractId.toString(), event.args[1], Number(event.args[2]), Number(event.args[3]), false);
					return;
				}
				tradesMap.get(ethers.solidityPackedKeccak256(['address', 'uint256'], [event.args[1], event.args[2]]))?.cancel();
				break;
			default:
				break;
			}
		});

		if (!jsonResponse.links || !jsonResponse.links.next) break;

		url = `${baseUrl}${jsonResponse.links.next}`;
	}
	while (url);

	// post the last timestamp to the events table to enable status to persist across restarts
	if (maxTimestamp != 0) await postLastestTimestampToDirectus(contractId.toString(), maxTimestamp);
	console.log('INFO: Max timestamp:', maxTimestamp, '[', new Date(maxTimestamp * 1000).toUTCString(), ']');

	return tradesMap;
}

async function postLastestTimestampToDirectus(tradeContractId, timestamp) {
	console.log('INFO: Posting latest timestamp to Directus', timestamp, tradeContractId.toString(), eventsTable);
	try {
		const response = await client.request(readItems(eventsTable, {
			fields: ['id'],
			filter: {
				tradeContract: {
					_eq: tradeContractId.toString(),
				},
				environment: {
					_eq: env,
				},
			},
			limit: 1,
		}));

		console.log('INFO: Response from Directus', response);

		if (!response || response.length == 0) {
			await writeClient.request(createItem(eventsTable, { tradeContract: tradeContractId, lastTimestamp: timestamp, environment: env }));
		}
		else {
			await writeClient.request(updateItem(eventsTable, response[0].id, { lastTimestamp: timestamp }));
		}
	}
	catch (error) {
		console.log('ERROR: Unable to post latest timestamp to Directus');
		console.error(error);
		process.exit(1);
	}
}

async function markTradeAsCompletedOrCancelledInDb(tradeContractId, tokenId, serial, nonce, completed = true) {
	// find the primary key of the trade in the cache table
	const response = await client.request(readItems(cacheTable, {
		fields: ['id'],
		filter: {
			tradeContract: {
				_eq: tradeContractId.toString(),
			},
			tokenId: {
				_eq: tokenId.toString(),
			},
			serial: {
				_eq: Number(serial),
			},
			nonce: {
				_eq: Number(nonce),
			},
			environment: {
				_eq: env,
			},
		},
		limit: 1,
	}));

	if (response.data.length == 0) {
		console.log('ERROR: Trade not found in cache table');
		return;
	}

	if (completed) {
		await writeClient.request(updateItem(cacheTable, response.data[0].id, { completed: true }));
	}
	else {
		await writeClient.request(updateItem(cacheTable, response.data[0].id, { cancelled: true }));
	}
}

async function getMaxNonceFromDirectus(tradeContractId) {
	try {
		const response = await client.request(readItems(cacheTable, {
			fields: ['nonce'],
			filter: {
				tradeContract: {
					_eq: tradeContractId.toString(),
				},
				environment: {
					_eq: env,
				},
			},
			sort: ['-nonce'],
			limit: 1,
		}));

		if (!response || response.length == 0) {
			return 0;
		}

		return response[0].nonce;
	}
	catch (error) {
		console.log('ERROR: Unable to fetch max nonce from Directus');
		console.error(error);
		process.exit(1);
	}
}

/**
 * Uploads the trade to the directus cache table
 * @param {String} tradeContractId
 * @param {TradeObject[]} trades
 */
async function uploadTradesToDirectus(tradeContractId, trades) {
	if (trades.length == 0) return;

	const tradesToUpload = trades.map(trade => {
		return {
			tradeContract: tradeContractId,
			hash: trade.hash,
			seller: trade.seller,
			buyer: trade.buyer,
			token: trade.tokenId,
			serial: trade.serial,
			tinybarPrice: trade.tinybarPrice,
			lazyPrice: trade.lazyPrice,
			expiryTime: trade.expiryTime,
			nonce: trade.nonce,
			environment: env,
			completed: trade.completed,
			canceled: trade.canceled,
		};
	});

	try {
		const data = await writeClient.request(createItems(cacheTable, tradesToUpload));

		console.log('INFO: Uploaded', data?.length, 'trades to Directus');
	}
	catch (error) {
		if (error?.response?.statusText == 'Bad Request') {
			console.log('ERROR: Bad Request', error.response);
			const item = trades.pop();
			console.log('Retrying without', item);
			await uploadTradesToDirectus(tradeContractId, trades);
		}
		else {
			console.error(error);
		}
	}
}


async function getLastHashFromDirectus(tradeContractId) {
	const response = await client.request(readItems(eventsTable, {
		fields: ['lastTimestamp'],
		filter: {
			tradeContract: {
				_eq: tradeContractId.toString(),
			},
			environment: {
				_eq: env,
			},
		},
	}));

	if (!response || response.length == 0 || response[0].lastTimestamp == '0') {
		return null;
	}

	return response[0].lastTimestamp;
}

class TradeObject {
	constructor(seller, buyer, tokenId, serial, tinybarPrice, lazyPrice, expiryTime, nonce) {
		this.hash = ethers.solidityPackedKeccak256(['address', 'uint256'], [tokenId, serial]);
		this.seller = seller;
		this.buyer = buyer;
		this.tokenId = TokenId.fromSolidityAddress(tokenId).toString();
		this.serial = parseInt(serial);
		this.tinybarPrice = Number(tinybarPrice);
		this.lazyPrice = Number(lazyPrice);
		this.expiryTime = Number(expiryTime);
		this.nonce = Number(nonce);

		this.completed = false;
		this.canceled = false;
	}

	async initialize() {
		this.seller = await homebrewPopulateAccountNum(this.seller);
		this.buyer = await homebrewPopulateAccountNum(this.buyer);
	}

	isPublicTrade() {
		return this.buyer != '0x';
	}

	complete() {
		this.completed = true;
	}

	cancel() {
		this.canceled = true;
	}

	toString() {
		return `Hash: ${this.hash}, Seller: ${this.seller}, Buyer: ${this.buyer}, TokenId: ${this.tokenId}, Serial: ${this.serial}, Price: ${new Hbar(this.tinybarPrice, HbarUnit.Tinybar).toString()}, LazyPrice: ${this.lazyPrice / 10} $LAZY, ExpiryTime: ${this.expiryTime ? new Date(this.expiryTime * 1000).toUTCString() : 'NONE'}, Nonce: ${this.nonce}, Completed: ${this.completed}, Cancelled: ${this.canceled}`;
	}
}

const homebrewPopulateAccountNum = async function(evmAddress, counter = 0) {
	if (evmToHederaMap.has(evmAddress)) {
		return evmToHederaMap.get(evmAddress);
	}

	if (evmAddress === null) {
		throw new Error('field `evmAddress` should not be null');
	}

	const mirrorUrl = getBaseURL();

	try {
		const url = `${mirrorUrl}/api/v1/accounts/${evmAddress}`;

		const acct = (await axios.get(url)).data.account;

		evmToHederaMap.set(evmAddress, acct);

		return acct;
	}
	catch (error) {
		console.error(counter, ': ERROR: Unable to fetch account number for', evmAddress);
		// back off for 0.5-3 seconds
		await new Promise(resolve => setTimeout(resolve, Math.random() * 2500 + 500));
		return homebrewPopulateAccountNum(evmAddress, counter + 1);
	}
};

function getArgFlag(flag) {
	return process.argv.includes(`--${flag}`);
}

function getBaseURL() {
	switch (env) {
	case 'mainnet':
		return 'https://mainnet-public.mirrornode.hedera.com';
	case 'testnet':
		return 'https://testnet.mirrornode.hedera.com';
	case 'previewnet':
		return 'https://previewnet.mirrornode.hedera.com';
	case 'local':
		return 'http://localhost:5551';
	default:
		throw new Error(`Unknown environment: ${env}`);
	}
}

main()
	.then(() => {
		if (!supressLogs) console.log('INFO: Completed @', new Date().toUTCString());
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});