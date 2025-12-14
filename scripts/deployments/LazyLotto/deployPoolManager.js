const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	TokenId,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { contractDeployFunction } = require('../../utils/solidityHelpers');
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
	console.log('\n=== Deploying LazyLottoPoolManager ===\n');
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
	if (!process.env.LAZY_TOKEN_ID || !process.env.LAZY_GAS_STATION_CONTRACT_ID ||
		!process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
		throw new Error('Missing required environment variables. Please ensure .env has:\n' +
			'  - LAZY_TOKEN_ID\n' +
			'  - LAZY_GAS_STATION_CONTRACT_ID\n' +
			'  - LAZY_DELEGATE_REGISTRY_CONTRACT_ID');
	}

	const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
	const lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
	const lazyDelegateRegistryId = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);

	console.log('\nUsing addresses:');
	console.log('  LAZY Token:', lazyTokenId.toString());
	console.log('  LazyGasStation:', lazyGasStationId.toString());
	console.log('  LazyDelegateRegistry:', lazyDelegateRegistryId.toString());

	// Interactive confirmation
	const proceed = await prompt('\n❓ Review the above configuration. Proceed with deployment? (yes/no): ');
	if (proceed.toLowerCase() !== 'yes' && proceed.toLowerCase() !== 'y') {
		console.log('🛑 Deployment cancelled.');
		process.exit(0);
	}

	// Load contract bytecode
	const poolManagerJson = JSON.parse(
		fs.readFileSync('./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json'),
	);

	// Calculate and display size
	const sizeKB = (poolManagerJson.bytecode.length / 2 / 1024);
	console.log(`\nContract size: ${sizeKB.toFixed(3)} KB (limit: 24 KB)`);

	if (sizeKB > 24) {
		console.warn('⚠️  WARNING: Contract exceeds 24 KB Hedera limit!');
		process.exit(1);
	}

	// Deploy LazyLottoPoolManager
	console.log('\nDeploying LazyLottoPoolManager...');
	const constructorParams = new ContractFunctionParameters()
		.addAddress(lazyTokenId.toSolidityAddress())
		.addAddress(lazyGasStationId.toSolidityAddress())
		.addAddress(lazyDelegateRegistryId.toSolidityAddress());

	const [poolManagerId, poolManagerAddress, deployRecord] = await contractDeployFunction(
		client,
		poolManagerJson.bytecode,
		2_500_000,
		constructorParams,
	);

	console.log('✅ LazyLottoPoolManager deployed to:', poolManagerId.toString());
	console.log('   Address:', poolManagerAddress);
	if (deployRecord) {
		console.log(parseTransactionRecord(deployRecord));
	}

	// Update .env file with new address
	const envPath = path.join(__dirname, '../../../.env');
	let envContent = fs.readFileSync(envPath, 'utf8');

	// Check if LAZY_LOTTO_POOL_MANAGER_ID exists
	if (envContent.includes('LAZY_LOTTO_POOL_MANAGER_ID=')) {
		envContent = envContent.replace(
			/LAZY_LOTTO_POOL_MANAGER_ID=.*/,
			`LAZY_LOTTO_POOL_MANAGER_ID=${poolManagerId.toString()}`,
		);
	}
	else {
		envContent += `\nLAZY_LOTTO_POOL_MANAGER_ID=${poolManagerId.toString()}\n`;
	}

	fs.writeFileSync(envPath, envContent);
	console.log('\n✅ Address saved to .env');

	console.log('\n=== Deployment Complete ===\n');
	console.log('Next steps:');
	console.log('1. Run: node scripts/deployments/LazyLotto/link-pool-manager.js');
	console.log('2. Run: node scripts/interactions/LazyLotto/admin/set-creation-fees.js --hbar 10 --lazy 1000');
	console.log('3. Run: node scripts/interactions/LazyLotto/admin/migrate-bonuses.js (if upgrading)');

	return poolManagerId;
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
