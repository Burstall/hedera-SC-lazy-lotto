/**
 * Interactive LazyLotto Deployment Script
 *
 * This script handles deployment of LazyLotto and all its dependencies to Hedera.
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
 *
 * For verification-only mode:
 * - VERIFY_ONLY=true (skips deployment, only runs verification)
 *
 * Usage:
 * npm run deploy:lazylotto
 *
 * Or directly:
 * node scripts/deployments/deployLazyLotto.js
 *
 * Verification only:
 * VERIFY_ONLY=true node scripts/deployments/deployLazyLotto.js
 */

const fs = require('fs');
const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
const { contractDeployFunction, contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { estimateGas } = require('../../utils/gasHelpers');
const { ethers } = require('ethers');

// Load environment variables
require('dotenv').config();

// Configuration
const contractName = process.env.CONTRACT_NAME ?? 'LazyLotto';
const storageContractName = process.env.STORAGE_CONTRACT_NAME ?? 'LazyLottoStorage';
const lazyGasStationName = 'LazyGasStation';
const lazyDelegateRegistryName = 'LazyDelegateRegistry';
const prngContractName = 'PrngSystemContract';
const lazyContractCreator = 'LAZYTokenCreator';

const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'TEST';
const verifyOnly = process.env.VERIFY_ONLY === 'true';

// Deployment configuration
// 0% burn for standard LAZY token
const LAZY_BURN_PERCENT = 0;
// 1 billion LAZY tokens
const LAZY_MAX_SUPPLY = 1_000_000_000;
const LAZY_DECIMAL = 8;
// 20 HBAR for token creation
const MINT_PAYMENT = 20;

// Track deployed contracts
const deployedContracts = {
	lazyToken: null,
	lazySCT: null,
	lazyGasStation: null,
	lazyDelegateRegistry: null,
	prng: null,
	lazyLottoStorage: null,
	lazyLotto: null,
};

// Interfaces
let lazyIface, lazyGasStationIface, lazyLottoStorageIface, lazyLottoIface;
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
	const readline = require('readline').createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => {
		readline.question(question, answer => {
			readline.close();
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

	if (env.toUpperCase() === 'TEST') {
		client = Client.forTestnet();
		console.log('   Network: TESTNET');
	}
	else if (env.toUpperCase() === 'MAIN') {
		client = Client.forMainnet();
		console.log('   Network: MAINNET');
		const confirm = await prompt('⚠️  WARNING: You are deploying to MAINNET. Type "MAINNET" to confirm: ');
		if (confirm !== 'MAINNET') {
			console.log('❌ Deployment cancelled.');
			process.exit(0);
		}
	}
	else if (env.toUpperCase() === 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('   Network: PREVIEWNET');
	}
	else {
		console.error(`❌ Unknown environment: ${env}`);
		process.exit(1);
	}

	client.setOperator(operatorId, operatorKey);
	console.log(`👤 Operator: ${operatorId.toString()}\n`);
}

// Step 2: Deploy or reuse LAZY token and SCT
async function deployLazyToken() {
	console.log('\n📦 Step 1: LAZY Token & SCT');
	console.log('----------------------------');

	if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
		deployedContracts.lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
		deployedContracts.lazyToken = TokenId.fromString(process.env.LAZY_TOKEN_ID);
		console.log(`✅ Using existing LAZY Token: ${deployedContracts.lazyToken.toString()}`);
		console.log(`✅ Using existing LAZY SCT: ${deployedContracts.lazySCT.toString()}`);
	}
	else {
		console.log('🔨 Deploying LAZY Token Creator (SCT)...');

		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);
		lazyIface = new ethers.Interface(lazyJson.abi);

		const lazyConstructorParams = new ContractFunctionParameters()
			.addUint256(LAZY_BURN_PERCENT);

		const [lazySCT] = await contractDeployFunction(
			client,
			lazyJson.bytecode,
			3_500_000,
			lazyConstructorParams,
		);

		deployedContracts.lazySCT = lazySCT;
		console.log(`✅ LAZY SCT deployed: ${lazySCT.toString()}`);

		await sleep(3000);

		console.log('🔨 Creating LAZY fungible token...');
		const mintLazyResult = await contractExecuteFunction(
			lazySCT,
			lazyIface,
			client,
			800_000,
			'createFungibleWithBurn',
			[
				'LAZY',
				'$LAZY',
				'Lazy Superheroes Token',
				LAZY_MAX_SUPPLY,
				LAZY_DECIMAL,
				LAZY_MAX_SUPPLY,
			],
			MINT_PAYMENT,
		);

		if (mintLazyResult[0]?.status?.toString() !== 'SUCCESS') {
			console.error('❌ LAZY token creation failed:', mintLazyResult[0]?.status?.toString());
			process.exit(1);
		}

		deployedContracts.lazyToken = TokenId.fromSolidityAddress(mintLazyResult[1][0]);
		console.log(`✅ LAZY Token created: ${deployedContracts.lazyToken.toString()}`);
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
		console.log(`✅ Using existing LazyGasStation: ${deployedContracts.lazyGasStation.toString()}`);
	}
	else {
		console.log('🔨 Deploying LazyGasStation...');

		const lazyGasStationJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);

		const gasStationConstructorParams = new ContractFunctionParameters()
			.addAddress(deployedContracts.lazyToken.toSolidityAddress())
			.addAddress(deployedContracts.lazySCT.toSolidityAddress());

		const [lazyGasStationId] = await contractDeployFunction(
			client,
			lazyGasStationJson.bytecode,
			4_000_000,
			gasStationConstructorParams,
		);

		deployedContracts.lazyGasStation = lazyGasStationId;
		console.log(`✅ LazyGasStation deployed: ${lazyGasStationId.toString()}`);
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
		console.log(`✅ Using existing LazyDelegateRegistry: ${deployedContracts.lazyDelegateRegistry.toString()}`);
	}
	else {
		console.log('🔨 Deploying LazyDelegateRegistry...');

		const lazyDelegateRegistryJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
			),
		);

		const [lazyDelegateRegistryId] = await contractDeployFunction(
			client,
			lazyDelegateRegistryJson.bytecode,
			2_100_000,
		);

		deployedContracts.lazyDelegateRegistry = lazyDelegateRegistryId;
		console.log(`✅ LazyDelegateRegistry deployed: ${lazyDelegateRegistryId.toString()}`);
	}
}

// Step 5: Deploy PRNG
async function deployPRNG() {
	console.log('\n📦 Step 4: PRNG Generator');
	console.log('-------------------------');

	if (process.env.PRNG_CONTRACT_ID) {
		deployedContracts.prng = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
		console.log(`✅ Using existing PRNG: ${deployedContracts.prng.toString()}`);
	}
	else {
		console.log('🔨 Deploying PRNG Generator...');

		const prngJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${prngContractName}.sol/${prngContractName}.json`,
			),
		);

		const [prngId] = await contractDeployFunction(
			client,
			prngJson.bytecode,
			1_800_000,
		);

		deployedContracts.prng = prngId;
		console.log(`✅ PRNG deployed: ${prngId.toString()}`);
	}
}

// Step 6: Deploy LazyLottoStorage
async function deployLazyLottoStorage() {
	console.log('\n📦 Step 5: LazyLottoStorage');
	console.log('---------------------------');

	if (process.env.LAZY_LOTTO_STORAGE) {
		deployedContracts.lazyLottoStorage = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);
		console.log(`✅ Using existing LazyLottoStorage: ${deployedContracts.lazyLottoStorage.toString()}`);
	}
	else {
		console.log('🔨 Deploying LazyLottoStorage...');

		const storageBytecode = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/${storageContractName}.sol/${storageContractName}.json`),
		).bytecode;

		const storageConstructorParams = new ContractFunctionParameters()
			.addAddress(deployedContracts.lazyGasStation.toSolidityAddress())
			.addAddress(deployedContracts.lazyToken.toSolidityAddress());

		const [storageContractId] = await contractDeployFunction(
			client,
			storageBytecode,
			3_500_000,
			storageConstructorParams,
		);

		deployedContracts.lazyLottoStorage = storageContractId;
		console.log(`✅ LazyLottoStorage deployed: ${storageContractId.toString()}`);
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
		console.log(`✅ Using existing LazyLotto: ${deployedContracts.lazyLotto.toString()}`);
		return;
	}

	console.log('🔨 Deploying LazyLotto main contract...');

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
		.addUint256(LAZY_BURN_PERCENT)
		.addAddress(deployedContracts.lazyLottoStorage.toSolidityAddress());

	const [contractId] = await contractDeployFunction(
		client,
		contractBytecode,
		gasLimit,
		constructorParams,
	);

	deployedContracts.lazyLotto = contractId;
	console.log(`✅ LazyLotto deployed: ${contractId.toString()}`);
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
		console.error('❌ setContractUser failed:', setContractUserResult);
		process.exit(1);
	}

	console.log('✅ LazyLotto set as contract user on storage');
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
		console.error('❌ Adding storage to LazyGasStation failed:', addStorageResult);
		process.exit(1);
	}

	console.log('✅ LazyLottoStorage added to LazyGasStation');

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
		console.error('❌ Adding LazyLotto to LazyGasStation failed:', addLottoResult);
		process.exit(1);
	}

	console.log('✅ LazyLotto added to LazyGasStation');
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

	const { TransferTransaction } = require('@hashgraph/sdk');

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

// Step 11: Verification
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

	if (!lazyTokenMatch || !lazyGasStationMatch || !storageMatch || !isAdmin[0]) {
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

			deployedContracts.lazyToken = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			deployedContracts.lazySCT = process.env.LAZY_SCT_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID) : null;
			deployedContracts.lazyGasStation = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
			deployedContracts.lazyDelegateRegistry = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
			deployedContracts.prng = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
			deployedContracts.lazyLottoStorage = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);
			deployedContracts.lazyLotto = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

			// Load interfaces for verification
			const lazyLottoJson = JSON.parse(fs.readFileSync(`./abi/${contractName}.json`));
			lazyLottoIface = new ethers.Interface(lazyLottoJson);

			const lazyLottoStorageJson = JSON.parse(fs.readFileSync(`./abi/${storageContractName}.json`));
			lazyLottoStorageIface = new ethers.Interface(lazyLottoStorageJson);

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
		await verifyDeployment();

		// Save deployment addresses
		saveDeploymentAddresses();

		console.log('\n🎉 LazyLotto Deployment Complete!');
		console.log('===================================\n');
		console.log('📝 Deployed Contracts:');
		console.log(`   LAZY Token:          ${deployedContracts.lazyToken.toString()}`);
		console.log(`   LAZY SCT:            ${deployedContracts.lazySCT.toString()}`);
		console.log(`   LazyGasStation:      ${deployedContracts.lazyGasStation.toString()}`);
		console.log(`   LazyDelegateRegistry: ${deployedContracts.lazyDelegateRegistry.toString()}`);
		console.log(`   PRNG:                ${deployedContracts.prng.toString()}`);
		console.log(`   LazyLottoStorage:    ${deployedContracts.lazyLottoStorage.toString()}`);
		console.log(`   LazyLotto:           ${deployedContracts.lazyLotto.toString()}`);

		console.log('\n📋 Next Steps:');
		console.log('   1. Update .env with deployed contract IDs');
		console.log('   2. Create lottery pools using admin functions');
		console.log('   3. Add prize packages to pools');
		console.log('   4. Test with small amounts before production use');
		console.log('   5. Consider setting up monitoring for contract events');

		process.exit(0);
	}
	catch (error) {
		console.error('\n❌ Deployment failed:', error);
		process.exit(1);
	}
}

// Run deployment
main();
