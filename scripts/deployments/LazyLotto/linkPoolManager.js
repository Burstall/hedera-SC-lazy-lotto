const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readline = require('readline');
const { ethers } = require('ethers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { sleep } = require('../../utils/nodeHelpers');
const { parseTransactionRecord } = require('../../utils/transactionHelpers');

require('dotenv').config();

const env = process.env.ENVIRONMENT ?? 'test';

// Helper: Prompt user
function prompt(question) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => {
		rl.question(question, answer => {
			rl.close();
			resolve(answer);
		});
	});
}

async function main() {
	console.log('\n=== Linking LazyLotto and LazyLottoPoolManager ===\n');
	console.log('Environment:', env.toUpperCase());

	// Setup client
	const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

	let client;
	if (env.toUpperCase() == 'TEST' || env.toUpperCase() == 'TESTNET') {
		client = Client.forTestnet();
	}
	else if (env.toUpperCase() == 'MAIN' || env.toUpperCase() == 'MAINNET') {
		client = Client.forMainnet();
	}
	else if (env.toUpperCase() == 'PREVIEW' || env.toUpperCase() == 'PREVIEWNET') {
		client = Client.forPreviewnet();
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
	}

	client.setOperator(operatorId, operatorKey);
	console.log('Using Operator:', operatorId.toString());

	// Verify required environment variables
	if (!process.env.LAZY_LOTTO_CONTRACT_ID || !process.env.LAZY_LOTTO_POOL_MANAGER_ID) {
		throw new Error('Missing required environment variables. Please ensure .env has:\n' +
			'  - LAZY_LOTTO_CONTRACT_ID\n' +
			'  - LAZY_LOTTO_POOL_MANAGER_ID');
	}

	const lazyLottoId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
	const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);

	console.log('LazyLotto:', lazyLottoId.toString());
	console.log('LazyLottoPoolManager:', poolManagerId.toString());

	// Interactive confirmation
	const proceed = await prompt('\n❓ Review the above configuration. Proceed with linking? (yes/no): ');
	if (proceed.toLowerCase() !== 'yes' && proceed.toLowerCase() !== 'y') {
		console.log('🛑 Linking cancelled.');
		process.exit(0);
	}

	// Load interfaces
	const lazyLottoJson = JSON.parse(
		fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
	);
	const lazyLottoIface = new ethers.Interface(lazyLottoJson.abi);

	const poolManagerJson = JSON.parse(
		fs.readFileSync('./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json'),
	);
	const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

	// Step 1: Set LazyLotto address in PoolManager
	console.log('\n1. Setting LazyLotto address in PoolManager...');

	const currentLazyLotto = await readOnlyEVMFromMirrorNode(
		env,
		poolManagerId,
		poolManagerIface,
		'lazyLotto',
		[],
		'address',
	);

	if (currentLazyLotto === '0x0000000000000000000000000000000000000000') {
		const setLazyLottoResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			150_000,
			'setLazyLotto',
			[lazyLottoId.toSolidityAddress()],
		);

		if (setLazyLottoResult[0]?.status?.toString() !== 'SUCCESS') {
			console.error('❌ Failed to set LazyLotto in PoolManager');
			if (setLazyLottoResult[2]) {
				console.log(parseTransactionRecord(setLazyLottoResult[2]));
			}
			throw new Error('Failed to set LazyLotto in PoolManager');
		}
		console.log('✅ LazyLotto address set in PoolManager');
		if (setLazyLottoResult[2]) {
			console.log(parseTransactionRecord(setLazyLottoResult[2]));
		}
	}
	else {
		console.log('ℹ️  LazyLotto already set in PoolManager');
	}

	await sleep(5000);

	// Step 2: Set PoolManager address in LazyLotto
	console.log('\n2. Setting PoolManager address in LazyLotto...');

	const currentPoolManager = await readOnlyEVMFromMirrorNode(
		env,
		lazyLottoId,
		lazyLottoIface,
		'poolManager',
		[],
		'address',
	);

	if (currentPoolManager === '0x0000000000000000000000000000000000000000') {
		const setPoolManagerResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			150_000,
			'setPoolManager',
			[poolManagerId.toSolidityAddress()],
		);

		if (setPoolManagerResult[0]?.status?.toString() !== 'SUCCESS') {
			console.error('❌ Failed to set PoolManager in LazyLotto');
			if (setPoolManagerResult[2]) {
				console.log(parseTransactionRecord(setPoolManagerResult[2]));
			}
			throw new Error('Failed to set PoolManager in LazyLotto');
		}
		console.log('✅ PoolManager address set in LazyLotto');
		if (setPoolManagerResult[2]) {
			console.log(parseTransactionRecord(setPoolManagerResult[2]));
		}
	}
	else {
		console.log('ℹ️  PoolManager already set in LazyLotto');
	}

	await sleep(5000);

	// Verify bidirectional linkage
	console.log('\n3. Verifying linkage...');
	const verifyLazyLotto = await readOnlyEVMFromMirrorNode(
		env,
		poolManagerId,
		poolManagerIface,
		'lazyLotto',
		[],
		'address',
	);

	const verifyPoolManager = await readOnlyEVMFromMirrorNode(
		env,
		lazyLottoId,
		lazyLottoIface,
		'poolManager',
		[],
		'address',
	);

	if (verifyLazyLotto.toLowerCase() === lazyLottoId.toSolidityAddress().toLowerCase() &&
		verifyPoolManager.toLowerCase() === poolManagerId.toSolidityAddress().toLowerCase()) {
		console.log('✅ Bidirectional linkage verified');
	}
	else {
		console.error('❌ Linkage verification failed!');
		console.error('Expected LazyLotto:', lazyLottoId.toSolidityAddress());
		console.error('Got:', verifyLazyLotto);
		console.error('Expected PoolManager:', poolManagerId.toSolidityAddress());
		console.error('Got:', verifyPoolManager);
	}

	console.log('\n=== Linking Complete ===\n');
	console.log('Contracts are now linked and ready to use!');
	console.log('\nNext steps:');
	console.log('1. node scripts/interactions/LazyLotto/admin/set-creation-fees.js --hbar 10 --lazy 1000');
	console.log('2. node scripts/interactions/LazyLotto/admin/migrate-bonuses.js (if upgrading)');
	console.log('3. node scripts/interactions/LazyLotto/user/create-community-pool.js (test creation)');
}

if (require.main === module) {
	main()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error(error);
			process.exit(1);
		});
}

module.exports = main;
