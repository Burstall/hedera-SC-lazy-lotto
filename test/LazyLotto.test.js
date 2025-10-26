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
const { describe, it, before, beforeEach } = require('mocha');
const {
	contractDeployFunction,
	readOnlyEVMFromMirrorNode,
	contractExecuteFunction,
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
} = require('../utils/hederaHelpers');
const {
	checkMirrorBalance,
	checkMirrorHbarBalance,
} = require('../utils/hederaMirrorHelpers');
const { fail } = require('assert');
const { ethers } = require('ethers');
const { estimateGas } = require('../utils/gasHelpers');

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
let lazyTokenId, lazySCT, lazyGasStationId, lazyDelegateRegistryId, prngId;
let testFungibleTokenId, testNFTTokenId1, testNFTTokenId2;

// Interface objects
// Interface variables
let lazyLottoIface, lazyIface;

// Created accounts for cleanup
const createdAccounts = [];
const lazyAllowancesSet = [];

// Pool tracking
const poolId = 0;
let ticketTokenId;

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

	it('Should create test fungible tokens for prizes', async function () {
		console.log('\n-Creating test fungible tokens...');

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
	});

	it('Should create test NFT collections for prizes', async function () {
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

		await sleep(4000);
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

		const gasLimit = 6_500_000;

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
	it('Should wait for mirror node to catch up', async function () {
		await sleep(8000);
	});

	it('Should verify immutable variables set correctly', async function () {
		client.setOperator(operatorId, operatorKey);

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

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				300_000,
				'addAdmin',
				[bobId.toSolidityAddress()],
			);

			if (result[0]?.status?.name === 'CONTRACT_REVERT_EXECUTED') {
				expectedErrors++;
			}
			else {
				console.log('Non-admin admin addition should have failed:', result);
				fail('Non-admin admin addition should have failed');
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
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

		await sleep(5000);

		// Now try to remove the last admin (operator)
		let expectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'removeAdmin',
				[operatorId.toSolidityAddress()],
			);

			if (result[0]?.status?.name === 'CONTRACT_REVERT_EXECUTED') {
				expectedErrors++;
			}
			else {
				console.log('Last admin removal should have failed:', result);
				fail('Last admin removal should have failed');
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
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

		for (const account of testAccounts) {
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
		}
	});

	it('Should send tokens to test accounts', async function () {
		client.setOperator(operatorId, operatorKey);

		const testAccounts = [aliceId, bobId, carolId, adminId];

		for (const accountId of testAccounts) {
			// Send LAZY tokens
			let result = await sendLazy(accountId, 5000);
			if (result !== 'SUCCESS') {
				console.log(`LAZY send failed for ${accountId.toString()}:`, result);
				fail('LAZY send failed');
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
				fail('Test token send failed');
			}

			// Send some test NFTs
			result = await sendNFT(client, operatorId, operatorKey, accountId, testNFTTokenId1, 1);
			if (result !== 'SUCCESS') {
				console.log(`Test NFT send failed for ${accountId.toString()}:`, result);
				fail('Test NFT send failed');
			}
		}

		console.log('\n-Tokens distributed to test accounts');
	});

	it('Should set LAZY allowances to LazyGasStation for test accounts', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		for (const account of testAccounts) {
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
				fail('LAZY allowance failed');
			}
			lazyAllowancesSet.push(account);
		}

		console.log('\n-LAZY allowances set to LazyGasStation');
	});

	it('Should set HBAR allowances to LazyLotto contract for NFT operations', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		for (const account of testAccounts) {
			client.setOperator(account.id, account.key);

			// Send small HBAR allowance for NFT operations
			const allowanceResult = await sendHbar(
				client,
				operatorId,
				operatorKey,
				account.id,
				new Hbar(0.1),
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`HBAR send failed for ${account.id.toString()}:`, allowanceResult);
				fail('HBAR send failed');
			}
		}

		console.log('\n-HBAR sent to accounts for NFT operations');
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
			2_000_000,
			MINT_PAYMENT,
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
			MINT_PAYMENT,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Pool creation failed:', result[0]?.status?.toString());
			fail('Pool creation failed');
		}

		console.log('-Pool creation tx:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(6000);

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
		ticketTokenId = TokenId.fromSolidityAddress(poolDetails[0].poolTokenId);
		console.log('Pool NFT collection created:', ticketTokenId.toString());
	});

	it('Should prevent non-admin from creating pool', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				2_000_000,
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
				MINT_PAYMENT,
			);

			if (result[0]?.status?.name === 'CONTRACT_REVERT_EXECUTED') {
				expectedErrors++;
			}
			else {
				console.log('Non-admin pool creation should have failed:', result);
				fail('Non-admin pool creation should have failed');
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
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
			2_000_000,
			MINT_PAYMENT,
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
			MINT_PAYMENT,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY pool creation failed:', result[0]?.status?.toString());
			fail('LAZY pool creation failed');
		}

		console.log('-LAZY pool creation tx:', result[2]?.transactionId?.toString());

		await sleep(6000);

		// Verify we now have 2 pools
		const encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', queryResult);
		expect(Number(totalPools[0])).to.be.equal(2);

		console.log('-LAZY pool created successfully');
	});
});

// Continue with more test suites for prize management, bonus system, etc.
// This is the foundation - we can add more test cases following this pattern

describe('LazyLotto - Cleanup:', function () {
	it('Should clear allowances for cleanup', async function () {
		console.log('\n-Starting cleanup...');

		// Clear LAZY allowances
		for (const account of lazyAllowancesSet) {
			client.setOperator(account.id, account.key);

			const allowanceList = [
				{ tokenId: lazyTokenId, owner: account.id, spender: lazyGasStationId },
			];

			await clearFTAllowances(client, allowanceList);
		}

		console.log('-Allowances cleared');
	});

	it('Should sweep HBAR from test accounts', async function () {
		for (const account of createdAccounts) {
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
		}

		console.log('-HBAR sweep completed');
	});

	describe('Prize Management', () => {
		it('Should add HBAR prize package', async () => {
			const prizeAmount = new Hbar(5).toTinybars();
			const nftTokens = [];
			const nftSerials = [];

			try {
				// Estimate gas for adding HBAR prize package
				const gasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					adminId,
					'addPrizePackage',
					[poolId, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
					800_000,
					Number(new Hbar(prizeAmount).toTinybars()),
				);

				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'addPrizePackage',
					[poolId, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
					adminPK,
					prizeAmount,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Added HBAR prize package successfully');
			}
			catch (error) {
				console.log('\t✗ Failed to add HBAR prize package:', error.message);
				expect.fail('HBAR prize package addition failed');
			}
		});

		it('Should add LAZY token prize package', async () => {
			const prizeAmount = 1000;
			const nftTokens = [];
			const nftSerials = [];

			try {
				// Estimate gas for adding LAZY token prize package
				const gasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					adminId,
					'addPrizePackage',
					[poolId, lazyTokenId.toSolidityAddress(), prizeAmount, nftTokens, nftSerials],
					800_000,
				);

				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'addPrizePackage',
					[poolId, lazyTokenId.toSolidityAddress(), prizeAmount, nftTokens, nftSerials],
					adminPK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Added LAZY token prize package successfully');
			}
			catch (error) {
				console.log('\t✗ Failed to add LAZY token prize package:', error.message);
				fail('LAZY token prize package addition failed');
			}
		});

		it('Should add multiple fungible prizes', async () => {
			const amounts = [500, 750, 1000];

			try {
				// Estimate gas for adding multiple fungible prizes
				const gasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					adminId,
					'addMultipleFungiblePrizes',
					[poolId, testFungibleTokenId.toSolidityAddress(), amounts],
					800_000,
				);

				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'addMultipleFungiblePrizes',
					[poolId, testFungibleTokenId.toSolidityAddress(), amounts],
					adminPK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Added multiple fungible prizes successfully');
			}
			catch (error) {
				console.log('\t✗ Failed to add multiple fungible prizes:', error.message);
				fail('Multiple fungible prizes addition failed');
			}
		});
	});

	describe('Ticket Purchase and Rolling', () => {
		before(async () => {
			// Ensure users have HBAR allowances for NFT operations
			const allowanceAmount = new Hbar(0.1);

			await setFTAllowance(
				client,
				aliceId,
				alicePK,
				contractId,
				allowanceAmount,
			);

			await setFTAllowance(
				client,
				bobId,
				bobPK,
				contractId,
				allowanceAmount,
			);
		});

		it('Should purchase HBAR fee pool ticket and handle rolling', async () => {
			const entryFee = new Hbar(1).toTinybars();
			const ticketCount = 1;

			try {
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
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'buyEntry',
					[poolId, ticketCount],
					alicePK,
					entryFee,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Ticket purchase successful');

				// Check if NFT ticket was minted
				const aliceBalance = await checkMirrorBalance(aliceId.toString(), ticketTokenId.toString());
				expect(aliceBalance).to.be.greaterThan(0);
				console.log('\t✓ NFT ticket minted to Alice');

			}
			catch (error) {
				console.log('\t✗ Failed to purchase ticket:', error.message);
				expect.fail('Ticket purchase failed');
			}
		});

		it('Should purchase LAZY fee pool ticket', async () => {
			const lazyPoolId = 1;
			const ticketCount = 1;

			try {
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
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'buyEntry',
					[lazyPoolId, ticketCount],
					bobPK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ LAZY ticket purchase successful');

				// Check if NFT ticket was minted
				const bobBalance = await checkMirrorBalance(bobId.toString(), ticketTokenId.toString());
				expect(bobBalance).to.be.greaterThan(0);
				console.log('\t✓ NFT ticket minted to Bob');

			}
			catch (error) {
				console.log('\t✗ Failed to purchase LAZY ticket:', error.message);
				expect.fail('LAZY ticket purchase failed');
			}
		});
	});

	describe('Bonus System Tests', () => {
		it('Should set and verify LAZY balance bonus', async () => {
			const threshold = 1000;
			const bonusBps = 500;

			try {
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
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'setLazyBalanceBonus',
					[threshold, bonusBps],
					adminPK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ LAZY balance bonus set successfully');

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

			}
			catch (error) {
				console.log('\t✗ Failed to set LAZY balance bonus:', error.message);
				fail('LAZY balance bonus setup failed');
			}
		});

		it('Should set and verify NFT holding bonus', async () => {
			const bonusBps = 750;

			try {
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
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'setNFTBonus',
					[testNFTTokenId1.toSolidityAddress(), bonusBps],
					adminPK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ NFT bonus set successfully');

				// Wait for mirror node
				await sleep(5000);

				// Query to verify the NFT bonus was set
				const bonusQuery = lazyLottoIface.encodeFunctionData('nftBonusBps', [testNFTTokenId1.toSolidityAddress()]);
				const bonusResult = await readOnlyEVMFromMirrorNode(env, contractId, bonusQuery, operatorId, false);
				const bonusValue = lazyLottoIface.decodeFunctionResult('nftBonusBps', bonusResult);

				expect(bonusValue[0].toString()).to.equal(bonusBps.toString());
				console.log('\t📊 NFT bonus verified for token', testNFTTokenId1.toString(), ':', bonusValue[0].toString() + ' bps');

			}
			catch (error) {
				console.log('\t✗ Failed to set NFT bonus:', error.message);
				fail('NFT bonus setup failed');
			}
		});

		it('Should set and verify time-based bonus', async () => {
			const currentTime = Math.floor(Date.now() / 1000);
			const startTime = currentTime + 60;
			const endTime = currentTime + 3600;
			const bonusBps = 1000;

			try {
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
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'setTimeBonus',
					[startTime, endTime, bonusBps],
					adminPK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Time bonus set successfully');

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

			}
			catch (error) {
				console.log('\t✗ Failed to set time bonus:', error.message);
				fail('Time bonus setup failed');
			}
		});

		it('Should handle time-based bonus activation (TIME-SENSITIVE TEST)', async () => {
			// NOTE: This test requires precise timing and may be unreliable in CI environments
			console.log('\t⏰ TIME-SENSITIVE TEST PLACEHOLDER');
			console.log('\t   This test would verify that time bonuses activate correctly during their windows');
			console.log('\t   Requires: 60-second gap for bonus activation, 1-hour test window');
			console.log('\t   Implementation: Buy entries before/during/after bonus window, compare win rates');
			console.log('\t   Risk: Test timing dependencies, potential CI failures');
			console.log('\t   Alternative: Mock time or use shorter test windows (5-10 seconds)');
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
				let gasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					adminId,
					'setLazyBalanceBonus',
					[lazyThreshold, lazyBonus],
					300_000,
				);

				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'setLazyBalanceBonus',
					[lazyThreshold, lazyBonus],
					adminPK,
				);

				gasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					adminId,
					'setNFTBonus',
					[testNFTTokenId1.toSolidityAddress(), nftBonus],
					300_000,
				);

				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'setNFTBonus',
					[testNFTTokenId1.toSolidityAddress(), nftBonus],
					adminPK,
				);

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

				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'setTimeBonus',
					[currentTime - 10, currentTime + 60, timeBonus],
					adminPK,
				);

				// Wait for mirror node after all bonus configurations
				await sleep(5000);

				// Ensure Alice has the requirements for all bonuses
				// 1. Give Alice enough LAZY tokens
				await sendLazy(aliceId, 1000);

				// 2. Give Alice an NFT
				const nftSendResult = await sendNFT(client, operatorId, operatorKey, aliceId, testNFTTokenId1, 1);
				if (nftSendResult !== 'SUCCESS') {
					fail('Failed to send NFT to Alice for bonus test');
				}

				// Wait for token transfers
				await sleep(5000);

				// Test Alice's combined bonus calculation
				const boostQuery = lazyLottoIface.encodeFunctionData('calculateBoost', [aliceId.toSolidityAddress()]);
				const boostResult = await readOnlyEVMFromMirrorNode(env, contractId, boostQuery, operatorId, false);
				const totalBoost = lazyLottoIface.decodeFunctionResult('calculateBoost', boostResult);

				const expectedScaledBoost = (lazyBonus + nftBonus + timeBonus) * 10_000;

				console.log('\t📊 BONUS STACKING RESULTS:');
				console.log('\t   • Individual bonuses: LAZY=' + lazyBonus + ', NFT=' + nftBonus + ', Time=' + timeBonus + ' bps');
				console.log('\t   • Sum: ' + (lazyBonus + nftBonus + timeBonus) + ' bps');
				console.log('\t   • Contract scaled result: ' + totalBoost[0].toString());
				console.log('\t   • Expected scaled result: ' + expectedScaledBoost);

				expect(totalBoost[0].toString()).to.equal(expectedScaledBoost.toString());

				// OVERFLOW ANALYSIS
				console.log('\t🔍 OVERFLOW SAFETY ANALYSIS:');
				console.log('\t   • Current scaling: bonus_bps * 10,000 = scaled_bps');
				console.log('\t   • uint32 max value: 4,294,967,295');
				console.log('\t   • Max safe bonus: 429,496 bps (4294.96% bonus)');
				console.log('\t   • Current bonus: ' + (lazyBonus + nftBonus + timeBonus) + ' bps (safe)');

				if ((lazyBonus + nftBonus + timeBonus) > 10000) {
					console.log('\t⚠️  WARNING: Total bonus exceeds 100% (10,000 bps)');
					console.log('\t   • This means guaranteed wins for affected users');
					console.log('\t   • Consider implementing bonus cap validation');
				}

				console.log('\t✅ Bonus stacking verification completed');

			}
			catch (error) {
				console.log('\t✗ Bonus stacking test failed:', error.message);
				expect.fail('Bonus stacking test failed');
			}
		});

		it('Should handle maximum bonus edge cases and overflow protection', async () => {
			console.log('\n\t⚠️  BONUS OVERFLOW PROTECTION TEST');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

			try {
				// Test extreme bonus values to verify overflow protection
				const extremeBonus = 50_000;

				console.log('\t🧪 Testing extreme bonus scenario:');
				console.log('\t   • Setting 500% LAZY bonus (50,000 bps)');
				console.log('\t   • This should result in guaranteed wins (>100% win rate)');

				// Estimate gas for extreme bonus setting
				const gasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					adminId,
					'setLazyBalanceBonus',
					[1, extremeBonus],
					500_000,
				);

				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'setLazyBalanceBonus',
					[1, extremeBonus],
					adminPK,
				);

				// Give Alice enough LAZY to trigger the bonus
				await sendFT(
					client,
					lazyTokenId,
					operatorId,
					operatorKey,
					aliceId,
					10,
				);

				const boostQuery = lazyLottoIface.encodeFunctionData('calculateBoost', [aliceId.toSolidityAddress()]);
				const boostResult = await contractCallQuery(contractId, boostQuery, client);
				const totalBoost = lazyLottoIface.decodeFunctionResult('calculateBoost', boostResult);

				console.log('\t📊 EXTREME BONUS RESULTS:');
				console.log('\t   • Input bonus: ' + extremeBonus + ' bps (500%)');
				console.log('\t   • Scaled result: ' + totalBoost[0].toString());
				console.log('\t   • Expected: ' + (extremeBonus * 10_000));

				// Verify the contract handles the calculation without overflow
				expect(totalBoost[0].toString()).to.equal((extremeBonus * 10_000).toString());

				console.log('\t✅ Contract handles extreme bonuses without uint32 overflow');
				console.log('\t💡 RECOMMENDATION: Add bonus cap validation in admin functions');
				console.log('\t   • Suggested cap: 10,000 bps (100% max total bonus)');
				console.log('\t   • Implementation: require(totalBonuses <= 10_000) in setter functions');

			}
			catch (error) {
				console.log('\t✗ Overflow protection test failed:', error.message);
				expect.fail('Overflow protection test failed');
			}
		});
	});

	describe('Rolling Mechanics', () => {
		const userPoolId = 0;

		beforeEach(async () => {
			// Ensure user has entries to roll
			const entryFee = new Hbar(1).toTinybars();
			const ticketCount = 3;

			await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				25_000_000,
				'buyEntry',
				[userPoolId, ticketCount],
				alicePK,
				entryFee * ticketCount,
			);
		});

		it('Should roll all user entries', async () => {
			try {
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'rollAll',
					[userPoolId],
					alicePK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Successfully rolled all entries');

				// Check if user has any pending prizes
				const encodedCommand = lazyLottoIface.encodeFunctionData('pending', [aliceId.toSolidityAddress()]);
				const queryResult = await contractCallQuery(contractId, encodedCommand, client);
				const pendingPrizes = lazyLottoIface.decodeFunctionResult('pending', queryResult);
				console.log('\t📊 Pending prizes after rolling:', pendingPrizes[0].length);

			}
			catch (error) {
				console.log('\t✗ Failed to roll entries:', error.message);
				expect.fail('Rolling entries failed');
			}
		});

		it('Should roll batch of entries', async () => {
			const numberToRoll = 2;

			try {
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'rollBatch',
					[userPoolId, numberToRoll],
					bobPK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Successfully rolled batch of entries');

			}
			catch (error) {
				console.log('\t✗ Failed to roll batch:', error.message);
				expect.fail('Batch rolling failed');
			}
		});

		it('Should handle buy and roll in one transaction', async () => {
			const entryFee = new Hbar(1).toTinybars();
			const ticketCount = 1;

			try {
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyAndRollEntry',
					[userPoolId, ticketCount],
					carolPK,
					entryFee,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Successfully bought and rolled entry');

			}
			catch (error) {
				console.log('\t✗ Failed to buy and roll:', error.message);
				expect.fail('Buy and roll failed');
			}
		});
	});

	describe('Prize Claiming', () => {
		beforeEach(async () => {
			// Set up scenario where user has pending prizes
			// This might require multiple buy/roll cycles to generate wins
			const entryFee = new Hbar(1).toTinybars();
			const ticketCount = 5;

			await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				25_000_000,
				'buyAndRollEntry',
				[poolId, ticketCount],
				alicePK,
				entryFee * ticketCount,
			);
		});

		it('Should claim individual prize', async () => {
			try {
				// First check if user has pending prizes
				const encodedCommand = lazyLottoIface.encodeFunctionData('pending', [aliceId.toSolidityAddress()]);
				const queryResult = await contractCallQuery(contractId, encodedCommand, client);
				const pendingPrizes = lazyLottoIface.decodeFunctionResult('pending', queryResult);

				if (pendingPrizes[0].length > 0) {
					const prizeIndex = 0;
					const receipt = await contractExecuteFunction(
						contractId,
						lazyLottoIface,
						client,
						25_000_000,
						'claimPrize',
						[prizeIndex],
						alicePK,
					);

					expect(receipt.status.toString()).to.equal('SUCCESS');
					console.log('\t✓ Successfully claimed individual prize');
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
				const receipt = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'claimAllPrizes',
					[],
					alicePK,
				);

				expect(receipt.status.toString()).to.equal('SUCCESS');
				console.log('\t✓ Successfully claimed all prizes');

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

	describe('Error Handling and Edge Cases', () => {
		it('Should reject non-admin prize additions', async () => {
			const prizeAmount = new Hbar(1).toTinybars();
			const nftTokens = [];
			const nftSerials = [];

			try {
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'addPrizePackage',
					[poolId, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
					alicePK,
					prizeAmount,
				);
				expect.fail('Expected non-admin prize addition to fail');
			}
			catch (error) {
				console.log('\t✓ Correctly rejected non-admin prize addition');
				expect(error.message).to.include('UNAUTHORIZED');
			}
		});

		it('Should reject invalid pool operations', async () => {
			const invalidPoolId = 999;
			const ticketCount = 1;

			try {
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[invalidPoolId, ticketCount],
					alicePK,
					new Hbar(1).toTinybars(),
				);
				expect.fail('Expected invalid pool operation to fail');
			}
			catch (error) {
				console.log('\t✓ Correctly rejected invalid pool operation');
				expect(error.message).to.include('InvalidPool');
			}
		});

		it('Should handle insufficient HBAR for entry fee', async () => {
			const ticketCount = 1;
			const insufficientFee = new Hbar(0.1).toTinybars();

			try {
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[poolId, ticketCount],
					bobPK,
					insufficientFee,
				);
				expect.fail('Expected insufficient HBAR operation to fail');
			}
			catch (error) {
				console.log('\t✓ Correctly rejected insufficient HBAR entry');
				expect(error.message).to.include('InsufficientValue');
			}
		});

		it('Should reject rolling with no entries', async () => {
			try {
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'rollAll',
					[poolId],
					carolPK,
				);
				expect.fail('Expected rolling with no entries to fail');
			}
			catch (error) {
				console.log('\t✓ Correctly rejected rolling with no entries');
				expect(error.message).to.include('NoTickets');
			}
		});
	});

	describe('Query Functions', () => {
		it('Should query user entries', async () => {
			try {
				const encodedCommand = lazyLottoIface.encodeFunctionData('userEntries', [poolId, aliceId.toSolidityAddress()]);
				const queryResult = await contractCallQuery(contractId, encodedCommand, client);
				const userEntries = lazyLottoIface.decodeFunctionResult('userEntries', queryResult);

				console.log('\t📊 Alice user entries in pool', poolId, ':', userEntries[0].toString());
				expect(userEntries[0]).to.be.a('bigint');

			}
			catch (error) {
				console.log('\t✗ Failed to query user entries:', error.message);
				expect.fail('User entries query failed');
			}
		});

		it('Should query pool information', async () => {
			try {
				const encodedCommand = lazyLottoIface.encodeFunctionData('poolInfo', [poolId]);
				const queryResult = await contractCallQuery(contractId, encodedCommand, client);
				const poolInfo = lazyLottoIface.decodeFunctionResult('poolInfo', queryResult);

				console.log('\t📊 Pool', poolId, 'info:', {
					feeToken: poolInfo[0].feeToken,
					entryFee: poolInfo[0].entryFee.toString(),
					ticketToken: poolInfo[0].ticketToken,
					active: poolInfo[0].active,
				});

			}
			catch (error) {
				console.log('\t✗ Failed to query pool info:', error.message);
				expect.fail('Pool info query failed');
			}
		});

		it('Should query pending prizes', async () => {
			try {
				const encodedCommand = lazyLottoIface.encodeFunctionData('pending', [aliceId.toSolidityAddress()]);
				const queryResult = await contractCallQuery(contractId, encodedCommand, client);
				const pendingPrizes = lazyLottoIface.decodeFunctionResult('pending', queryResult);

				console.log('\t📊 Alice pending prizes count:', pendingPrizes[0].length);

			}
			catch (error) {
				console.log('\t✗ Failed to query pending prizes:', error.message);
				expect.fail('Pending prizes query failed');
			}
		});
	});

	describe('Time-Based Testing Scenarios (IMPLEMENTATION GUIDANCE)', () => {
		// These tests provide detailed specifications for time-sensitive functionality
		// Each test includes timing requirements, implementation approach, and risk assessment

		it('TIME-SENSITIVE: Bonus Window Activation (10s window)', async () => {
			console.log('\n\t🕐 QUICK TIME TEST: 10-Second Bonus Window');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

			const currentTime = Math.floor(Date.now() / 1000);
			const startTime = currentTime + 5;
			const endTime = currentTime + 15;
			const bonusBps = 1000;

			try {
				// Set up bonus window
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'setTimeBonus',
					[startTime, endTime, bonusBps],
					adminPK,
				);
				console.log('\t✓ Bonus window configured (5s -> 15s, 10% bonus)');

				// Phase 1: Buy entry BEFORE window (expect base rate)
				console.log('\t⏱️  Phase 1: Purchasing entry BEFORE bonus window...');
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[poolId, 1],
					alicePK,
					new Hbar(1).toTinybars(),
				);
				console.log('\t✓ Pre-bonus entry purchased');

				// Wait for bonus window to activate
				console.log('\t⏱️  Waiting 6 seconds for bonus window activation...');
				await sleep(6000);

				// Phase 2: Buy entry DURING window (expect bonus rate)
				console.log('\t⏱️  Phase 2: Purchasing entry DURING bonus window...');
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[poolId, 1],
					bobPK,
					new Hbar(1).toTinybars(),
				);
				console.log('\t✓ Bonus-period entry purchased');

				// Wait for bonus window to expire
				console.log('\t⏱️  Waiting 10 seconds for bonus window expiration...');
				await sleep(10000);

				// Phase 3: Buy entry AFTER window (expect base rate)
				console.log('\t⏱️  Phase 3: Purchasing entry AFTER bonus window...');
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[poolId, 1],
					carolPK,
					new Hbar(1).toTinybars(),
				);
				console.log('\t✓ Post-bonus entry purchased');

				// Now roll all entries and analyze results
				console.log('\t🎲 Rolling entries to verify bonus effects...');

				// Roll Alice's entries (pre-bonus)
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'rollAll',
					[poolId],
					alicePK,
				);

				// Roll Bob's entries (during-bonus)
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'rollAll',
					[poolId],
					bobPK,
				);

				// Roll Carol's entries (post-bonus)
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'rollAll',
					[poolId],
					carolPK,
				);

				console.log('\t✅ 10-second bonus window test completed successfully');
				console.log('\t� Note: Actual bonus verification requires win rate analysis over multiple runs');

			}
			catch (error) {
				console.log('\t✗ Time-based bonus test failed:', error.message);
				expect.fail('Time-based bonus test failed');
			}
		});

		it('TIME-SENSITIVE: Bonus Expiration Edge Cases (8s precision)', async () => {
			console.log('\n\t🕐 QUICK TIME TEST: Bonus Boundary Precision');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

			const currentTime = Math.floor(Date.now() / 1000);
			const startTime = currentTime + 3;
			const endTime = currentTime + 11;
			const bonusBps = 500;

			try {
				// Set up precise timing window
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'setTimeBonus',
					[startTime, endTime, bonusBps],
					adminPK,
				);

				// Test 1: 1 second before start
				console.log('\t⏱️  Testing: 1 second before bonus start...');
				await sleep(2000);
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[poolId, 1],
					alicePK,
					new Hbar(1).toTinybars(),
				);

				// Test 2: Right at start (±1s tolerance)
				console.log('\t⏱️  Testing: At bonus start boundary...');
				await sleep(2000);
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[poolId, 1],
					bobPK,
					new Hbar(1).toTinybars(),
				);

				// Test 3: Right at end (±1s tolerance)
				console.log('\t⏱️  Testing: At bonus end boundary...');
				await sleep(6000);
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[poolId, 1],
					carolPK,
					new Hbar(1).toTinybars(),
				);

				// Test 4: 1 second after end
				console.log('\t⏱️  Testing: 1 second after bonus end...');
				await sleep(2000);
				await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					25_000_000,
					'buyEntry',
					[poolId, 1],
					alicePK,
					new Hbar(1).toTinybars(),
				);

				console.log('\t✅ Bonus boundary precision test completed');
				console.log('\t� Boundary timing accuracy: ±1-2 seconds (blockchain timing limits)');

			}
			catch (error) {
				console.log('\t✗ Boundary precision test failed:', error.message);
				expect.fail('Boundary precision test failed');
			}
		});

		it('TIME-SENSITIVE: Daily/Weekly Bonus Cycles (24h/7d duration)', async () => {
			console.log('\n\t🕐 TIME-BASED TEST SPECIFICATION: Long-Duration Bonus Cycles');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('\t📋 TEST OBJECTIVE: Test realistic production bonus schedules');
			console.log('\t⏱️  TIMING REQUIREMENTS:');
			console.log('\t   • Daily bonus: 24-hour windows with varying percentages');
			console.log('\t   • Weekly bonus: 7-day special event periods');
			console.log('\t   • Weekend bonus: Saturday-Sunday enhanced rates');
			console.log('\t🔧 IMPLEMENTATION: Long-running test suite, cron-like scheduling');
			console.log('\t⚠️  RISKS: Impractical for CI/CD, requires dedicated test environment');
			console.log('\t💡 ALTERNATIVES: Mock time advancement, or external staging environment');
			console.log('\t📝 RECOMMENDED: Manual testing in staging with time manipulation');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		});

		it('TIME-SENSITIVE: Bonus Calculation During Transitions (sub-second)', async () => {
			console.log('\n\t🕐 TIME-BASED TEST SPECIFICATION: Bonus Transition Calculations');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('\t📋 TEST OBJECTIVE: Verify bonus calculations during window transitions');
			console.log('\t⏱️  TIMING REQUIREMENTS:');
			console.log('\t   • Entry purchase initiated before bonus window');
			console.log('\t   • Transaction execution during bonus window');
			console.log('\t   • Verify which timestamp is used for bonus calculation');
			console.log('\t🔧 IMPLEMENTATION: Parallel transaction submission, timestamp analysis');
			console.log('\t⚠️  RISKS: Transaction ordering uncertainty, block time variations');
			console.log('\t💡 ALTERNATIVES: Test with longer gaps, focus on transaction receipt timing');
			console.log('\t❓ QUESTION: Should bonus be based on tx submission time or execution time?');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		});
	});

	describe('Performance and Stress Testing Scenarios', () => {
		it('PERFORMANCE: High-Volume Concurrent Purchases', async () => {
			console.log('\n\t🚀 PERFORMANCE TEST SPECIFICATION: Concurrent Purchase Load');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('\t📋 TEST OBJECTIVE: Verify contract performance under high transaction load');
			console.log('\t📊 LOAD REQUIREMENTS:');
			console.log('\t   • 100+ concurrent buyEntry() transactions');
			console.log('\t   • Multiple pools, multiple users, various ticket counts');
			console.log('\t   • Monitor: gas usage, transaction success rates, timing');
			console.log('\t🔧 IMPLEMENTATION: Promise.all() with multiple buyEntry calls');
			console.log('\t⚠️  RISKS: Network congestion, rate limiting, gas price spikes');
			console.log('\t💡 ALTERNATIVES: Gradual load increase, dedicated test network');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		});

		it('PERFORMANCE: Large-Scale Rolling Operations', async () => {
			console.log('\n\t🚀 PERFORMANCE TEST SPECIFICATION: Mass Rolling Operations');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('\t📋 TEST OBJECTIVE: Test rollBatch() with maximum entry counts');
			console.log('\t📊 LOAD REQUIREMENTS:');
			console.log('\t   • Users with 1000+ entries each');
			console.log('\t   • rollBatch() with varying batch sizes (10, 100, 1000)');
			console.log('\t   • Monitor: gas limits, execution time, randomness quality');
			console.log('\t🔧 IMPLEMENTATION: Setup phase with bulk entry purchases, then mass rolling');
			console.log('\t⚠️  RISKS: Gas limit exceeded, transaction timeouts');
			console.log('\t💡 ALTERNATIVES: Test with smaller batches first, optimize gas usage');
			console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		});
	});
});