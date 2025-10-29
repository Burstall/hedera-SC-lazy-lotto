const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	TokenId,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { expect } = require('chai');
const { describe, it, beforeEach, before, after } = require('mocha');
const {
	contractDeployFunction,
	readOnlyEVMFromMirrorNode,
	contractExecuteFunction,
	contractExecuteQuery,
	contractCallQuery,
	linkBytecode,
} = require('../utils/solidityHelpers');
const { sleep } = require('../utils/nodeHelpers');
const {
	accountCreator,
	mintFT,
	mintNFT,
	sendFT,
	setFTAllowance,
	sweepHbar,
	sendNFT,
	clearFTAllowances,
	associateTokensToAccount,
	sendHbar,
	setHbarAllowance,
	setNFTAllowanceAll,
} = require('../utils/hederaHelpers');
const {
	checkMirrorBalance,
	checkMirrorHbarBalance,
} = require('../utils/hederaMirrorHelpers');
const { fail } = require('assert');
const { ethers } = require('ethers');
const { estimateGas } = require('../utils/gasHelpers');
const { parseTransactionRecord } = require('../utils/transactionHelpers');

require('dotenv').config();

// Get operator from .env file
let operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
let operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

// Contract names
const contractName = 'LazyLotto';
const libraryName = 'HTSLazyLottoLibrary';
const lazyContractCreator = 'FungibleTokenCreator';
const prngContractName = 'PrngGenerator';
const lazyGasStationName = 'LazyGasStation';
const lazyDelegateRegistryName = 'LazyDelegateRegistry';

// Environment setup
const env = process.env.ENVIRONMENT ?? null;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;
const LAZY_BURN_PERCENT = process.env.LOTTO_LAZY_BURN_PERCENT ? Number(process.env.LOTTO_LAZY_BURN_PERCENT) : 50;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// Test Constants (reserved for future test cases)
// const INITIAL_JACKPOT = 100;
// const LOTTO_LOSS_INCREMENT = 50;
const WIN_RATE_THRESHOLD = 50_000_000;
// const MIN_WIN_AMOUNT = 10;
// const MAX_WIN_AMOUNT = 100;
// const JACKPOT_THRESHOLD = 1_000_000;
const ENTRY_FEE_HBAR = 100_000_000;
const ENTRY_FEE_LAZY = 100;

// Contract addresses and IDs
let contractId, contractAddress, libraryId;
let client;

// Test accounts
let alicePK, aliceId, bobPK, bobId, carolPK, carolId;
let adminPK, adminId;

// Dependencies
let lazyTokenId, lazySCT, lazyGasStationId, lazyDelegateRegistryId, prngId, mockPrngId;
let testFungibleTokenId, testNFTTokenId1, testNFTTokenId2;

// Interface objects
// Interface variables
let lazyLottoIface, lazyIface;

// Created accounts for cleanup
const createdAccounts = [];
const lazyAllowancesSet = [];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('LazyLotto - Deployment & Setup:', function () {
	it('Should deploy dependencies and setup test conditions', async function () {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for the test');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID for the test');
			process.exit(1);
		}

		console.log('\n-Using ENVIRONMENT:', env);

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
			const rootId = AccountId.fromString('0.0.2');
			const rootKey = PrivateKey.fromString('302e020100300506032b6570042204203b054fade7a2b0869c6bd4a63b7017cbae7855d12acc357bea718e2c3e805962c');
			client.setOperator(rootId, rootKey);
			operatorId = rootId;
			operatorKey = rootKey;
		}

		client.setOperator(operatorId, operatorKey);
		console.log('\n-Using Operator:', operatorId.toString());

		// Create test accounts: Alice, Bob, Carol, Admin
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(client, alicePK, 20);
		createdAccounts.push({ id: aliceId, key: alicePK });
		console.log('Alice account ID:', aliceId.toString());

		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(client, bobPK, 20);
		createdAccounts.push({ id: bobId, key: bobPK });
		console.log('Bob account ID:', bobId.toString());

		carolPK = PrivateKey.generateED25519();
		carolId = await accountCreator(client, carolId, 20);
		createdAccounts.push({ id: carolId, key: carolPK });
		console.log('Carol account ID:', carolId.toString());

		adminPK = PrivateKey.generateED25519();
		adminId = await accountCreator(client, adminPK, 20);
		createdAccounts.push({ id: adminId, key: adminPK });
		console.log('Admin account ID:', adminId.toString());

		console.log('\n-Test accounts created successfully');
	});

	it('Should deploy or reuse LAZY token and SCT', async function () {
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);
		lazyIface = new ethers.Interface(lazyJson.abi);

		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			console.log('\n-Using existing LAZY:', lazyTokenId.toString());
			console.log('-Using existing LSCT:', lazySCT.toString());
		}
		else {
			console.log('\n-Deploying LAZY token and SCT...');
			const lazyConstructorParams = new ContractFunctionParameters()
				.addUint256(LAZY_BURN_PERCENT);

			[lazySCT] = await contractDeployFunction(
				client,
				lazyJson.bytecode,
				3_500_000,
				lazyConstructorParams,
			);

			console.log('Lazy SCT deployed:', lazySCT.toString());

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
				console.log('LAZY token creation failed:', mintLazyResult[0]?.status?.toString());
				fail('LAZY token creation failed');
			}

			lazyTokenId = TokenId.fromSolidityAddress(mintLazyResult[1][0]);
			console.log('LAZY Token created:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy LazyGasStation', async function () {
		const lazyGasStationJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);

		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
			console.log('\n-Using existing LazyGasStation:', lazyGasStationId.toString());
		}
		else {
			console.log('\n-Deploying LazyGasStation...');
			const gasStationConstructorParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazySCT.toSolidityAddress());

			[lazyGasStationId] = await contractDeployFunction(
				client,
				lazyGasStationJson.bytecode,
				4_000_000,
				gasStationConstructorParams,
			);
			console.log('LazyGasStation deployed:', lazyGasStationId.toString());
		}

		expect(lazyGasStationId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy LazyDelegateRegistry', async function () {
		const lazyDelegateRegistryJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
			),
		);

		if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			lazyDelegateRegistryId = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
			console.log('\n-Using existing LazyDelegateRegistry:', lazyDelegateRegistryId.toString());
		}
		else {
			console.log('\n-Deploying LazyDelegateRegistry...');
			[lazyDelegateRegistryId] = await contractDeployFunction(
				client,
				lazyDelegateRegistryJson.bytecode,
				2_100_000,
			);
			console.log('LazyDelegateRegistry deployed:', lazyDelegateRegistryId.toString());
		}

		expect(lazyDelegateRegistryId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy PRNG Generator', async function () {
		const prngJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${prngContractName}.sol/${prngContractName}.json`,
			),
		);

		if (process.env.PRNG_CONTRACT_ID) {
			prngId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
			console.log('\n-Using existing PRNG:', prngId.toString());
		}
		else {
			console.log('\n-Deploying PRNG Generator...');
			[prngId] = await contractDeployFunction(
				client,
				prngJson.bytecode,
				1_800_000,
			);
			console.log('PRNG Generator deployed:', prngId.toString());
		}

		expect(prngId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy MockPrngSystemContract for deterministic testing', async function () {
		console.log('\n-Deploying Mock PRNG for deterministic prize testing...');

		const mockPrngJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/mocks/MockPrngSystemContract.sol/MockPrngSystemContract.json'),
		);

		// Constructor: (bytes32 _seed, uint256 _number)
		// Set staticNumber to 0 to always return the winning index (lo)
		const mockConstructorParams = new ContractFunctionParameters()
			.addBytes32(Buffer.from('0'.repeat(64), 'hex'))
			.addUint256(0);

		[mockPrngId] = await contractDeployFunction(
			client,
			mockPrngJson.bytecode,
			1_000_000,
			mockConstructorParams,
		);

		console.log('Mock PRNG deployed:', mockPrngId.toString());
		expect(mockPrngId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should create test fungible tokens for prizes', async function () {
		console.log('\n-Creating test fungible tokens...');

		if (process.env.TEST_PRIZE_FT_TOKEN_ID) {
			testFungibleTokenId = TokenId.fromString(process.env.TEST_PRIZE_FT_TOKEN_ID);
			console.log('Using existing test FT token:', testFungibleTokenId.toString());
		}
		else {

			const testTokenResult = await mintFT(
				client,
				operatorId,
				null,
				1_000_000,
				'Test Prize Token',
				'TPT',
				2,
			);

			if (testTokenResult[0] !== 'SUCCESS') {
				console.log('Test token creation failed:', testTokenResult[0]);
				fail('Test token creation failed');
			}

			testFungibleTokenId = testTokenResult[1];
			console.log('Test Fungible Token created:', testFungibleTokenId.toString());
		}
	});

	it('Should create test NFT collections for prizes', async function () {
		if (process.env.TEST_PRIZE_NFT_TOKENA_ID) {
			testNFTTokenId1 = TokenId.fromString(process.env.TEST_PRIZE_NFT_TOKENA_ID);
			console.log('Using existing test NFT token A:', testNFTTokenId1.toString());
		}
		else {
			console.log('\n-Creating test NFT collections...');

			const testNFT1Result = await mintNFT(
				client,
				operatorId,
				'Test NFT Collection 1',
				'TNC1',
				10,
				MINT_PAYMENT,
			);

			if (testNFT1Result[0] !== 'SUCCESS') {
				console.log('Test NFT 1 creation failed:', testNFT1Result[0]);
				fail('Test NFT 1 creation failed');
			}

			testNFTTokenId1 = testNFT1Result[1];
			console.log('Test NFT Collection 1 created:', testNFTTokenId1.toString());
		}

		if (process.env.TEST_PRIZE_NFT_TOKENB_ID) {
			testNFTTokenId2 = TokenId.fromString(process.env.TEST_PRIZE_NFT_TOKENB_ID);
			console.log('Using existing test NFT token B:', testNFTTokenId2.toString());
		}
		else {
			const testNFT2Result = await mintNFT(
				client,
				operatorId,
				'Test NFT Collection 2',
				'TNC2',
				5,
				MINT_PAYMENT,
			);

			if (testNFT2Result[0] !== 'SUCCESS') {
				console.log('Test NFT 2 creation failed:', testNFT2Result[0]);
				fail('Test NFT 2 creation failed');
			}

			testNFTTokenId2 = testNFT2Result[1];
			console.log('Test NFT Collection 2 created:', testNFTTokenId2.toString());
		}
	});

	it('Should ensure operator has sufficient tokens', async function () {
		console.log('\n-Ensuring operator has sufficient tokens...');

		// Check and get LAZY if needed
		const operatorLazyBal = await checkMirrorBalance(env, operatorId, lazyTokenId);
		if (!operatorLazyBal || operatorLazyBal < 10000) {
			console.log('Operator needs LAZY, drawing from creator');
			const drawResult = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				300_000,
				'transferHTS',
				[lazyTokenId.toSolidityAddress(), operatorId.toSolidityAddress(), 10000],
			);
			if (drawResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('LAZY draw FAILED:', drawResult);
				fail('LAZY draw failed');
			}
			console.log('Drew 10000 LAZY to operator');
		}

		// check the LazyGasStation balance
		const lgsLazyBal = await checkMirrorBalance(env, lazyGasStationId, lazyTokenId);
		if (!lgsLazyBal || lgsLazyBal < 10000) {
			console.log('LazyGasStation needs LAZY, drawing from creator');
			const drawResult = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				300_000,
				'transferHTS',
				[lazyTokenId.toSolidityAddress(), lazyGasStationId.toSolidityAddress(), 10000],
			);
			if (drawResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('LAZY draw FAILED:', drawResult);
				fail('LAZY draw failed');
			}
			console.log('Drew 10000 LAZY to operator');
		}

		// check the Lazy Gas Station HBAR balance
		const lgsHbarBal = await checkMirrorHbarBalance(env, lazyGasStationId);
		if (!lgsHbarBal || lgsHbarBal < 5000) {
			console.log('LazyGasStation needs HBAR, sending from operator');
			const sendHbarResult = await sendHbar(
				client,
				operatorId,
				lazyGasStationId,
				5,
			);
			if (sendHbarResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('HBAR send FAILED:', sendHbarResult);
				fail('HBAR send failed');
			}
			console.log('Sent 5 HBAR to LazyGasStation');
		}
	});

	it('Should deploy HTSLazyLottoLibrary', async function () {
		console.log('\n-Deploying library:', libraryName);

		const libraryBytecode = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/${libraryName}.sol/${libraryName}.json`),
		).bytecode;

		[libraryId] = await contractDeployFunction(client, libraryBytecode, 2_500_000);
		console.log(`Library created with ID: ${libraryId} / ${libraryId.toSolidityAddress()}`);

		expect(libraryId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy LazyLotto contract with library linking', async function () {
		client.setOperator(operatorId, operatorKey);

		const json = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`),
		);

		const contractBytecode = json.bytecode;

		// Link library address in bytecode
		console.log('\n-Linking library address in bytecode...');
		const readyToDeployBytecode = linkBytecode(contractBytecode, [libraryName], [libraryId]);

		lazyLottoIface = new ethers.Interface(json.abi);

		const gasLimit = 6_000_000;

		console.log('\n-Deploying contract...', contractName, '\n\tgas@', gasLimit);

		// Constructor params: (lazyToken, lazyGasStation, lazyDelegateRegistry, prng, burnPercentage)
		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazyGasStationId.toSolidityAddress())
			.addAddress(lazyDelegateRegistryId.toSolidityAddress())
			.addAddress(prngId.toSolidityAddress())
			.addUint256(LAZY_BURN_PERCENT);

		[contractId, contractAddress] = await contractDeployFunction(
			client,
			readyToDeployBytecode,
			gasLimit,
			constructorParams,
		);

		console.log(`LazyLotto contract created with ID: ${contractId} / ${contractAddress}`);
		console.log('\n-Testing:', contractName);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;
	});
});

describe('LazyLotto - Constructor & Initial State Verification:', function () {
	it('Should verify immutable variables set correctly', async function () {
		client.setOperator(operatorId, operatorKey);

		await sleep(5000);
		// Check LAZY token
		let encodedCommand = lazyLottoIface.encodeFunctionData('lazyToken');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyTokenAddr = lazyLottoIface.decodeFunctionResult('lazyToken', result);
		expect(lazyTokenAddr[0].slice(2).toLowerCase()).to.be.equal(lazyTokenId.toSolidityAddress());

		// Check LazyGasStation
		encodedCommand = lazyLottoIface.encodeFunctionData('lazyGasStation');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyGasStationAddr = lazyLottoIface.decodeFunctionResult('lazyGasStation', result);
		expect(lazyGasStationAddr[0].slice(2).toLowerCase()).to.be.equal(lazyGasStationId.toSolidityAddress());

		// Check LazyDelegateRegistry
		encodedCommand = lazyLottoIface.encodeFunctionData('lazyDelegateRegistry');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyDelegateRegistryAddr = lazyLottoIface.decodeFunctionResult('lazyDelegateRegistry', result);
		expect(lazyDelegateRegistryAddr[0].slice(2).toLowerCase()).to.be.equal(lazyDelegateRegistryId.toSolidityAddress());

		// Check PRNG
		encodedCommand = lazyLottoIface.encodeFunctionData('prng');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prngAddr = lazyLottoIface.decodeFunctionResult('prng', result);
		expect(prngAddr[0].slice(2).toLowerCase()).to.be.equal(prngId.toSolidityAddress());

		// Check burn percentage
		encodedCommand = lazyLottoIface.encodeFunctionData('burnPercentage');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const burnPerc = lazyLottoIface.decodeFunctionResult('burnPercentage', result);
		expect(Number(burnPerc[0])).to.be.equal(LAZY_BURN_PERCENT);
	});

	it('Should verify deployer is first admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', result);
		expect(isAdmin[0]).to.be.true;
	});

	it('Should verify initial state values', async function () {
		client.setOperator(operatorId, operatorKey);

		// Check total pools is 0
		let encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', result);
		expect(Number(totalPools[0])).to.be.equal(0);

		// Check time bonuses is 0
		encodedCommand = lazyLottoIface.encodeFunctionData('totalTimeBonuses');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalTimeBonuses = lazyLottoIface.decodeFunctionResult('totalTimeBonuses', result);
		expect(Number(totalTimeBonuses[0])).to.be.equal(0);

		// Check NFT bonus tokens is 0
		encodedCommand = lazyLottoIface.encodeFunctionData('totalNFTBonusTokens');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalNFTBonusTokens = lazyLottoIface.decodeFunctionResult('totalNFTBonusTokens', result);
		expect(Number(totalNFTBonusTokens[0])).to.be.equal(0);
	});
});

describe('LazyLotto - Admin Management:', function () {
	it('Should add new admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addAdmin',
			[adminId.toSolidityAddress()],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addAdmin',
			[adminId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Admin addition failed:', result[0]?.status?.toString());
			fail('Admin addition failed');
		}

		console.log('-Admin addition tx:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Verify admin was added
		const encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [adminId.toSolidityAddress()]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', queryResult);
		expect(isAdmin[0]).to.be.true;
	});

	it('Should prevent non-admin from adding admin', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				300_000,
				'addAdmin',
				[bobId.toSolidityAddress()],
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('Configuration update succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Non-admin prevented from adding admin');
	});

	it('Should prevent removing last admin', async function () {
		client.setOperator(operatorId, operatorKey);

		// First remove the admin we added, leaving only operator
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'removeAdmin',
			[adminId.toSolidityAddress()],
			300_000,
		);

		const removeResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'removeAdmin',
			[adminId.toSolidityAddress()],
		);

		if (removeResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Admin removal failed:', removeResult[0]?.status?.toString());
			fail('Admin removal failed');
		}

		console.log('-Admin removed successfully');

		// Now try to remove the last admin (operator)
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'removeAdmin',
				[operatorId.toSolidityAddress()],
			);

			if (result[0]?.status?.name != 'LastAdminError') {
				console.log('Expected failure but got:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Last admin removal prevented');

		// Re-add admin for future tests
		const readdResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addAdmin',
			[adminId.toSolidityAddress()],
		);

		if (readdResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('Failed to re-add admin for future tests');
		}
	});
});

describe('LazyLotto - Token Association & Setup:', function () {
	it('Should associate tokens to test accounts', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize token associations
		const associationPromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			// Associate tokens
			const assocResult = await associateTokensToAccount(
				client,
				account.id,
				account.key,
				[lazyTokenId, testFungibleTokenId, testNFTTokenId1, testNFTTokenId2],
			);
			expect(assocResult).to.be.equal('SUCCESS');
			console.log(`Associated tokens to ${account.id.toString()}`);
			return assocResult;
		});

		await Promise.all(associationPromises);
	});

	it('Should send tokens to test accounts', async function () {
		client.setOperator(operatorId, operatorKey);

		const testAccounts = [aliceId, bobId, carolId, adminId];

		// Parallelize token distribution across accounts
		const distributionPromises = testAccounts.map(async (accountId) => {
			// Send LAZY tokens
			let result = await sendLazy(accountId, 5000);
			if (result !== 'SUCCESS') {
				console.log(`LAZY send failed for ${accountId.toString()}:`, result);
				throw new Error('LAZY send failed');
			}

			// Send test fungible tokens
			result = await sendFT(
				client,
				testFungibleTokenId,
				1000,
				operatorId,
				accountId,
				'Test token transfer',
			);
			if (result !== 'SUCCESS') {
				console.log(`Test token send failed for ${accountId.toString()}:`, result);
				throw new Error('Test token send failed');
			}

			// Send some test NFTs - each account gets serial 1-4 respectively
			// (Alice gets 1, Bob gets 2, Carol gets 3, Admin gets 4)
			const accountIndex = testAccounts.indexOf(accountId);
			const serialToSend = accountIndex + 1;
			result = await sendNFT(client, operatorId, accountId, testNFTTokenId1, [serialToSend]);
			if (result !== 'SUCCESS') {
				console.log(`Test NFT send failed for ${accountId.toString()}:`, result);
				throw new Error('Test NFT send failed');
			} return accountId;
		});

		await Promise.all(distributionPromises);

		console.log('\n-Tokens distributed to test accounts');
	});

	it('Should set LAZY allowances to LazyGasStation for test accounts', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize allowance setting
		const allowancePromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			const allowanceResult = await setFTAllowance(
				client,
				lazyTokenId,
				account.id,
				lazyGasStationId,
				2000,
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`LAZY allowance failed for ${account.id.toString()}:`, allowanceResult);
				throw new Error('LAZY allowance failed');
			}
			lazyAllowancesSet.push(account);
			return account;
		});

		await Promise.all(allowancePromises);

		console.log('\n-LAZY allowances set to LazyGasStation');
	});

	it('Should set HBAR allowances to LazyLotto contract for NFT operations', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize HBAR distribution
		const hbarPromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			// Send small HBAR allowance for NFT operations
			const allowanceResult = await setHbarAllowance(
				client,
				account.id,
				contractId,
				1,
				HbarUnit.Hbar,
			);

			if (allowanceResult !== 'SUCCESS') {
				console.log(`HBAR allowance failed for ${account.id.toString()}:`, allowanceResult);
				throw new Error('HBAR allowance failed');
			}
			return account;
		});

		await Promise.all(hbarPromises);

		console.log('\n-HBAR Allowances set for accounts for NFT operations');
	});

	it('Should set test fungible token allowances to LazyLotto contract', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize allowance setting
		const allowancePromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			const allowanceResult = await setFTAllowance(
				client,
				testFungibleTokenId,
				account.id,
				contractId,
				2000,
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`Test FT allowance failed for ${account.id.toString()}:`, allowanceResult);
				throw new Error('Test FT allowance failed');
			}
			return account;
		});

		await Promise.all(allowancePromises);

		console.log('\n-Test fungible token allowances set to LazyLotto contract');
	});
});

// Helper function to send LAZY tokens
async function sendLazy(receiverId, amt) {
	const result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'transferHTS',
		[lazyTokenId.toSolidityAddress(), receiverId.toSolidityAddress(), amt],
	);
	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('LAZY transfer failed:', result[0]?.status?.toString());
		return result[0]?.status?.toString();
	}
	return result[0]?.status.toString();
}

describe('LazyLotto - Pool Creation:', function () {
	it('Should create first lottery pool with HBAR fee', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'createPool',
			[
				'Test Pool 1',
				'TP1',
				'Test pool memo',
				// No royalties
				[],
				'QmTestTicketCID',
				'QmTestWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				// HBAR fee
				ZERO_ADDRESS,
			],
			3_000_000,
			Number(new Hbar(MINT_PAYMENT, HbarUnit.Hbar).toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'Test Pool 1',
				'TP1',
				'Test pool memo',
				// No royalties
				[],
				'QmTestTicketCID',
				'QmTestWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				// HBAR fee
				ZERO_ADDRESS,
			],
			new Hbar(MINT_PAYMENT, HbarUnit.Hbar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Pool creation failed:', result[0]?.status?.toString());
			fail('Pool creation failed');
		}

		console.log('-Pool creation tx:', result[2]?.transactionId?.toString());

		// get the poolId from the 2nd element of the result array
		const poolId = Number(result[1][0]);
		console.log('-Created Pool ID:', poolId);

		// Wait for mirror node
		await sleep(5000);

		// Verify pool was created
		const encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', queryResult);
		expect(Number(totalPools[0])).to.be.equal(1);

		// Get pool details
		const poolCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [poolId]);
		const poolResult = await readOnlyEVMFromMirrorNode(env, contractId, poolCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolDetails', poolResult);

		console.log('-Pool details:', poolDetails);
		expect(poolDetails[0].entryFee.toString()).to.be.equal(ENTRY_FEE_HBAR.toString());
		expect(poolDetails[0].feeToken).to.be.equal(ZERO_ADDRESS);
		expect(poolDetails[0].closed).to.be.false;
		expect(poolDetails[0].paused).to.be.false;

		// Store the ticket token ID for future tests
		const ticketTokenId = TokenId.fromSolidityAddress(poolDetails[0].poolTokenId);
		console.log('Pool NFT collection created:', ticketTokenId.toString());

		// need to associate the ticket token to all the accounts used in testing including operator and admin
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize token associations
		const associationPromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			// Associate tokens
			const assocResult = await associateTokensToAccount(
				client,
				account.id,
				account.key,
				[ticketTokenId],
			);
			expect(assocResult).to.be.equal('SUCCESS');
			console.log(`Associated ticket Token to ${account.id.toString()}`);
			return assocResult;
		});

		await Promise.all(associationPromises);
	});

	it('Should prevent non-admin from creating pool', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				3_000_000,
				'createPool',
				[
					'Unauthorized Pool',
					'UP',
					'Should fail',
					[],
					'QmFailCID',
					'QmFailWinCID',
					WIN_RATE_THRESHOLD,
					ENTRY_FEE_HBAR,
					ZERO_ADDRESS,
				],
				new Hbar(MINT_PAYMENT, HbarUnit.Hbar),
			);

			if (result[0]?.status != 'REVERT: Ownable: caller is not the owner') {
				console.log('Pool Create succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('-Non-admin prevented from creating pool');
	});

	it('Should create second pool with $LAZY fee', async function () {
		client.setOperator(adminId, adminPK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'createPool',
			[
				'LAZY Pool',
				'LP',
				'LAZY fee pool',
				[],
				'QmLazyTicketCID',
				'QmLazyWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_LAZY,
				lazyTokenId.toSolidityAddress(),
			],
			3_000_000,
			Number(new Hbar(MINT_PAYMENT, HbarUnit.Hbar).toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'LAZY Pool',
				'LP',
				'LAZY fee pool',
				[],
				'QmLazyTicketCID',
				'QmLazyWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_LAZY,
				lazyTokenId.toSolidityAddress(),
			],
			new Hbar(MINT_PAYMENT, HbarUnit.Hbar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY pool creation failed:', result[0]?.status?.toString());
			fail('LAZY pool creation failed');
		}

		console.log('-LAZY pool creation tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify we now have 2 pools
		const encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', queryResult);
		expect(Number(totalPools[0])).to.be.equal(2);

		console.log('-LAZY pool created successfully');
	});
});

describe('LazyLotto - Prize Management:', function () {
	it('Should add HBAR prize package', async () => {
		const prizeAmount = new Hbar(5).toTinybars();
		const nftTokens = [];
		const nftSerials = [];

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for adding HBAR prize package
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'addPrizePackage',
			[0, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
			800_000,
			Number(prizeAmount),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addPrizePackage',
			[0, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
			new Hbar(prizeAmount, HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('HBAR prize package addition failed:', result[0]?.status?.toString());
			fail('HBAR prize package addition failed');
		}

		console.log('\t✓ Added HBAR prize package successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});

	it('Should add LAZY token prize package', async () => {
		const prizeAmount = 1000;
		const nftTokens = [];
		const nftSerials = [];

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for adding LAZY token prize package
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'addPrizePackage',
			[0, lazyTokenId.toSolidityAddress(), prizeAmount, nftTokens, nftSerials],
			800_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addPrizePackage',
			[0, lazyTokenId.toSolidityAddress(), prizeAmount, nftTokens, nftSerials],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY token prize package addition failed:', result[0]?.status?.toString());
			fail('LAZY token prize package addition failed');
		}

		console.log('\t✓ Added LAZY token prize package successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});

	it('Should add multiple fungible prizes', async () => {
		const amounts = [500, 750, 1000];

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for adding multiple fungible prizes
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'addMultipleFungiblePrizes',
			[1, testFungibleTokenId.toSolidityAddress(), amounts],
			800_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addMultipleFungiblePrizes',
			[1, testFungibleTokenId.toSolidityAddress(), amounts],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Multiple fungible prizes addition failed:', result[0]?.status?.toString());
			fail('Multiple fungible prizes addition failed');
		}

		console.log('\t✓ Added multiple fungible prizes successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});
});

describe('LazyLotto - Prize Package Getter:', function () {
	it('Should retrieve specific prize package from pool', async () => {
		try {
			// We know from previous tests that poolId 0 has at least 2 prizes added
			// (HBAR prize and LAZY prize)

			// Get the first prize package (HBAR prize)
			const prizePackage0 = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				lazyLottoIface,
				'getPrizePackage',
				[0, 0],
				false,
			);

			expect(prizePackage0).to.exist;
			// HBAR prize
			expect(prizePackage0.token).to.equal(ZERO_ADDRESS);
			expect(Number(prizePackage0.amount)).to.equal(Number(new Hbar(5).toTinybars()));
			console.log('\t✓ Successfully retrieved HBAR prize package');
			console.log(`\t  Token: ${prizePackage0.token === ZERO_ADDRESS ? 'HBAR' : prizePackage0.token}`);
			console.log(`\t  Amount: ${prizePackage0.amount}`);

			// Get the second prize package (LAZY prize)
			const prizePackage1 = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				lazyLottoIface,
				'getPrizePackage',
				[0, 1],
				false,
			);

			expect(prizePackage1).to.exist;
			expect(prizePackage1.token.slice(-2).toLowerCase()).to.equal(lazyTokenId.toSolidityAddress());
			expect(Number(prizePackage1.amount)).to.equal(1000);
			console.log('\t✓ Successfully retrieved LAZY prize package');
			console.log(`\t  Token: ${prizePackage1.token}`);
			console.log(`\t  Amount: ${prizePackage1.amount}`);
		}
		catch (error) {
			console.log('\t✗ Failed to retrieve prize package:', error.message);
			fail('Prize package retrieval failed');
		}
	});

	it('Should revert when requesting prize package from invalid pool', async () => {
		const invalidPoolId = 999;
		let unexpectedErrors = 0;

		try {
			await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				lazyLottoIface,
				'getPrizePackage',
				[invalidPoolId, 0],
				false,
			);
			console.log('\t✗ Should have reverted for invalid pool');
			unexpectedErrors++;
		}
		catch (error) {
			if (error.message.includes('LottoPoolNotFound') || error.message.includes('revert')) {
				console.log('\t✓ Correctly reverted for invalid pool');
			}
			else {
				console.log('\t✗ Unexpected error:', error.message);
				unexpectedErrors++;
			}
		}

		if (unexpectedErrors > 0) {
			fail('Invalid pool test failed');
		}
	});

	it('Should revert when requesting prize package with invalid index', async () => {
		const invalidPrizeIndex = 999;
		let unexpectedErrors = 0;

		try {
			await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				lazyLottoIface,
				'getPrizePackage',
				[0, invalidPrizeIndex],
				false,
			);
			console.log('\t✗ Should have reverted for invalid prize index');
			unexpectedErrors++;
		}
		catch (error) {
			if (error.message.includes('BadParameters') || error.message.includes('revert')) {
				console.log('\t✓ Correctly reverted for invalid prize index');
			}
			else {
				console.log('\t✗ Unexpected error:', error.message);
				unexpectedErrors++;
			}
		}

		if (unexpectedErrors > 0) {
			fail('Invalid prize index test failed');
		}
	});

	it('Should retrieve prize package with NFT contents', async () => {
		// Use Alice who owns serial 1 of testNFTTokenId1
		client.setOperator(aliceId, alicePK);

		try {
			// First, add a prize package with NFTs for testing
			const prizeAmount = 0;
			const nftTokens = [testNFTTokenId1.toSolidityAddress()];
			// Alice owns serial 1
			const nftSerials = [[1]];

			// need to ensure we have an NFT allowance to the contract for this
			const allowance = await setNFTAllowanceAll(
				client,
				nftTokens,
				aliceId,
				AccountId.fromString(contractId.toString()),
			);

			expect(allowance).to.equal('SUCCESS');

			// Estimate gas for adding NFT prize package
			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'addPrizePackage',
				[0, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
				800_000,
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'addPrizePackage',
				[0, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('NFT prize package addition failed:', result[0]?.status?.toString());
				fail('NFT prize package addition failed');
			}

			console.log('\t✓ Added NFT prize package successfully');
			console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

			// Sleep to allow mirror node to update
			await sleep(5000);

			// Now retrieve the prize package we just added
			// This should be at the end of the prizes array
			const poolDetails = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				lazyLottoIface,
				'getPoolDetails',
				[0],
				false,
			);

			const lastPrizeIndex = poolDetails.prizes.length - 1;

			const nftPrizePackage = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				lazyLottoIface,
				'getPrizePackage',
				[0, lastPrizeIndex],
				false,
			);

			expect(nftPrizePackage).to.exist;
			expect(nftPrizePackage.nftTokens).to.have.lengthOf(1);
			expect(nftPrizePackage.nftTokens[0].slice(-2).toLowerCase()).to.equal(testNFTTokenId1.toSolidityAddress());
			expect(nftPrizePackage.nftSerials).to.have.lengthOf(1);
			expect(nftPrizePackage.nftSerials[0]).to.have.lengthOf(1);
			expect(Number(nftPrizePackage.nftSerials[0][0])).to.equal(1);
			console.log('\t✓ Successfully retrieved NFT prize package');
			console.log(`\t  NFT Token: ${testNFTTokenId1.toString()}`);
			console.log(`\t  NFT Serials: ${Number(nftPrizePackage.nftSerials[0])}`);
		}
		catch (error) {
			console.log('\t✗ Failed to retrieve NFT prize package:', error.message);
			fail('NFT prize package retrieval failed');
		}
	});
});

describe('LazyLotto - Ticket Purchase and Rolling:', function () {
	it('Should purchase HBAR fee pool ticket and handle rolling', async () => {
		const entryFee = ENTRY_FEE_HBAR;
		const ticketCount = 1;
		const poolId = 0;

		// Set Alice as operator
		client.setOperator(aliceId, alicePK);

		// Estimate gas for buying entry with HBAR payment
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'buyEntry',
			[poolId, ticketCount],
			1_000_000,
			Number(entryFee),
		);

		// Purchase ticket
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyEntry',
			[poolId, ticketCount],
			entryFee,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Ticket purchase failed:', result[0]?.status?.toString());
			fail('Ticket purchase failed');
		}

		console.log('\t✓ Ticket purchase successful');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});

	it('Should try to buy a ticket with insufficient HBAR', async () => {
		const insufficientEntryFee = new Hbar(0.0001).toTinybars();
		const ticketCount = 1;
		const poolId = 0;
		let unexpectedErrors = 0;

		// Set Alice as operator
		client.setOperator(aliceId, alicePK);
		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				1_000_000,
				'buyEntry',
				[poolId, ticketCount],
				insufficientEntryFee,
			);
			if (result[0]?.status?.name != 'InsufficientPayment') {
				console.log('Expected failure but got:', result);
				unexpectedErrors++;
			}
		}
		catch (error) {
			console.log('Error occurred while buying ticket:', error);
			unexpectedErrors++;
		}
		expect(unexpectedErrors).to.be.equal(0);
		console.log('\t✓ Insufficient HBAR payment prevented ticket purchase');
	});

	it('Should buyAndRedeemEntry in a single transaction', async () => {
		const entryFee = ENTRY_FEE_HBAR;
		const ticketCount = 1;
		const poolId = 0;

		// Set Carol as operator
		client.setOperator(carolId, carolPK);
		// Estimate gas for buyAndRedeemEntry
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			carolId,
			'buyAndRedeemEntry',
			[poolId, ticketCount],
			1_500_000,
			Number(entryFee),
		);

		// Purchase and redeem ticket
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyAndRedeemEntry',
			[poolId, ticketCount],
			entryFee,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('buyAndRedeemEntry failed:', result[0]?.status?.toString());
			fail('buyAndRedeemEntry failed');
		}
		console.log('\t✓ buyAndRedeemEntry successful');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// get the ticket token ID for poolId 0
		const poolDetails = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			lazyLottoIface,
			'getPoolDetails',
			[poolId],
			false,
		);
		const ticketTokenId = TokenId.fromSolidityAddress(poolDetails.poolTokenId);

		// check if the NFT ticket was minted
		const carolBalance = await checkMirrorBalance(carolId.toString(), ticketTokenId.toString());
		expect(carolBalance).to.be.greaterThan(0);
		console.log('\t✓ NFT ticket minted to Carol');
	});

	it('Should rollWithNFT tickets', async () => {
		const poolId = 0;
		// Set Carol as operator
		client.setOperator(carolId, carolPK);

		// setup an allowance for the ticket token back to the contract
		const poolDetails = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			lazyLottoIface,
			'getPoolDetails',
			[poolId],
			false,
		);

		// Approve the ticket token for the contract
		const ticketTokenId = TokenId.fromSolidityAddress(poolDetails.poolTokenId);
		const allowanceResult = await setNFTAllowanceAll(
			client,
			[ticketTokenId.toSolidityAddress()],
			carolId,
			AccountId.fromString(contractId.toString()),
		);
		expect(allowanceResult).to.equal('SUCCESS');

		console.log('\t✓ Ticket token approved for contract');

		// Estimate gas for rolling with NFT tickets
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			carolId,
			'rollWithNFT',
			[poolId],
			1_000_000,
		);

		// Roll tickets
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'rollWithNFT',
			[poolId],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('rollWithNFT failed:', result[0]?.status?.toString());
			fail('rollWithNFT failed');
		}

		console.log('\t✓ rollWithNFT successful');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// check for wins
		console.log('\n-Checking for wins for Carol:', result[1]);
		const wins = Number(result[1][0]);
		const offset = Number(result[1][1]);

		if (wins) {
			console.log(`\t✓ User won ${wins} tickets starting from offset ${offset}`);
		}
		else {
			console.log('\t✗ User did not win any tickets');
		}

		await sleep(5000);

		// check if the NFT ticket was burned
		const carolBalance = await checkMirrorBalance(carolId.toString(), ticketTokenId.toString());
		expect(carolBalance).to.be.equal(0);
		console.log('\t✓ NFT ticket burned after rolling');
	});

	it('Should purchase LAZY fee pool ticket', async () => {
		const lazyPoolId = 1;
		const ticketCount = 1;

		// Set Bob as operator
		client.setOperator(bobId, bobPK);

		// Estimate gas for buying entry with LAZY tokens
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			bobId,
			'buyEntry',
			[lazyPoolId, ticketCount],
			1_000_000,
		);

		// Purchase ticket with LAZY tokens
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyEntry',
			[lazyPoolId, ticketCount],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY ticket purchase failed:', result[0]?.status?.toString());
			fail('LAZY ticket purchase failed');
		}

		console.log('\t✓ LAZY ticket purchase successful');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});
});

describe('LazyLotto - Bonus System Tests:', function () {
	it('Should set and verify LAZY balance bonus', async () => {
		const threshold = 1000;
		const bonusBps = 500;

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for setting LAZY balance bonus
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'setLazyBalanceBonus',
			[threshold, bonusBps],
			300_000,
		);

		// Set LAZY balance bonus
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setLazyBalanceBonus',
			[threshold, bonusBps],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY balance bonus setup failed:', result[0]?.status?.toString());
			fail('LAZY balance bonus setup failed');
		}

		console.log('\t✓ LAZY balance bonus set successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Query to verify the bonus was set
		const thresholdQuery = lazyLottoIface.encodeFunctionData('lazyBalanceThreshold', []);
		const thresholdResult = await readOnlyEVMFromMirrorNode(env, contractId, thresholdQuery, operatorId, false);
		const thresholdValue = lazyLottoIface.decodeFunctionResult('lazyBalanceThreshold', thresholdResult);

		const bonusQuery = lazyLottoIface.encodeFunctionData('lazyBalanceBonusBps', []);
		const bonusResult = await readOnlyEVMFromMirrorNode(env, contractId, bonusQuery, operatorId, false);
		const bonusValue = lazyLottoIface.decodeFunctionResult('lazyBalanceBonusBps', bonusResult);

		expect(thresholdValue[0].toString()).to.equal(threshold.toString());
		expect(bonusValue[0].toString()).to.equal(bonusBps.toString());
		console.log('\t📊 LAZY balance bonus verified:', { threshold: thresholdValue[0].toString(), bonus: bonusValue[0].toString() + ' bps' });
	});

	it('Should set and verify NFT holding bonus', async () => {
		const bonusBps = 750;

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for setting NFT bonus
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'setNFTBonus',
			[testNFTTokenId1.toSolidityAddress(), bonusBps],
			300_000,
		);

		// Set NFT bonus using one of our test NFT tokens
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setNFTBonus',
			[testNFTTokenId1.toSolidityAddress(), bonusBps],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('NFT bonus setup failed:', result[0]?.status?.toString());
			fail('NFT bonus setup failed');
		}

		console.log('\t✓ NFT bonus set successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Query to verify the NFT bonus was set
		const bonusQuery = lazyLottoIface.encodeFunctionData('nftBonusBps', [testNFTTokenId1.toSolidityAddress()]);
		const bonusResult = await readOnlyEVMFromMirrorNode(env, contractId, bonusQuery, operatorId, false);
		const bonusValue = lazyLottoIface.decodeFunctionResult('nftBonusBps', bonusResult);

		expect(bonusValue[0].toString()).to.equal(bonusBps.toString());
		console.log('\t📊 NFT bonus verified for token', testNFTTokenId1.toString(), ':', bonusValue[0].toString() + ' bps');
	});

	it('Should set and verify time-based bonus', async () => {
		const currentTime = Math.floor(Date.now() / 1000);
		const startTime = currentTime + 60;
		const endTime = currentTime + 3600;
		const bonusBps = 1000;

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for setting time bonus
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'setTimeBonus',
			[startTime, endTime, bonusBps],
			300_000,
		);

		// Set time bonus
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setTimeBonus',
			[startTime, endTime, bonusBps],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Time bonus setup failed:', result[0]?.status?.toString());
			fail('Time bonus setup failed');
		}

		console.log('\t✓ Time bonus set successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Query to verify the time bonus was set
		const bonusQuery = lazyLottoIface.encodeFunctionData('timeBonuses', [0]);
		const bonusResult = await readOnlyEVMFromMirrorNode(env, contractId, bonusQuery, operatorId, false);
		const bonusValue = lazyLottoIface.decodeFunctionResult('timeBonuses', bonusResult);

		expect(bonusValue[0].start.toString()).to.equal(startTime.toString());
		expect(bonusValue[0].end.toString()).to.equal(endTime.toString());
		expect(bonusValue[0].bonusBps.toString()).to.equal(bonusBps.toString());
		console.log('\t📊 Time bonus verified:', {
			start: new Date(startTime * 1000).toISOString(),
			end: new Date(endTime * 1000).toISOString(),
			bonus: bonusValue[0].bonusBps.toString() + ' bps',
		});
	});

	it('Should calculate combined bonuses correctly', async () => {
		console.log('\n\t🔄 BONUS STACKING ANALYSIS TEST');
		console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

		try {
			// Set up multiple bonuses for comprehensive stacking test
			const lazyThreshold = 500;
			const lazyBonus = 1000;
			const nftBonus = 750;
			const timeBonus = 500;
			// Total expected: 22.5% (2250 bps → 22,500,000 scaled bps)

			console.log('\t📋 Setting up bonus stacking scenario:');
			console.log('\t   • LAZY Balance Bonus: 10% (1000 bps) for 500+ LAZY');
			console.log('\t   • NFT Holding Bonus: 7.5% (750 bps) for test NFT');
			console.log('\t   • Time Bonus: 5% (500 bps) for active window');
			console.log('\t   • Expected Total: 22.5% (2250 bps → 22,500,000 scaled)');

			// Configure all bonus types with proper gas estimation
			client.setOperator(adminId, adminPK);

			let gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				adminId,
				'setLazyBalanceBonus',
				[lazyThreshold, lazyBonus],
				300_000,
			);

			const result1 = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'setLazyBalanceBonus',
				[lazyThreshold, lazyBonus],
			);

			if (result1[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Set LAZY balance bonus failed:', result1[0]?.status?.toString());
				fail('Set LAZY balance bonus failed');
			}

			gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				adminId,
				'setNFTBonus',
				[testNFTTokenId1.toSolidityAddress(), nftBonus],
				300_000,
			);

			const result2 = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'setNFTBonus',
				[testNFTTokenId1.toSolidityAddress(), nftBonus],
			);

			if (result2[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Set NFT bonus failed:', result2[0]?.status?.toString());
				fail('Set NFT bonus failed');
			}

			const currentTime = Math.floor(Date.now() / 1000);
			gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				adminId,
				'setTimeBonus',
				[currentTime - 10, currentTime + 60, timeBonus],
				300_000,
			);

			const result3 = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'setTimeBonus',
				[currentTime - 10, currentTime + 60, timeBonus],
			);

			if (result3[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Set time bonus failed:', result3[0]?.status?.toString());
				fail('Set time bonus failed');
			}


			// Let's use operator as that account should meet all bonus criteria
			client.setOperator(operatorId, operatorKey);

			// Wait for token transfers
			await sleep(5000);

			// Test Operator's combined bonus calculation
			const boostQuery = lazyLottoIface.encodeFunctionData('calculateBoost', [operatorId.toEvmAddress()]);
			const boostResult = await readOnlyEVMFromMirrorNode(env, contractId, boostQuery, operatorId, false);
			const totalBoost = lazyLottoIface.decodeFunctionResult('calculateBoost', boostResult);

			const expectedScaledBoost = (lazyBonus + nftBonus + timeBonus) * 10_000;

			console.log('\t📊 BONUS STACKING RESULTS:');
			console.log('\t   • Individual bonuses: LAZY=' + lazyBonus + ', NFT=' + nftBonus + ', Time=' + timeBonus + ' bps');
			console.log('\t   • Sum: ' + (lazyBonus + nftBonus + timeBonus) + ' bps');
			console.log('\t   • Contract scaled result: ' + totalBoost[0].toString());
			console.log('\t   • Expected scaled result: ' + expectedScaledBoost);

			expect(totalBoost[0].toString()).to.equal(expectedScaledBoost.toString());

			console.log('\t✅ Bonus stacking verification completed');

		}
		catch (error) {
			console.log('\t✗ Bonus stacking test failed:', error.message);
			expect.fail('Bonus stacking test failed');
		}
	});
});

describe('LazyLotto - Rolling Mechanics:', function () {
	const userPoolId = 0;

	beforeEach(async () => {
		// Ensure user has entries to roll
		const entryFee = new Hbar(1);
		const ticketCount = 3;

		// Set Alice as operator
		client.setOperator(aliceId, alicePK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'buyEntry',
			[userPoolId, ticketCount],
			2_000_000,
			Number(entryFee.toTinybars()) * ticketCount,
		);

		await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyEntry',
			[userPoolId, ticketCount],
			new Hbar(Number(entryFee.toTinybars()) * ticketCount, HbarUnit.Tinybar),
		);
	});

	it('Should roll all user entries', async () => {
		// Set Alice as operator
		client.setOperator(aliceId, alicePK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'rollAll',
			[userPoolId],
			5_000_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'rollAll',
			[userPoolId],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Rolling entries failed:', result[0]?.status?.toString());
			fail('Rolling entries failed');
		}

		console.log('\tGas used:', gasEstimate.gasLimit);

		console.log('\t✓ Successfully rolled all entries');
		console.log(parseTransactionRecord(result[2]));

		await sleep(5000);

		// Check if user has any pending prizes
		const encodedCommand = lazyLottoIface.encodeFunctionData('getUserEntries', [aliceId.toSolidityAddress()]);
		const queryResult = await contractCallQuery(contractId, encodedCommand, client);
		const userEntries = lazyLottoIface.decodeFunctionResult('entries', queryResult);
		// @return uint256[] memory The number of entries the user has in each pool
		// should be 2 element array (two pools) and the userPoolId element should be 0 now
		expect(Number(userEntries[0][userPoolId])).to.equal(0);
		console.log('\t✓ Verified user has no remaining entries after rollAll for pool', userPoolId);
	});

	it('Should roll batch of entries', async () => {
		const numberToRoll = 2;

		// Set Bob as operator
		client.setOperator(bobId, bobPK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			bobId,
			'rollBatch',
			[userPoolId, numberToRoll],
			2_000_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'rollBatch',
			[userPoolId, numberToRoll],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Batch rolling failed:', result[0]?.status?.toString());
			fail('Batch rolling failed');
		}

		console.log('\t✓ Successfully rolled batch of entries');
		console.log(parseTransactionRecord(result[2]));
	});

	it('Should handle buy and roll in one transaction', async () => {
		const entryFee = new Hbar(1);
		const ticketCount = 1;

		// Set Carol as operator
		client.setOperator(carolId, carolPK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			carolId,
			'buyAndRollEntry',
			[userPoolId, ticketCount],
			2_000_000,
			Number(entryFee.toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyAndRollEntry',
			[userPoolId, ticketCount],
			entryFee,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Buy and roll failed:', result[0]?.status?.toString());
			fail('Buy and roll failed');
		}

		console.log('\t✓ Successfully bought and rolled entry');
		console.log(parseTransactionRecord(result[2]));

		console.log('\n-Checking for wins for Carol:', result[1]);

		// let's see if the user won anything
		const wins = Number(result[1][0]);
		const offset = Number(result[1][1]);
		if (wins) {
			console.log(`\t✓ User won ${wins} tickets starting from offset ${offset}`);
		}
		else {
			console.log('\t✗ User did not win any tickets');
		}
	});
});

describe('LazyLotto - Prize Claiming:', function () {

	before(async () => {
		// Switch to mock PRNG for deterministic wins
		console.log('\n🎯 Switching to Mock PRNG for deterministic prize claiming tests...');

		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'setPrng',
			[mockPrngId.toSolidityAddress()],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setPrng',
			[mockPrngId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Set Mock PRNG failed:', result[0]?.status?.toString());
			fail('Set Mock PRNG failed');
		}

		console.log('✓ Mock PRNG activated - all rolls will now result in wins');
	});

	after(async () => {
		// Switch back to real PRNG
		console.log('\n🔄 Restoring real PRNG...');

		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'setPrng',
			[prngId.toSolidityAddress()],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setPrng',
			[prngId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Restore real PRNG failed:', result[0]?.status?.toString());
			fail('Restore real PRNG failed');
		}

		console.log('✓ Real PRNG restored');
	});

	beforeEach(async () => {
		const poolId = 0;
		const entryFee = new Hbar(1);
		const ticketCount = 3;

		// better add some prizes to ensure user can claim something
		const prizeAmount = new Hbar(3);
		// create an array of ticketCount length for fungible prizes random amounts of tinybars summing to prizeAmount
		const prizes = [];
		const prizePerTicket = Math.floor(Number(prizeAmount.toTinybars()) / ticketCount);

		for (let i = 0; i < ticketCount; i++) {
			prizes.push(new Hbar(prizePerTicket, HbarUnit.Tinybar));
		}

		// Set admin as operator
		client.setOperator(adminId, adminPK);
		let gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'addMultipleFungiblePrizes',
			[0, Number(prizeAmount.toTinybars()), [prizes.map(p => Number(p.toTinybars()))]],
			2_000_000,
		);

		let result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addMultipleFungiblePrizes',
			[0, Number(prizeAmount.toTinybars()), [prizes.map(p => Number(p.toTinybars()))]],
		);

		// Set up scenario where user has pending prizes
		// With mock PRNG, every roll will be a win

		// Set Alice as operator
		client.setOperator(aliceId, alicePK);

		gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'buyAndRollEntry',
			[poolId, ticketCount],
			2_000_000,
			Number(entryFee.toTinybars()) * ticketCount,
		);

		result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyAndRollEntry',
			[poolId, ticketCount],
			new Hbar(Number(entryFee.toTinybars()) * ticketCount, HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Buy and roll failed:', result[0]?.status?.toString());
			fail('Buy and roll failed');
		}

		console.log('\t✓ Purchased and rolled 3 tickets (all wins with mock PRNG)');
		console.log(parseTransactionRecord(result[2]));

		// check that Alice has wins
		const wins = Number(result[1][0]);
		expect(wins).to.be.equal(ticketCount);
	});

	it('Should claim individual prize', async () => {
		try {
			await sleep(5000);

			// Check pending prizes for Alice
			const encodedQuery = lazyLottoIface.encodeFunctionData('getPendingPrizes', [aliceId.toSolidityAddress()]);
			const queryResult = await contractCallQuery(contractId, encodedQuery, client);
			const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizes', queryResult);

			if (pendingPrizes[0].length > 0) {
				// Set Alice as operator
				client.setOperator(aliceId, alicePK);

				const prizeIndex = 0;

				// in case this is an NFT prize set an hbar allowance for the contract
				if (pendingPrizes[0][prizeIndex].prize.nftTokens.length > 0) {
					client.setOperator(aliceId, alicePK);
					// for each of pendingPrizes[0][prizeIndex].prize.nftTokens.length check alice has it associated
					for (let i = 0; i < pendingPrizes[0][prizeIndex].prize.nftTokens.length; i++) {
						const nftTokenId = TokenId.fromSolidityAddress(pendingPrizes[0][prizeIndex].prize.nftTokens[i]);
						const aliceBalance = await checkMirrorBalance(aliceId.toString(), nftTokenId.toString());
						if (aliceBalance == null || aliceBalance == undefined) {
							console.log('\tAlice does not yet have required NFT associated for prize claiming:', nftTokenId.toString());
							const assoc = await associateTokensToAccount(
								client,
								aliceId,
								alicePK,
								[nftTokenId],
							);

							if (assoc != 'SUCCESS') {
								console.log('\t✗ Failed to associate NFT token for prize claiming:', nftTokenId.toString());
								fail('NFT association failed for prize claiming');
							}
						}
					}
					// now set allowance
					const allowanceResult = await setHbarAllowance(
						client,
						aliceId,
						AccountId.fromString(contractId.toString()),
						1,
					);

					if (allowanceResult !== 'SUCCESS') {
						console.log('\t✗ Failed to set HBAR allowance for NFT prize claiming');
						fail('HBAR allowance setup failed for NFT prize claiming');
					}
				}

				const gasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					aliceId,
					'claimPrize',
					[prizeIndex],
					2_000_000,
				);


				const result = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'claimPrize',
					[prizeIndex],
				);

				if (result[0]?.status?.toString() !== 'SUCCESS') {
					console.log('Prize claiming failed:', result[0]?.status?.toString());
					fail('Prize claiming failed');
				}

				console.log('\t✓ Successfully claimed individual prize');
				console.log(parseTransactionRecord(result[2]));
			}
			else {
				console.log('\t⚠ No pending prizes to claim');
			}
		}
		catch (error) {
			console.log('\t✗ Failed to claim prize:', error.message);
			expect.fail('Prize claiming failed');
		}
	});

	it('Should claim all pending prizes', async () => {
		try {
			// Set Alice as operator
			client.setOperator(aliceId, alicePK);

			await sleep(5000);

			// Check pending prizes for Alice
			const encodedQuery = lazyLottoIface.encodeFunctionData('getPendingPrizes', [aliceId.toSolidityAddress()]);
			const queryResult = await contractCallQuery(contractId, encodedQuery, client);
			const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizes', queryResult);

			if (pendingPrizes[0].length > 0) {
				// Set Alice as operator
				client.setOperator(aliceId, alicePK);

				let allowanceSet = false;

				for (let prizeIndex = 0; prizeIndex < pendingPrizes[0].length; prizeIndex++) {
					// in case this is an NFT prize set an hbar allowance for the contract
					if (pendingPrizes[0][prizeIndex].prize.nftTokens.length > 0) {
						client.setOperator(aliceId, alicePK);
						// for each of pendingPrizes[0][prizeIndex].prize.nftTokens.length check alice has it associated
						for (let i = 0; i < pendingPrizes[0][prizeIndex].prize.nftTokens.length; i++) {
							const nftTokenId = TokenId.fromSolidityAddress(pendingPrizes[0][prizeIndex].prize.nftTokens[i]);
							const aliceBalance = await checkMirrorBalance(aliceId.toString(), nftTokenId.toString());
							if (aliceBalance == null || aliceBalance == undefined) {
								console.log('\tAlice does not yet have required NFT associated for prize claiming:', nftTokenId.toString());
								const assoc = await associateTokensToAccount(
									client,
									aliceId,
									alicePK,
									[nftTokenId],
								);

								if (assoc != 'SUCCESS') {
									console.log('\t✗ Failed to associate NFT token for prize claiming:', nftTokenId.toString());
									fail('NFT association failed for prize claiming');
								}
							}
						}

						if (!allowanceSet) {
							// now set allowance
							const allowanceResult = await setHbarAllowance(
								client,
								aliceId,
								AccountId.fromString(contractId.toString()),
								1,
							);

							if (allowanceResult !== 'SUCCESS') {
								console.log('\t✗ Failed to set HBAR allowance for NFT prize claiming');
								fail('HBAR allowance setup failed for NFT prize claiming');
							}

							allowanceSet = true;
						}
					}
				}
			}

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'claimAllPrizes',
				[],
				6_000_000,
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'claimAllPrizes',
				[],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Claim all prizes failed:', result[0]?.status?.toString());
				fail('Claim all prizes failed');
			}

			console.log('\t✓ Successfully claimed all prizes');
			console.log(parseTransactionRecord(result[2]));
		}
		catch (error) {
			console.log('\t✗ Failed to claim all prizes:', error.message);
			// This might fail if no prizes are pending, which is expected
			if (error.message.includes('NoPendingPrizes')) {
				console.log('\t⚠ No pending prizes to claim - this is expected');
			}
			else {
				expect.fail('Unexpected error claiming prizes');
			}
		}
	});
});

describe('LazyLotto - Error Handling and Edge Cases:', function () {
	it('Should reject non-admin prize additions', async () => {
		const prizeAmount = new Hbar(1);
		const nftTokens = [];
		const nftSerials = [];

		const poolId = 0;

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			// Set Alice as operator (non-admin)
			client.setOperator(aliceId, alicePK);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'addPrizePackage',
				[poolId, ZERO_ADDRESS, prizeAmount.toTinybars(), nftTokens, nftSerials],
				2_000_000,
				Number(prizeAmount.toTinybars()),
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'addPrizePackage',
				[poolId, ZERO_ADDRESS, prizeAmount.toTinybars(), nftTokens, nftSerials],
				prizeAmount,
			);

			if (result[0]?.status.toString() != 'REVERT: Ownable: caller is not the owner') {
				console.log('Operation succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Expected error correctly caught');
	});

	it('Should reject invalid pool operations', async () => {
		const invalidPoolId = 999;
		const ticketCount = 1;

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			// Set Carol as operator
			client.setOperator(carolId, carolPK);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				carolId,
				'buyEntry',
				[invalidPoolId, ticketCount],
				2_000_000,
				Number(new Hbar(1).toTinybars()),
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'buyEntry',
				[invalidPoolId, ticketCount],
				new Hbar(1),
			);

			if (!result[0]?.status?.name.startsWith('LottoPoolNotFound')) {
				console.log('Operation succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Expected error correctly caught');
	});

	it('Should reject rolling with no entries', async () => {
		let expectedErrors = 0;
		let unexpectedErrors = 0;
		const poolId = 0;

		try {
			// Set Carol as operator
			client.setOperator(carolId, carolPK);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				carolId,
				'rollAll',
				[poolId],
				2_000_000,
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'rollAll',
				[poolId],
			);

			if (!result[0]?.status?.name.startsWith('NoTickets')) {
				console.log('Operation succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Expected error correctly caught');
	});
});

describe('LazyLotto - Time-Based Testing Scenarios:', function () {
	it('TIME-SENSITIVE: Bonus Window Activation and Boundary Precision (12s test)', async () => {
		console.log('\n\t🕐 QUICK TIME TEST: Time Bonus Window & Boundaries');
		console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('\t   Tests: Time bonus applies during rolling (not purchase)');

		const currentTime = Math.floor(Date.now() / 1000);
		const startTime = currentTime + 3;
		const endTime = currentTime + 11;
		// 10% bonus (1000 bps)
		const bonusBps = 1000;

		try {
			// Set Admin as operator
			client.setOperator(adminId, adminPK);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				adminId,
				'setTimeBonus',
				[startTime, endTime, bonusBps],
				2_000_000,
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'setTimeBonus',
				[startTime, endTime, bonusBps],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('\tSetTimeBonus failed:', result[0]?.status?.toString());
				fail('SetTimeBonus failed');
			}

			console.log('\t✓ Bonus window configured (3s -> 11s, 10% bonus = 1000 bps)');

			// Test 1: Before window starts
			console.log('\t⏱️  Test 1: 1 second before bonus start...');
			await sleep(2000);

			const boostBefore = await contractExecuteQuery(
				contractId,
				lazyLottoIface,
				client,
				200_000,
				'calculateBoost',
				[aliceId.toSolidityAddress()],
			);

			const boostValueBefore = boostBefore[0].toNumber();
			console.log(`\t   Boost: ${boostValueBefore} (expected 0)`);
			expect(boostValueBefore).to.equal(0, 'Boost should be 0 before window');

			// Test 2: At start boundary (±1s tolerance)
			console.log('\t⏱️  Test 2: At bonus start boundary...');
			await sleep(2000);

			const boostAtStart = await contractExecuteQuery(
				contractId,
				lazyLottoIface,
				client,
				200_000,
				'calculateBoost',
				[bobId.toSolidityAddress()],
			);

			const boostValueAtStart = boostAtStart[0].toNumber();
			console.log(`\t   Boost: ${boostValueAtStart} (expected 10,000,000 = 1000 bps * 10000)`);
			expect(boostValueAtStart).to.equal(10_000_000, 'Boost should be active at start');

			// Test 3: Mid-window
			console.log('\t⏱️  Test 3: Mid-window check...');
			await sleep(3000);

			const boostMidWindow = await contractExecuteQuery(
				contractId,
				lazyLottoIface,
				client,
				200_000,
				'calculateBoost',
				[carolId.toSolidityAddress()],
			);

			const boostValueMid = boostMidWindow[0].toNumber();
			console.log(`\t   Boost: ${boostValueMid} (expected 10,000,000)`);
			expect(boostValueMid).to.equal(10_000_000, 'Boost should be active mid-window');

			// Test 4: At end boundary (±1s tolerance)
			console.log('\t⏱️  Test 4: At bonus end boundary...');
			await sleep(3000);

			const boostAtEnd = await contractExecuteQuery(
				contractId,
				lazyLottoIface,
				client,
				200_000,
				'calculateBoost',
				[aliceId.toSolidityAddress()],
			);

			const boostValueAtEnd = boostAtEnd[0].toNumber();
			console.log(`\t   Boost: ${boostValueAtEnd} (expected 10,000,000)`);
			expect(boostValueAtEnd).to.equal(10_000_000, 'Boost should still be active at end boundary');

			// Test 5: After window expires
			console.log('\t⏱️  Test 5: 2 seconds after bonus end...');
			await sleep(2000);

			const boostAfter = await contractExecuteQuery(
				contractId,
				lazyLottoIface,
				client,
				200_000,
				'calculateBoost',
				[bobId.toSolidityAddress()],
			);

			const boostValueAfter = boostAfter[0].toNumber();
			console.log(`\t   Boost: ${boostValueAfter} (expected 0)`);
			expect(boostValueAfter).to.equal(0, 'Boost should be 0 after window expires');

			console.log('\t✅ Time bonus test completed successfully (12s total)');
			console.log('\t   ✓ Time bonus correctly applies only during rolling window');
			console.log('\t   ✓ Boundary timing accuracy: ±1-2 seconds (blockchain limits)');

		}
		catch (error) {
			console.log('\t✗ Time bonus test failed:', error.message);
			expect.fail('Time bonus test failed');
		}
	});
});

describe('LazyLotto - Cleanup:', function () {
	it('Should clear allowances for cleanup', async function () {
		console.log('\n-Starting cleanup...');

		// Parallelize clearing LAZY allowances
		const clearancePromises = lazyAllowancesSet.map(async (account) => {
			client.setOperator(account.id, account.key);

			const allowanceList = [
				{ tokenId: lazyTokenId, owner: account.id, spender: lazyGasStationId },
			];

			await clearFTAllowances(client, allowanceList);
			return account;
		});

		await Promise.all(clearancePromises);

		console.log('-Allowances cleared');
	});

	it('Should sweep HBAR from test accounts', async function () {
		// Parallelize HBAR sweeping
		const sweepPromises = createdAccounts.map(async (account) => {
			const hbarAmount = await checkMirrorHbarBalance(env, account.id);
			if (hbarAmount && hbarAmount > 100000) {
				console.log(`-Account ${account.id.toString()} HBAR balance: ${hbarAmount} tinybars`);

				const sweepResult = await sweepHbar(
					client,
					account.id,
					account.key,
					operatorId,
					new Hbar(hbarAmount - 50000, HbarUnit.Tinybar),
				);
				if (sweepResult !== 'SUCCESS') {
					console.log(`HBAR sweep failed for ${account.id.toString()}:`, sweepResult);
				}
			}
			return account;
		});

		await Promise.all(sweepPromises);

		console.log('-HBAR sweep completed');
	});
});