/**
 * Interactive LazyLotto Deployment Script
 *
 * This script handles deployment of LazyLotto and all its dependencies to Hedera,
 * including the LazyLottoPoolManager for community-driven pool functionality.
 * It checks for existing deployments and allows reuse, making it safe for partial deployments.
 *
 * Required Environment Variables (.env):
 * - ACCOUNT_ID=0.0.xxxxx
 * - PRIVATE_KEY=302...
 * - ENVIRONMENT=TEST/MAIN/PREVIEW (defaults to TEST if not set)
 *
 * Optional (reuse existing):
 * - LAZY_TOKEN_ID=0.0.xxxxx
 * - LAZY_SCT_CONTRACT_ID=0.0.xxxxx (not currently used by LazyLotto)
 * - LAZY_GAS_STATION_CONTRACT_ID=0.0.xxxxx
 * - LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.xxxxx
 * - PRNG_CONTRACT_ID=0.0.xxxxx
 * - LAZY_LOTTO_STORAGE=0.0.xxxxx
 * - LAZY_LOTTO_CONTRACT_ID=0.0.xxxxx
 * - LAZY_LOTTO_POOL_MANAGER_ID=0.0.xxxxx
 *
 * For verification-only mode:
 * - VERIFY_ONLY=true (skips deployment, only runs verification)
 *
 * Usage:
 * npm run deploy:lazylotto
 *
 * Or directly:
 * node scripts/deployments/LazyLotto/deployLazyLotto.js
 *
 * Verification only:
 * VERIFY_ONLY=true node scripts/deployments/LazyLotto/deployLazyLotto.js
 */

const fs = require('fs');
const readline = require('readline');
const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	ContractFunctionParameters,
	TransferTransaction,
} = require('@hashgraph/sdk');
const { contractDeployFunction, contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { estimateGas } = require('../../../utils/gasHelpers');
const { parseTransactionRecord } = require('../../../utils/transactionHelpers');
const { ethers } = require('ethers');

// Load environment variables
require('dotenv').config();

// Configuration
const contractName = process.env.CONTRACT_NAME ?? 'LazyLotto';
const storageContractName = process.env.STORAGE_CONTRACT_NAME ?? 'LazyLottoStorage';
const poolManagerContractName = 'LazyLottoPoolManager';
const lazyGasStationName = 'LazyGasStation';
const lazyDelegateRegistryName = 'LazyDelegateRegistry';
const prngContractName = 'PrngSystemContract';
const lazyContractCreator = 'LAZYTokenCreator';

const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'TEST';
const verifyOnly = process.env.VERIFY_ONLY === 'true';

// Track deployed contracts
const deployedContracts = {
	lazyToken: null,
	lazySCT: null,
	lazyGasStation: null,
	lazyDelegateRegistry: null,
	prng: null,
	lazyLottoStorage: null,
	lazyLotto: null,
	poolManager: null,
};

// Interfaces
let lazyIface, lazyGasStationIface, lazyLottoStorageIface, lazyLottoIface, poolManagerIface;
let client;

// Utility: Sleep function
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility: Save deployment addresses
function saveDeploymentAddresses() {
	const deploymentData = {
		timestamp: new Date().toISOString(),
		environment: env.toUpperCase(),
		contracts: deployedContracts,
	};

	const filename = `deployment-${env.toLowerCase()}-${Date.now()}.json`;
	const filepath = `./scripts/deployments/${filename}`;

	fs.writeFileSync(filepath, JSON.stringify(deploymentData, null, 2));
	console.log(`\n✅ Deployment addresses saved to: ${filepath}`);
}

// Utility: Prompt user for input
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

// Step 1: Initialize client
async function initializeClient() {
	console.log('\n🚀 LazyLotto Deployment Script');
	console.log('=====================================\n');

	if (!operatorId || !operatorKey) {
		console.error('❌ Error: ACCOUNT_ID and PRIVATE_KEY must be set in .env');
		process.exit(1);
	}

	console.log(`📍 Environment: ${env.toUpperCase()}`);

	if (env.toUpperCase() === 'TEST' || env.toUpperCase() === 'TESTNET') {
		client = Client.forTestnet();
		console.log('   Network: TESTNET');
	}
	else if (env.toUpperCase() === 'MAIN' || env.toUpperCase() === 'MAINNET') {
		client = Client.forMainnet();
		console.log('   Network: MAINNET');
		const confirm = await prompt('⚠️  WARNING: You are deploying to MAINNET. Type "MAINNET" to confirm: ');
		if (confirm !== 'MAINNET') {
			console.log('❌ Deployment cancelled.');
			process.exit(0);
		}
	}
	else if (env.toUpperCase() === 'PREVIEW' || env.toUpperCase() === 'PREVIEWNET') {
		client = Client.forPreviewnet();
		console.log('   Network: PREVIEWNET');
	}
	else if (env.toUpperCase() === 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('   Network: LOCAL');
	}
	else {
		console.error(`❌ Unknown environment: ${env}`);
		process.exit(1);
	}

	client.setOperator(operatorId, operatorKey);
	console.log(`👤 Operator: ${operatorId.toString()}\n`);

	// Show current .env configuration
	console.log('📋 Current .env Configuration:');
	console.log('   LAZY_TOKEN_ID:', process.env.LAZY_TOKEN_ID || '(not set - will deploy new)');
	console.log('   LAZY_SCT_CONTRACT_ID:', process.env.LAZY_SCT_CONTRACT_ID || '(not set - will deploy new)');
	console.log('   LAZY_GAS_STATION_CONTRACT_ID:', process.env.LAZY_GAS_STATION_CONTRACT_ID || '(not set - will deploy new)');
	console.log('   LAZY_DELEGATE_REGISTRY_CONTRACT_ID:', process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID || '(not set - will deploy new)');
	console.log('   PRNG_CONTRACT_ID:', process.env.PRNG_CONTRACT_ID || '(not set - will deploy new)');
	console.log('   LAZY_LOTTO_STORAGE:', process.env.LAZY_LOTTO_STORAGE || '(not set - will deploy new)');
	console.log('   LAZY_LOTTO_CONTRACT_ID:', process.env.LAZY_LOTTO_CONTRACT_ID || '(not set - will deploy new)');
	console.log('   LAZY_LOTTO_POOL_MANAGER_ID:', process.env.LAZY_LOTTO_POOL_MANAGER_ID || '(not set - will deploy new)');
	console.log('');

	const proceed = await prompt('❓ Review the above configuration. Proceed with deployment? (yes/no): ');
	if (proceed.toLowerCase() !== 'yes' && proceed.toLowerCase() !== 'y') {
		console.log('🛑 Deployment cancelled. Please update your .env file and try again.');
		process.exit(0);
	}
	console.log('');
}

// Step 2: Deploy or reuse LAZY token and SCT
async function deployLazyToken() {
	console.log('\n📦 Step 1: LAZY Token & SCT');
	console.log('----------------------------');

	if (process.env.LAZY_TOKEN_ID) {
		deployedContracts.lazyToken = TokenId.fromString(process.env.LAZY_TOKEN_ID);
		console.log(`✅ Found existing LAZY Token: ${deployedContracts.lazyToken.toString()}`);

		// Query token info from mirror node to display to user
		try {
			const { checkMirrorTokenInfo } = require('../../../utils/hederaMirrorHelpers');
			const tokenInfo = await checkMirrorTokenInfo(env, deployedContracts.lazyToken);
			if (tokenInfo) {
				console.log(`   Name: ${tokenInfo.name}`);
				console.log(`   Symbol: ${tokenInfo.symbol}`);
				console.log(`   Decimals: ${tokenInfo.decimals}`);
				console.log(`   Max Supply: ${tokenInfo.max_supply ? (tokenInfo.max_supply / Math.pow(10, tokenInfo.decimals)).toLocaleString() : 'unlimited'}`);
			}
		}
		catch (error) {
			console.log('   (Unable to fetch token info from mirror node)', error.message);
		}

		if (process.env.LAZY_SCT_CONTRACT_ID) {
			deployedContracts.lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
			console.log(`✅ Found existing LAZY SCT: ${deployedContracts.lazySCT.toString()}`);
		}

		const useExisting = await prompt('❓ Use existing LAZY Token? (yes/no): ');
		if (useExisting.toLowerCase() !== 'yes' && useExisting.toLowerCase() !== 'y') {
			console.log('🛑 Please update your .env file to remove LAZY_TOKEN_ID, or specify a different token.');
			process.exit(0);
		}
		console.log('✅ Using existing LAZY token');
	}
	else {
		console.log('⚠️  No existing LAZY Token found in .env');
		const deployNew = await prompt('❓ Deploy new LAZY Token and SCT? (yes/no): ');
		if (deployNew.toLowerCase() !== 'yes' && deployNew.toLowerCase() !== 'y') {
			console.log('🛑 Deployment cancelled. Please set LAZY_TOKEN_ID in .env to use an existing token.');
			process.exit(0);
		}

		// Interactive prompts for all token parameters
		console.log('\n📝 Token Configuration');
		console.log('----------------------');

		const tokenSymbol = await prompt('Token symbol (e.g., LAZY): ');
		if (!tokenSymbol || tokenSymbol.trim().length === 0) {
			console.error('❌ Token symbol is required');
			process.exit(1);
		}

		const tokenName = await prompt('Token name (e.g., Lazy Superheroes Token): ');
		if (!tokenName || tokenName.trim().length === 0) {
			console.error('❌ Token name is required');
			process.exit(1);
		}

		const tokenMemo = await prompt('Token memo/description: ');

		const maxSupplyInput = await prompt('Max supply (total tokens, e.g., 1000000000): ');
		const maxSupply = parseInt(maxSupplyInput);
		if (isNaN(maxSupply) || maxSupply <= 0) {
			console.error('❌ Invalid max supply. Must be a positive number.');
			process.exit(1);
		}

		const decimalsInput = await prompt('Decimals (0-8, e.g., 8): ');
		const decimals = parseInt(decimalsInput);
		if (isNaN(decimals) || decimals < 0 || decimals > 8) {
			console.error('❌ Invalid decimals. Must be between 0 and 8.');
			process.exit(1);
		}

		const initialSupplyInput = await prompt(`Initial supply (0-${maxSupply}, e.g., ${maxSupply}): `);
		const initialSupply = parseInt(initialSupplyInput);
		if (isNaN(initialSupply) || initialSupply < 0 || initialSupply > maxSupply) {
			console.error(`❌ Invalid initial supply. Must be between 0 and ${maxSupply}.`);
			process.exit(1);
		}

		const burnPercentInput = await prompt('Burn percentage for SCT (0-100, typically 0): ');
		const burnPercent = parseInt(burnPercentInput);
		if (isNaN(burnPercent) || burnPercent < 0 || burnPercent > 100) {
			console.error('❌ Invalid burn percentage. Must be between 0 and 100.');
			process.exit(1);
		}

		const mintPaymentInput = await prompt('HBAR payment for token creation (e.g., 20): ');
		const mintPayment = parseFloat(mintPaymentInput);
		if (isNaN(mintPayment) || mintPayment < 0) {
			console.error('❌ Invalid HBAR amount. Must be a non-negative number.');
			process.exit(1);
		}

		// Display summary for confirmation
		console.log('\n📋 Token Configuration Summary:');
		console.log('--------------------------------');
		console.log(`   Symbol:          ${tokenSymbol}`);
		console.log(`   Name:            ${tokenName}`);
		console.log(`   Memo:            ${tokenMemo}`);
		console.log(`   Max Supply:      ${maxSupply.toLocaleString()}`);
		console.log(`   Initial Supply:  ${initialSupply.toLocaleString()}`);
		console.log(`   Decimals:        ${decimals}`);
		console.log(`   Burn %:          ${burnPercent}%`);
		console.log(`   Creation Fee:    ${mintPayment} HBAR`);
		console.log('');

		const confirmDeploy = await prompt('❓ Proceed with deployment using these parameters? (yes/no): ');
		if (confirmDeploy.toLowerCase() !== 'yes' && confirmDeploy.toLowerCase() !== 'y') {
			console.log('🛑 Deployment cancelled.');
			process.exit(0);
		}

		console.log('\n🔨 Deploying LAZY Token Creator (SCT)...');

		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);
		lazyIface = new ethers.Interface(lazyJson.abi);

		const lazyConstructorParams = new ContractFunctionParameters()
			.addUint256(burnPercent);

		const [lazySCT, lazySCTAddress, deploySCTRecord] = await contractDeployFunction(
			client,
			lazyJson.bytecode,
			3_500_000,
			lazyConstructorParams,
		);

		deployedContracts.lazySCT = lazySCT;
		console.log(`✅ LAZY SCT deployed: ${lazySCT.toString()}`);
		console.log(`   Address: ${lazySCTAddress}`);
		if (deploySCTRecord) {
			console.log(parseTransactionRecord(deploySCTRecord));
		}

		await sleep(3000);

		console.log('\n🔨 Creating LAZY fungible token...');
		const mintLazyResult = await contractExecuteFunction(
			lazySCT,
			lazyIface,
			client,
			800_000,
			'createFungibleWithBurn',
			[
				tokenSymbol,
				`$${tokenSymbol}`,
				tokenMemo || tokenName,
				maxSupply,
				decimals,
				initialSupply,
			],
			mintPayment,
		);

		if (mintLazyResult[0]?.status?.toString() !== 'SUCCESS') {
			console.error('❌ LAZY token creation failed:', mintLazyResult[0]?.status?.toString());
			if (mintLazyResult[2]) {
				console.log(parseTransactionRecord(mintLazyResult[2]));
			}
			process.exit(1);
		}

		deployedContracts.lazyToken = TokenId.fromSolidityAddress(mintLazyResult[1][0]);
		console.log(`✅ LAZY Token created: ${deployedContracts.lazyToken.toString()}`);
		if (mintLazyResult[2]) {
			console.log(parseTransactionRecord(mintLazyResult[2]));
		}

		// Suggest updating .env
		console.log('\n💡 Add these to your .env file:');
		console.log(`   LAZY_TOKEN_ID=${deployedContracts.lazyToken.toString()}`);
		console.log(`   LAZY_SCT_CONTRACT_ID=${deployedContracts.lazySCT.toString()}`);
	}

	// Load interface if not already loaded
	if (!lazyIface) {
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);
		lazyIface = new ethers.Interface(lazyJson.abi);
	}
}

// Step 3: Deploy LazyGasStation
async function deployLazyGasStation() {
	console.log('\n📦 Step 2: LazyGasStation');
	console.log('-------------------------');

	if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
		deployedContracts.lazyGasStation = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
		console.log(`✅ Found existing LazyGasStation: ${deployedContracts.lazyGasStation.toString()}`);

		const useExisting = await prompt('❓ Use existing LazyGasStation? (yes/no): ');
		if (useExisting.toLowerCase() !== 'yes' && useExisting.toLowerCase() !== 'y') {
			console.log('🛑 Please update your .env file to remove LAZY_GAS_STATION_CONTRACT_ID or deploy a new one manually.');
			process.exit(0);
		}
		console.log('✅ Using existing contract');
	}
	else {
		console.log('⚠️  No existing LazyGasStation found in .env');
		const deployNew = await prompt('❓ Deploy new LazyGasStation? (yes/no): ');
		if (deployNew.toLowerCase() !== 'yes' && deployNew.toLowerCase() !== 'y') {
			console.log('🛑 Deployment cancelled. Please set LAZY_GAS_STATION_CONTRACT_ID in .env to use an existing contract.');
			process.exit(0);
		}

		console.log('🔨 Deploying LazyGasStation...');

		const lazyGasStationJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);

		const gasStationConstructorParams = new ContractFunctionParameters()
			.addAddress(deployedContracts.lazyToken.toSolidityAddress())
			.addAddress(deployedContracts.lazySCT.toSolidityAddress());

		const [lazyGasStationId, lazyGasStationAddress, deployGSRecord] = await contractDeployFunction(
			client,
			lazyGasStationJson.bytecode,
			4_000_000,
			gasStationConstructorParams,
		);

		deployedContracts.lazyGasStation = lazyGasStationId;
		console.log(`✅ LazyGasStation deployed: ${lazyGasStationId.toString()}`);
		console.log(`   Address: ${lazyGasStationAddress}`);
		if (deployGSRecord) {
			console.log(parseTransactionRecord(deployGSRecord));
		}
	}

	// Load interface
	const lazyGasStationJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
		),
	);
	lazyGasStationIface = new ethers.Interface(lazyGasStationJson.abi);
}

// Step 4: Deploy LazyDelegateRegistry
async function deployLazyDelegateRegistry() {
	console.log('\n📦 Step 3: LazyDelegateRegistry');
	console.log('--------------------------------');

	if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
		deployedContracts.lazyDelegateRegistry = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
		console.log(`✅ Found existing LazyDelegateRegistry: ${deployedContracts.lazyDelegateRegistry.toString()}`);

		const useExisting = await prompt('❓ Use existing LazyDelegateRegistry? (yes/no): ');
		if (useExisting.toLowerCase() !== 'yes' && useExisting.toLowerCase() !== 'y') {
			console.log('🛑 Please update your .env file to remove LAZY_DELEGATE_REGISTRY_CONTRACT_ID or deploy a new one manually.');
			process.exit(0);
		}
		console.log('✅ Using existing contract');
	}
	else {
		console.log('⚠️  No existing LazyDelegateRegistry found in .env');
		const deployNew = await prompt('❓ Deploy new LazyDelegateRegistry? (yes/no): ');
		if (deployNew.toLowerCase() !== 'yes' && deployNew.toLowerCase() !== 'y') {
			console.log('🛑 Deployment cancelled. Please set LAZY_DELEGATE_REGISTRY_CONTRACT_ID in .env to use an existing contract.');
			process.exit(0);
		}

		console.log('🔨 Deploying LazyDelegateRegistry...');

		const lazyDelegateRegistryJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
			),
		);

		const [lazyDelegateRegistryId, lazyDelegateRegistryAddress, deployDRRecord] = await contractDeployFunction(
			client,
			lazyDelegateRegistryJson.bytecode,
			2_100_000,
		);

		deployedContracts.lazyDelegateRegistry = lazyDelegateRegistryId;
		console.log(`✅ LazyDelegateRegistry deployed: ${lazyDelegateRegistryId.toString()}`);
		console.log(`   Address: ${lazyDelegateRegistryAddress}`);
		if (deployDRRecord) {
			console.log(parseTransactionRecord(deployDRRecord));
		}
	}
}

// Step 5: Deploy PRNG
async function deployPRNG() {
	console.log('\n📦 Step 4: PRNG Generator');
	console.log('-------------------------');

	if (process.env.PRNG_CONTRACT_ID) {
		deployedContracts.prng = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
		console.log(`✅ Found existing PRNG: ${deployedContracts.prng.toString()}`);

		const useExisting = await prompt('❓ Use existing PRNG? (yes/no): ');
		if (useExisting.toLowerCase() !== 'yes' && useExisting.toLowerCase() !== 'y') {
			console.log('🛑 Please update your .env file to remove PRNG_CONTRACT_ID or deploy a new one manually.');
			process.exit(0);
		}
		console.log('✅ Using existing contract');
	}
	else {
		console.log('⚠️  No existing PRNG found in .env');
		const deployNew = await prompt('❓ Deploy new PRNG Generator? (yes/no): ');
		if (deployNew.toLowerCase() !== 'yes' && deployNew.toLowerCase() !== 'y') {
			console.log('🛑 Deployment cancelled. Please set PRNG_CONTRACT_ID in .env to use an existing contract.');
			process.exit(0);
		}

		console.log('🔨 Deploying PRNG Generator...');

		const prngJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${prngContractName}.sol/${prngContractName}.json`,
			),
		);

		const [prngId, prngAddress, deployPRNGRecord] = await contractDeployFunction(
			client,
			prngJson.bytecode,
			1_800_000,
		);

		deployedContracts.prng = prngId;
		console.log(`✅ PRNG deployed: ${prngId.toString()}`);
		console.log(`   Address: ${prngAddress}`);
		if (deployPRNGRecord) {
			console.log(parseTransactionRecord(deployPRNGRecord));
		}
	}
}

// Step 6: Deploy LazyLottoStorage
async function deployLazyLottoStorage() {
	console.log('\n📦 Step 5: LazyLottoStorage');
	console.log('---------------------------');

	if (process.env.LAZY_LOTTO_STORAGE) {
		deployedContracts.lazyLottoStorage = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);
		console.log(`✅ Found existing LazyLottoStorage: ${deployedContracts.lazyLottoStorage.toString()}`);

		const useExisting = await prompt('❓ Use existing LazyLottoStorage? (yes/no): ');
		if (useExisting.toLowerCase() !== 'yes' && useExisting.toLowerCase() !== 'y') {
			console.log('🛑 Please update your .env file to remove LAZY_LOTTO_STORAGE or deploy a new one manually.');
			process.exit(0);
		}
		console.log('✅ Using existing contract');
	}
	else {
		console.log('⚠️  No existing LazyLottoStorage found in .env');
		const deployNew = await prompt('❓ Deploy new LazyLottoStorage? (yes/no): ');
		if (deployNew.toLowerCase() !== 'yes' && deployNew.toLowerCase() !== 'y') {
			console.log('🛑 Deployment cancelled. Please set LAZY_LOTTO_STORAGE in .env to use an existing contract.');
			process.exit(0);
		}

		console.log('🔨 Deploying LazyLottoStorage...');

		const storageBytecode = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/${storageContractName}.sol/${storageContractName}.json`),
		).bytecode;

		const storageConstructorParams = new ContractFunctionParameters()
			.addAddress(deployedContracts.lazyGasStation.toSolidityAddress())
			.addAddress(deployedContracts.lazyToken.toSolidityAddress());

		const [storageContractId, storageContractAddress, deployStorageRecord] = await contractDeployFunction(
			client,
			storageBytecode,
			3_500_000,
			storageConstructorParams,
		);

		deployedContracts.lazyLottoStorage = storageContractId;
		console.log(`✅ LazyLottoStorage deployed: ${storageContractId.toString()}`);
		console.log(`   Address: ${storageContractAddress}`);
		if (deployStorageRecord) {
			console.log(parseTransactionRecord(deployStorageRecord));
		}
	}

	// Load interface
	lazyLottoStorageIface = new ethers.Interface(JSON.parse(
		fs.readFileSync(`./artifacts/contracts/${storageContractName}.sol/${storageContractName}.json`),
	).abi);
}

// Step 7: Deploy LazyLotto
async function deployLazyLotto() {
	console.log('\n📦 Step 6: LazyLotto');
	console.log('--------------------');

	if (process.env.LAZY_LOTTO_CONTRACT_ID) {
		deployedContracts.lazyLotto = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
		console.log(`✅ Found existing LazyLotto: ${deployedContracts.lazyLotto.toString()}`);

		const useExisting = await prompt('❓ Use existing LazyLotto? (yes/no): ');
		if (useExisting.toLowerCase() !== 'yes' && useExisting.toLowerCase() !== 'y') {
			console.log('🛑 Please update your .env file to remove LAZY_LOTTO_CONTRACT_ID or deploy a new one manually.');
			process.exit(0);
		}
		console.log('✅ Using existing contract');
		return;
	}

	console.log('⚠️  No existing LazyLotto found in .env');
	const deployNew = await prompt('❓ Deploy new LazyLotto? (yes/no): ');
	if (deployNew.toLowerCase() !== 'yes' && deployNew.toLowerCase() !== 'y') {
		console.log('🛑 Deployment cancelled. Please set LAZY_LOTTO_CONTRACT_ID in .env to use an existing contract.');
		process.exit(0);
	}

	// Prompt for LazyLotto burn percentage configuration
	console.log('\n📝 LazyLotto Configuration');
	console.log('--------------------------');
	const lazyBurnPercentInput = await prompt('LAZY burn percentage for LazyLotto (0-100, typically 0-50): ');
	const lazyBurnPercent = parseInt(lazyBurnPercentInput);
	if (isNaN(lazyBurnPercent) || lazyBurnPercent < 0 || lazyBurnPercent > 100) {
		console.error('❌ Invalid burn percentage. Must be between 0 and 100.');
		process.exit(1);
	}

	console.log('\n📋 LazyLotto Configuration Summary:');
	console.log('-----------------------------------');
	console.log(`   LAZY Burn %: ${lazyBurnPercent}%`);
	console.log('');

	const confirmDeploy = await prompt('❓ Proceed with LazyLotto deployment? (yes/no): ');
	if (confirmDeploy.toLowerCase() !== 'yes' && confirmDeploy.toLowerCase() !== 'y') {
		console.log('🛑 Deployment cancelled.');
		process.exit(0);
	}

	console.log('\n🔨 Deploying LazyLotto main contract...');

	const json = JSON.parse(
		fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`),
	);

	const contractBytecode = json.bytecode;
	lazyLottoIface = new ethers.Interface(json.abi);

	const gasLimit = 6_000_000;

	// Constructor params: (lazyToken, lazyGasStation, lazyDelegateRegistry, prng, burnPercentage, storageContract)
	const constructorParams = new ContractFunctionParameters()
		.addAddress(deployedContracts.lazyToken.toSolidityAddress())
		.addAddress(deployedContracts.lazyGasStation.toSolidityAddress())
		.addAddress(deployedContracts.lazyDelegateRegistry.toSolidityAddress())
		.addAddress(deployedContracts.prng.toSolidityAddress())
		.addUint256(lazyBurnPercent)
		.addAddress(deployedContracts.lazyLottoStorage.toSolidityAddress());

	const [contractId, contractAddress, deployLottoRecord] = await contractDeployFunction(
		client,
		contractBytecode,
		gasLimit,
		constructorParams,
	);

	deployedContracts.lazyLotto = contractId;
	console.log(`✅ LazyLotto deployed: ${contractId.toString()}`);
	console.log(`   Address: ${contractAddress}`);
	if (deployLottoRecord) {
		console.log(parseTransactionRecord(deployLottoRecord));
	}
}

// Step 8: Set LazyLotto as contract user on storage
async function setContractUser() {
	console.log('\n⚙️  Step 7: Configure Storage Contract User');
	console.log('-------------------------------------------');

	// Check if already set
	const encodedCommand = lazyLottoStorageIface.encodeFunctionData('getContractUser');
	const result = await readOnlyEVMFromMirrorNode(
		env,
		deployedContracts.lazyLottoStorage,
		encodedCommand,
		operatorId,
		false,
	);
	const currentContractUser = lazyLottoStorageIface.decodeFunctionResult('getContractUser', result);

	if (currentContractUser[0].toLowerCase() === deployedContracts.lazyLotto.toSolidityAddress()) {
		console.log('✅ LazyLotto is already set as contract user on storage');
		return;
	}

	console.log('🔨 Setting LazyLotto as contract user on storage...');

	await sleep(5000);

	const gasEstimate = await estimateGas(
		env,
		deployedContracts.lazyLottoStorage,
		lazyLottoStorageIface,
		operatorId,
		'setContractUser',
		[deployedContracts.lazyLotto.toSolidityAddress()],
		500_000,
	);

	const setContractUserResult = await contractExecuteFunction(
		deployedContracts.lazyLottoStorage,
		lazyLottoStorageIface,
		client,
		gasEstimate.gasLimit,
		'setContractUser',
		[deployedContracts.lazyLotto.toSolidityAddress()],
	);

	if (setContractUserResult[0]?.status?.toString() !== 'SUCCESS') {
		console.error('❌ setContractUser failed');
		if (setContractUserResult[2]) {
			console.log(parseTransactionRecord(setContractUserResult[2]));
		}
		process.exit(1);
	}

	console.log('✅ LazyLotto set as contract user on storage');
	if (setContractUserResult[2]) {
		console.log(parseTransactionRecord(setContractUserResult[2]));
	}
}

// Step 9: Add storage and LazyLotto to LazyGasStation
async function addContractUsersToGasStation() {
	console.log('\n⚙️  Step 8: Configure LazyGasStation Contract Users');
	console.log('--------------------------------------------------');

	await sleep(5000);

	// Add storage contract
	console.log('🔨 Adding LazyLottoStorage to LazyGasStation...');
	const gasEstimate1 = await estimateGas(
		env,
		deployedContracts.lazyGasStation,
		lazyGasStationIface,
		operatorId,
		'addContractUser',
		[deployedContracts.lazyLottoStorage.toSolidityAddress()],
		500_000,
	);

	const addStorageResult = await contractExecuteFunction(
		deployedContracts.lazyGasStation,
		lazyGasStationIface,
		client,
		gasEstimate1.gasLimit,
		'addContractUser',
		[deployedContracts.lazyLottoStorage.toSolidityAddress()],
	);

	if (addStorageResult[0]?.status?.toString() !== 'SUCCESS') {
		console.error('❌ Adding storage to LazyGasStation failed');
		if (addStorageResult[2]) {
			console.log(parseTransactionRecord(addStorageResult[2]));
		}
		process.exit(1);
	}

	console.log('✅ LazyLottoStorage added to LazyGasStation');
	if (addStorageResult[2]) {
		console.log(parseTransactionRecord(addStorageResult[2]));
	}

	await sleep(3000);

	// Add LazyLotto contract
	console.log('🔨 Adding LazyLotto to LazyGasStation...');
	const gasEstimate2 = await estimateGas(
		env,
		deployedContracts.lazyGasStation,
		lazyGasStationIface,
		operatorId,
		'addContractUser',
		[deployedContracts.lazyLotto.toSolidityAddress()],
		500_000,
	);

	const addLottoResult = await contractExecuteFunction(
		deployedContracts.lazyGasStation,
		lazyGasStationIface,
		client,
		gasEstimate2.gasLimit * 1.1,
		'addContractUser',
		[deployedContracts.lazyLotto.toSolidityAddress()],
	);

	if (addLottoResult[0]?.status?.toString() !== 'SUCCESS') {
		console.error('❌ Adding LazyLotto to LazyGasStation failed');
		if (addLottoResult[2]) {
			console.log(parseTransactionRecord(addLottoResult[2]));
		}
		process.exit(1);
	}

	console.log('✅ LazyLotto added to LazyGasStation');
	if (addLottoResult[2]) {
		console.log(parseTransactionRecord(addLottoResult[2]));
	}
}

// Step 10: Fund LazyGasStation (optional)
async function fundLazyGasStation() {
	console.log('\n⚙️  Step 9: Fund LazyGasStation (Optional)');
	console.log('-----------------------------------------');

	const fundAmount = await prompt('Enter HBAR amount to fund LazyGasStation (or press Enter to skip): ');

	if (!fundAmount || parseFloat(fundAmount) <= 0) {
		console.log('⏭️  Skipping LazyGasStation funding');
		return;
	}

	console.log(`🔨 Sending ${fundAmount} HBAR to LazyGasStation...`);

	const transferTx = await new TransferTransaction()
		.addHbarTransfer(operatorId, -parseFloat(fundAmount))
		.addHbarTransfer(AccountId.fromString(deployedContracts.lazyGasStation.toString()), parseFloat(fundAmount))
		.execute(client);

	const receipt = await transferTx.getReceipt(client);

	if (receipt.status.toString() !== 'SUCCESS') {
		console.error('❌ HBAR transfer failed:', receipt.status.toString());
		process.exit(1);
	}

	console.log(`✅ Sent ${fundAmount} HBAR to LazyGasStation`);
}

// Step 10: Deploy LazyLottoPoolManager
async function deployPoolManager() {
	console.log('\n📦 Step 10: LazyLottoPoolManager');
	console.log('---------------------------------');

	if (process.env.LAZY_LOTTO_POOL_MANAGER_ID) {
		deployedContracts.poolManager = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
		console.log(`✅ Found existing LazyLottoPoolManager: ${deployedContracts.poolManager.toString()}`);

		const useExisting = await prompt('❓ Use existing LazyLottoPoolManager? (yes/no): ');
		if (useExisting.toLowerCase() !== 'yes' && useExisting.toLowerCase() !== 'y') {
			console.log('🛑 Please update your .env file to remove LAZY_LOTTO_POOL_MANAGER_ID or deploy a new one manually.');
			process.exit(0);
		}
		console.log('✅ Using existing contract');
	}
	else {
		console.log('⚠️  No existing LazyLottoPoolManager found in .env');
		const deployNew = await prompt('❓ Deploy new LazyLottoPoolManager? (yes/no): ');
		if (deployNew.toLowerCase() !== 'yes' && deployNew.toLowerCase() !== 'y') {
			console.log('🛑 Deployment cancelled. Please set LAZY_LOTTO_POOL_MANAGER_ID in .env to use an existing contract.');
			process.exit(0);
		}

		console.log('🔨 Deploying LazyLottoPoolManager...');

		const poolManagerJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${poolManagerContractName}.sol/${poolManagerContractName}.json`,
			),
		);

		const sizeKB = (poolManagerJson.bytecode.length / 2 / 1024);
		console.log(`   Contract size: ${sizeKB.toFixed(3)} KB (limit: 24 KB)`);

		if (sizeKB > 24) {
			console.warn('⚠️  WARNING: Contract exceeds 24 KB Hedera limit!');
			process.exit(1);
		}

		const constructorParams = new ContractFunctionParameters()
			.addAddress(deployedContracts.lazyToken.toSolidityAddress())
			.addAddress(deployedContracts.lazyGasStation.toSolidityAddress())
			.addAddress(deployedContracts.lazyDelegateRegistry.toSolidityAddress());

		const [poolManagerId, poolManagerAddress, deployPMRecord] = await contractDeployFunction(
			client,
			poolManagerJson.bytecode,
			2_500_000,
			constructorParams,
		);

		deployedContracts.poolManager = poolManagerId;
		console.log(`✅ LazyLottoPoolManager deployed: ${poolManagerId.toString()}`);
		console.log(`   Address: ${poolManagerAddress}`);
		if (deployPMRecord) {
			console.log(parseTransactionRecord(deployPMRecord));
		}
	}

	// Load interface
	const poolManagerJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${poolManagerContractName}.sol/${poolManagerContractName}.json`,
		),
	);
	poolManagerIface = new ethers.Interface(poolManagerJson.abi);
}

// Step 11: Link LazyLotto and LazyLottoPoolManager (bidirectional)
async function linkPoolManager() {
	console.log('\n⚙️  Step 11: Link LazyLotto ↔ LazyLottoPoolManager');
	console.log('--------------------------------------------------');

	await sleep(5000);

	// Set LazyLotto in PoolManager
	console.log('🔨 Setting LazyLotto address in PoolManager...');

	const setLazyLottoResult = await contractExecuteFunction(
		deployedContracts.poolManager,
		poolManagerIface,
		client,
		150_000,
		'setLazyLotto',
		[deployedContracts.lazyLotto.toSolidityAddress()],
	);

	if (setLazyLottoResult[0]?.status?.toString() !== 'SUCCESS') {
		console.error('❌ setLazyLotto failed');
		if (setLazyLottoResult[2]) {
			console.log(parseTransactionRecord(setLazyLottoResult[2]));
		}
		process.exit(1);
	}

	console.log('✅ LazyLotto address set in PoolManager');
	if (setLazyLottoResult[2]) {
		console.log(parseTransactionRecord(setLazyLottoResult[2]));
	}

	await sleep(3000);

	// Set PoolManager in LazyLotto
	console.log('🔨 Setting PoolManager address in LazyLotto...');

	const setPoolManagerResult = await contractExecuteFunction(
		deployedContracts.lazyLotto,
		lazyLottoIface,
		client,
		150_000,
		'setPoolManager',
		[deployedContracts.poolManager.toSolidityAddress()],
	);

	if (setPoolManagerResult[0]?.status?.toString() !== 'SUCCESS') {
		console.error('❌ setPoolManager failed');
		if (setPoolManagerResult[2]) {
			console.log(parseTransactionRecord(setPoolManagerResult[2]));
		}
		process.exit(1);
	}

	console.log('✅ PoolManager address set in LazyLotto');
	if (setPoolManagerResult[2]) {
		console.log(parseTransactionRecord(setPoolManagerResult[2]));
	}

	await sleep(5000);

	// Verify bidirectional linkage
	console.log('\n🔍 Verifying bidirectional linkage...');

	let encodedCommand = lazyLottoIface.encodeFunctionData('poolManager');
	let result = await readOnlyEVMFromMirrorNode(env, deployedContracts.lazyLotto, encodedCommand, operatorId, false);
	const poolManagerFromLazyLotto = lazyLottoIface.decodeFunctionResult('poolManager', result);

	encodedCommand = poolManagerIface.encodeFunctionData('lazyLotto');
	result = await readOnlyEVMFromMirrorNode(env, deployedContracts.poolManager, encodedCommand, operatorId, false);
	const lazyLottoFromPoolManager = poolManagerIface.decodeFunctionResult('lazyLotto', result);

	const poolManagerMatch = poolManagerFromLazyLotto[0].slice(2).toLowerCase() === deployedContracts.poolManager.toSolidityAddress();
	const lazyLottoMatch = lazyLottoFromPoolManager[0].slice(2).toLowerCase() === deployedContracts.lazyLotto.toSolidityAddress();

	console.log(`   LazyLotto → PoolManager: ${poolManagerMatch ? '✅' : '❌'}`);
	console.log(`   PoolManager → LazyLotto: ${lazyLottoMatch ? '✅' : '❌'}`);

	if (!poolManagerMatch || !lazyLottoMatch) {
		console.error('\n❌ Bidirectional linkage verification failed!');
		process.exit(1);
	}

	console.log('✅ Bidirectional linkage verified');
}

// Step 12: Verification
async function verifyDeployment() {
	console.log('\n✅ Deployment Verification');
	console.log('===========================\n');

	// Verify LazyLotto immutable variables
	console.log('🔍 Verifying LazyLotto configuration...');

	let encodedCommand = lazyLottoIface.encodeFunctionData('lazyToken');
	let result = await readOnlyEVMFromMirrorNode(env, deployedContracts.lazyLotto, encodedCommand, operatorId, false);
	const lazyTokenAddr = lazyLottoIface.decodeFunctionResult('lazyToken', result);
	const lazyTokenMatch = lazyTokenAddr[0].slice(2).toLowerCase() === deployedContracts.lazyToken.toSolidityAddress();

	console.log(`   lazyToken: ${lazyTokenMatch ? '✅' : '❌'} ${deployedContracts.lazyToken.toString()}`);

	encodedCommand = lazyLottoIface.encodeFunctionData('lazyGasStation');
	result = await readOnlyEVMFromMirrorNode(env, deployedContracts.lazyLotto, encodedCommand, operatorId, false);
	const lazyGasStationAddr = lazyLottoIface.decodeFunctionResult('lazyGasStation', result);
	const lazyGasStationMatch = lazyGasStationAddr[0].slice(2).toLowerCase() === deployedContracts.lazyGasStation.toSolidityAddress();

	console.log(`   lazyGasStation: ${lazyGasStationMatch ? '✅' : '❌'} ${deployedContracts.lazyGasStation.toString()}`);

	encodedCommand = lazyLottoIface.encodeFunctionData('storageContract');
	result = await readOnlyEVMFromMirrorNode(env, deployedContracts.lazyLotto, encodedCommand, operatorId, false);
	const storageAddr = lazyLottoIface.decodeFunctionResult('storageContract', result);
	const storageMatch = storageAddr[0].slice(2).toLowerCase() === deployedContracts.lazyLottoStorage.toSolidityAddress();

	console.log(`   storageContract: ${storageMatch ? '✅' : '❌'} ${deployedContracts.lazyLottoStorage.toString()}`);

	// Verify admin
	encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);
	result = await readOnlyEVMFromMirrorNode(env, deployedContracts.lazyLotto, encodedCommand, operatorId, false);
	const isAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', result);

	console.log(`   Deployer is admin: ${isAdmin[0] ? '✅' : '❌'}`);

	// Verify pool manager linkage (if pool manager is deployed)
	if (deployedContracts.poolManager) {
		console.log('\n🔍 Verifying LazyLottoPoolManager linkage...');

		encodedCommand = lazyLottoIface.encodeFunctionData('poolManager');
		result = await readOnlyEVMFromMirrorNode(env, deployedContracts.lazyLotto, encodedCommand, operatorId, false);
		const poolManagerFromLazyLotto = lazyLottoIface.decodeFunctionResult('poolManager', result);
		const poolManagerFromLazyLottoMatch = poolManagerFromLazyLotto[0].slice(2).toLowerCase() === deployedContracts.poolManager.toSolidityAddress();

		encodedCommand = poolManagerIface.encodeFunctionData('lazyLotto');
		result = await readOnlyEVMFromMirrorNode(env, deployedContracts.poolManager, encodedCommand, operatorId, false);
		const lazyLottoFromPoolManager = poolManagerIface.decodeFunctionResult('lazyLotto', result);
		const lazyLottoFromPoolManagerMatch = lazyLottoFromPoolManager[0].slice(2).toLowerCase() === deployedContracts.lazyLotto.toSolidityAddress();

		console.log(`   LazyLotto → PoolManager: ${poolManagerFromLazyLottoMatch ? '✅' : '❌'} ${deployedContracts.poolManager.toString()}`);
		console.log(`   PoolManager → LazyLotto: ${lazyLottoFromPoolManagerMatch ? '✅' : '❌'} ${deployedContracts.lazyLotto.toString()}`);

		if (!lazyTokenMatch || !lazyGasStationMatch || !storageMatch || !isAdmin[0] || !poolManagerFromLazyLottoMatch || !lazyLottoFromPoolManagerMatch) {
			console.error('\n❌ Verification failed! Check configuration.');
			process.exit(1);
		}
	}
	else if (!lazyTokenMatch || !lazyGasStationMatch || !storageMatch || !isAdmin[0]) {
		console.error('\n❌ Verification failed! Check configuration.');
		process.exit(1);
	}

	console.log('\n✅ All verifications passed!');
}

// Main deployment flow
async function main() {
	try {
		await initializeClient();

		// If verify-only mode, skip deployment and just verify
		if (verifyOnly) {
			console.log('\n🔍 VERIFICATION ONLY MODE');
			console.log('===================================\n');
			console.log('⚠️  Skipping deployment steps...\n');

			// Load existing contract IDs from environment
			if (!process.env.LAZY_TOKEN_ID) throw new Error('LAZY_TOKEN_ID required for verification');
			if (!process.env.LAZY_GAS_STATION_CONTRACT_ID) throw new Error('LAZY_GAS_STATION_CONTRACT_ID required for verification');
			if (!process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) throw new Error('LAZY_DELEGATE_REGISTRY_CONTRACT_ID required for verification');
			if (!process.env.PRNG_CONTRACT_ID) throw new Error('PRNG_CONTRACT_ID required for verification');
			if (!process.env.LAZY_LOTTO_STORAGE) throw new Error('LAZY_LOTTO_STORAGE required for verification');
			if (!process.env.LAZY_LOTTO_CONTRACT_ID) throw new Error('LAZY_LOTTO_CONTRACT_ID required for verification');
			if (!process.env.LAZY_LOTTO_POOL_MANAGER_ID) throw new Error('LAZY_LOTTO_POOL_MANAGER_ID required for verification');

			deployedContracts.lazyToken = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			deployedContracts.lazySCT = process.env.LAZY_SCT_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID) : null;
			deployedContracts.lazyGasStation = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
			deployedContracts.lazyDelegateRegistry = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
			deployedContracts.prng = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
			deployedContracts.lazyLottoStorage = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);
			deployedContracts.lazyLotto = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
			deployedContracts.poolManager = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);

			// Load interfaces for verification
			const lazyLottoJson = JSON.parse(fs.readFileSync(`./abi/${contractName}.json`));
			lazyLottoIface = new ethers.Interface(lazyLottoJson);

			const lazyLottoStorageJson = JSON.parse(fs.readFileSync(`./abi/${storageContractName}.json`));
			lazyLottoStorageIface = new ethers.Interface(lazyLottoStorageJson);

			const poolManagerJson = JSON.parse(fs.readFileSync(`./abi/${poolManagerContractName}.json`));
			poolManagerIface = new ethers.Interface(poolManagerJson);

			await verifyDeployment();

			console.log('\n✅ Verification Complete!');
			process.exit(0);
		}

		// Normal deployment flow
		await deployLazyToken();
		await deployLazyGasStation();
		await deployLazyDelegateRegistry();
		await deployPRNG();
		await deployLazyLottoStorage();
		await deployLazyLotto();
		await setContractUser();
		await addContractUsersToGasStation();
		await fundLazyGasStation();
		await deployPoolManager();
		await linkPoolManager();
		await verifyDeployment();

		// Save deployment addresses
		saveDeploymentAddresses();

		console.log('\n🎉 LazyLotto Deployment Complete!');
		console.log('===================================\n');
		console.log('📝 Deployed Contracts:');
		console.log(`   LAZY Token:           ${deployedContracts.lazyToken.toString()}`);
		console.log(`   LAZY SCT:             ${deployedContracts.lazySCT.toString()}`);
		console.log(`   LazyGasStation:       ${deployedContracts.lazyGasStation.toString()}`);
		console.log(`   LazyDelegateRegistry: ${deployedContracts.lazyDelegateRegistry.toString()}`);
		console.log(`   PRNG:                 ${deployedContracts.prng.toString()}`);
		console.log(`   LazyLottoStorage:     ${deployedContracts.lazyLottoStorage.toString()}`);
		console.log(`   LazyLotto:            ${deployedContracts.lazyLotto.toString()}`);
		console.log(`   LazyLottoPoolManager: ${deployedContracts.poolManager.toString()}`);

		console.log('\n📋 Next Steps:');
		console.log('   1. Update .env with deployed contract IDs');
		console.log('   2. Create lottery pools using admin functions');
		console.log('   3. Add prize packages to pools');
		console.log('   4. Test with small amounts before production use');

		process.exit(0);
	}
	catch (error) {
		console.error('\n❌ Deployment failed:', error);
		process.exit(1);
	}
}

// Run deployment
if (require.main === module) {
	main();
}

module.exports = main;
