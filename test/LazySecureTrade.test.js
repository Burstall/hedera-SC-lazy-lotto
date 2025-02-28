const fs = require('fs');
const { ethers } = require('ethers');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const {
	Client,
	AccountId,
	PrivateKey,
	// eslint-disable-next-line no-unused-vars
	TokenId,
	// eslint-disable-next-line no-unused-vars
	ContractId,
	ContractFunctionParameters,
	HbarUnit,
	Hbar,
} = require('@hashgraph/sdk');

const {
	contractDeployFunction,
	contractExecuteFunction,
	contractExecuteQuery,
	readOnlyEVMFromMirrorNode,
} = require('../utils/solidityHelpers');
const {
	accountCreator,
	associateTokensToAccount,
	mintNFT,
	sendNFT,
	clearNFTAllowances,
	clearFTAllowances,
	setNFTAllowanceAll,
	sendHbar,
	setHbarAllowance,
	setFTAllowance,
	sweepHbar,
	sendNFTDefeatRoyalty,
} = require('../utils/hederaHelpers');
const { fail } = require('assert');
const {
	checkLastMirrorEvent,
	checkFTAllowances,
	checkMirrorBalance,
	checkMirrorHbarBalance,
} = require('../utils/hederaMirrorHelpers');
const { sleep } = require('../utils/nodeHelpers');
require('dotenv').config();

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

const lazyContractCreator = 'LAZYTokenCreator';
const lazyGasStationName = 'LazyGasStation';
const contractName = 'LazySecureTrade';
const lazyDelegateRegistryName = 'LazyDelegateRegistry';
const env = process.env.ENVIRONMENT ?? null;
const LAZY_BURN_PERCENT = process.env.LAZY_BURN_PERCENT ?? 25;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;
const LAZY_COST_FOR_TRADE = process.env.LAZY_COST_FOR_TRADE ?? 103;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variables
let lstContractAddress, lstContractId, ldrAddress;
let lazyIface, lazyGasStationIface, lazySecureTradeIface, lazyDelegateRegistryIface;
let lazyTokenId;
let alicePK, aliceId;
let bobPK, bobId;
let client;
let lazySCT;
let StkNFTA_TokenId,
	StkNFTB_TokenId,
	StkNFTC_TokenId;
let lazyGasStationId;

const operatorFtAllowances = [];
const operatorNftAllowances = [];

describe('Deployment', () => {
	it('Should deploy the contract and setup conditions', async () => {
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
			const rootKey = PrivateKey.fromStringED25519(
				'302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137',
			);

			// create an operator account on the local node and use this for testing as operator
			client.setOperator(rootId, rootKey);
			operatorKey = PrivateKey.generateED25519();
			operatorId = await accountCreator(client, operatorKey, 1000);
		}
		else {
			console.log(
				'ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file',
			);
			return;
		}

		client.setOperator(operatorId, operatorKey);
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		// moving account create up to fail fast is the service is busy.

		// create Alice account
		if (process.env.ALICE_ACCOUNT_ID && process.env.ALICE_PRIVATE_KEY) {
			aliceId = AccountId.fromString(process.env.ALICE_ACCOUNT_ID);
			alicePK = PrivateKey.fromStringED25519(process.env.ALICE_PRIVATE_KEY);
			console.log('\n-Using existing Alice:', aliceId.toString());

			// check if Alice has hbars
			const hbarBalance = await checkMirrorHbarBalance(env, aliceId);
			if (hbarBalance < Number(new Hbar(200, HbarUnit.Hbar).toTinybars())) {
				await sendHbar(client, operatorId, aliceId, 200, HbarUnit.Hbar);
			}
		}
		else {
			alicePK = PrivateKey.generateED25519();
			aliceId = await accountCreator(client, alicePK, 200);
			console.log(
				'Alice account ID:',
				aliceId.toString(),
				aliceId.toSolidityAddress(),
				'\nkey:',
				alicePK.toString(),
			);
		}
		expect(aliceId.toString().match(addressRegex).length == 2).to.be.true;

		// create Bob account
		if (process.env.BOB_ACCOUNT_ID && process.env.BOB_PRIVATE_KEY) {
			bobId = AccountId.fromString(process.env.BOB_ACCOUNT_ID);
			bobPK = PrivateKey.fromStringED25519(process.env.BOB_PRIVATE_KEY);
			console.log('\n-Using existing Bob:', bobId.toString());

			// send Bob some hbars
			const hbarBalance = await checkMirrorHbarBalance(env, bobId);
			if (hbarBalance < Number(new Hbar(50, HbarUnit.Hbar).toTinybars())) {
				await sendHbar(client, operatorId, bobId, 50, HbarUnit.Hbar);
			}
		}
		else {
			bobPK = PrivateKey.generateED25519();
			bobId = await accountCreator(client, bobPK, 50);
			console.log(
				'Bob account ID:',
				bobId.toString(),
				bobId.toSolidityAddress(),
				'\nkey:',
				bobPK.toString(),
			);
		}
		expect(bobId.toString().match(addressRegex).length == 2).to.be.true;

		// outside the if statement as we always need this abi
		// check if LAZY SCT has been deployed
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);

		// import ABIs
		lazyIface = new ethers.Interface(lazyJson.abi);

		const lazyContractBytecode = lazyJson.bytecode;

		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			console.log(
				'\n-Using existing LAZY SCT:',
				process.env.LAZY_SCT_CONTRACT_ID,
			);
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);


			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			console.log('\n-Using existing LAZY Token ID:', lazyTokenId.toString());
		}
		else {
			const gasLimit = 800_000;

			console.log(
				'\n- Deploying contract...',
				lazyContractCreator,
				'\n\tgas@',
				gasLimit,
			);

			[lazySCT] = await contractDeployFunction(client, lazyContractBytecode);

			console.log(
				`Lazy Token Creator contract created with ID: ${lazySCT} / ${lazySCT.toSolidityAddress()}`,
			);

			expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;

			// mint the $LAZY FT
			await mintLazy(
				'Test_Lazy',
				'TLazy',
				'Test Lazy FT',
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				LAZY_DECIMAL,
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				30,
			);
			console.log('$LAZY Token minted:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;

		const lazyGasStationJSON = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);

		lazyGasStationIface = new ethers.Interface(lazyGasStationJSON.abi);
		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			console.log(
				'\n-Using existing Lazy Gas Station:',
				process.env.LAZY_GAS_STATION_CONTRACT_ID,
			);
			lazyGasStationId = ContractId.fromString(
				process.env.LAZY_GAS_STATION_CONTRACT_ID,
			);
		}
		else {
			const gasLimit = 1_500_000;
			console.log(
				'\n- Deploying contract...',
				lazyGasStationName,
				'\n\tgas@',
				gasLimit,
			);

			const lazyGasStationBytecode = lazyGasStationJSON.bytecode;

			const lazyGasStationParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazySCT.toSolidityAddress());

			[lazyGasStationId] = await contractDeployFunction(
				client,
				lazyGasStationBytecode,
				gasLimit,
				lazyGasStationParams,
			);

			console.log(
				`Lazy Gas Station contract created with ID: ${lazyGasStationId} / ${lazyGasStationId.toSolidityAddress()}`,
			);

			expect(lazyGasStationId.toString().match(addressRegex).length == 2).to.be
				.true;
		}

		const ldrJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
			),
		);

		const ldrBytecode = ldrJson.bytecode;

		lazyDelegateRegistryIface = ethers.Interface.from(ldrJson.abi);

		if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			console.log(
				'\n-Using existing Lazy Delegate Registry:',
				process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			);
			ldrAddress = ContractId.fromString(
				process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			);
		}
		else {
			const gasLimit = 500_000;

			console.log('\n- Deploying contract...', lazyDelegateRegistryName, '\n\tgas@', gasLimit);

			[ldrAddress] = await contractDeployFunction(client, ldrBytecode, gasLimit);

			console.log(
				`Lazy Delegate Registry contract created with ID: ${ldrAddress} / ${ldrAddress.toSolidityAddress()}`,
			);

			expect(ldrAddress.toString().match(addressRegex).length == 2).to.be.true;
		}

		// mint NFTs from the 3rd party Alice Account
		// ensure royalties in place
		/*
			3 x Different NFTs of size 10 each
		*/

		const nftSize = 10;

		client.setOperator(aliceId, alicePK);
		let [result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Stk NFT A',
			'StkNFTA',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		StkNFTA_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Stk NFT B',
			'StkNFTB',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		StkNFTB_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Stk NFT C',
			'StkNFTC',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		StkNFTC_TokenId = tokenId;

		// revert back to operator
		client.setOperator(operatorId, operatorKey);


		const gasLimit = 2_500_000;

		// now deploy main contract
		const lazySecureTradeJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
			),
		);

		// import ABI
		lazySecureTradeIface = ethers.Interface.from(lazySecureTradeJson.abi);

		const contractBytecode = lazySecureTradeJson.bytecode;

		console.log(
			'\n- Deploying contract...',
			contractName,
			'\n\tgas@',
			gasLimit,
		);

		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazyGasStationId.toSolidityAddress())
			.addAddress(ldrAddress.toSolidityAddress())
			.addAddress(StkNFTB_TokenId.toSolidityAddress())
			.addAddress(StkNFTC_TokenId.toSolidityAddress())
			.addAddress(StkNFTC_TokenId.toSolidityAddress())
			.addUint256(LAZY_COST_FOR_TRADE)
			.addUint256(LAZY_BURN_PERCENT);

		[lstContractId, lstContractAddress] = await contractDeployFunction(
			client,
			contractBytecode,
			gasLimit,
			constructorParams,
		);

		expect(lstContractId.toString().match(addressRegex).length == 2).to.be.true;

		console.log(
			`Lazy Secure Trade Contract created with ID: ${lstContractId} / ${lstContractAddress}`,
		);

		console.log('\n-Testing:', contractName);

		// associate the FTs & NFT to operator
		client.setOperator(operatorId, operatorKey);
		const operatorTokensToAssociate = [];
		// check if the lazy token is already associated to the operator
		if (await checkMirrorBalance(env, operatorId, lazyTokenId) === null) {
			operatorTokensToAssociate.push(lazyTokenId);
		}
		operatorTokensToAssociate.push(
			StkNFTA_TokenId,
			StkNFTB_TokenId,
			StkNFTC_TokenId,
		);

		result = await associateTokensToAccount(
			client,
			operatorId,
			operatorKey,
			operatorTokensToAssociate,
		);

		expect(result).to.be.equal('SUCCESS');

		// associate the token for Alice
		// alice has the NFTs already associated

		// check the balance of lazy tokens for Alice from mirror node
		const aliceLazyBalance = await checkMirrorBalance(
			env,
			aliceId,
			lazyTokenId,
		);

		if (!aliceLazyBalance) {
			result = await associateTokensToAccount(client, aliceId, alicePK, [
				lazyTokenId,
			]);
			expect(result).to.be.equal('SUCCESS');
		}

		// check the balance of lazy tokens for Bob from mirror node
		const bobLazyBalance = await checkMirrorBalance(env, bobId, lazyTokenId);

		const bobTokensToAssociate = [];
		if (!bobLazyBalance) {
			bobTokensToAssociate.push(lazyTokenId);
		}

		bobTokensToAssociate.push(
			StkNFTA_TokenId,
			StkNFTB_TokenId,
			StkNFTC_TokenId,
		);

		// associate the tokens for Bob
		result = await associateTokensToAccount(
			client,
			bobId,
			bobPK,
			bobTokensToAssociate,
		);
		expect(result).to.be.equal('SUCCESS');

		// send $LAZY to all accounts
		client.setOperator(operatorId, operatorKey);
		result = await sendLazy(operatorId, 600);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(aliceId, 900);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(bobId, 900);
		expect(result).to.be.equal('SUCCESS');
		result = await sendHbar(client, operatorId, AccountId.fromString(lazyGasStationId.toString()), 1, HbarUnit.Hbar);
		expect(result).to.be.equal('SUCCESS');

		// send $LAZY to the Lazy Gas Station
		// gas station will fuel payouts so ensure it has enough
		result = await sendLazy(lazyGasStationId, 100_000);
		expect(result).to.be.equal('SUCCESS');

		// add the LST to the lazy gas station as a contract user
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'addContractUser',
			[lstContractId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR adding LST to LGS:', result);
			fail();
		}

		// check the GasStationAccessControlEvent on the mirror node
		await sleep(4500);
		const lgsEvent = await checkLastMirrorEvent(
			env,
			lazyGasStationId,
			lazyGasStationIface,
			1,
			true,
		);

		expect(lgsEvent.toSolidityAddress().toLowerCase()).to.be.equal(
			lstContractId.toSolidityAddress(),
		);

		client.setOperator(aliceId, alicePK);

		// send NFTs 1-5 to Operator
		const serials = [...Array(nftSize).keys()].map((x) => ++x);
		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			StkNFTA_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			StkNFTB_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			StkNFTC_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');
	});
});

describe('Check Contract Deployment', () => {
	it('Should check the contract configuration', async () => {
		client.setOperator(operatorId, operatorKey);

		// get tradeNonce
		const tradeNonceResult = await contractExecuteQuery(
			lstContractId,
			lazySecureTradeIface,
			client,
			null,
			'tradeNonce',
		);
		expect(Number(tradeNonceResult[0])).to.be.equal(
			0,
		);

		// get lazyBurnPercentage
		const burnPercentageResult = await contractExecuteQuery(
			lstContractId,
			lazySecureTradeIface,
			client,
			null,
			'lazyBurnPercentage',
		);
		expect(Number(burnPercentageResult[0])).to.be.equal(
			Number(LAZY_BURN_PERCENT),
		);

		// get lazyCostForTrade
		const lazyCostForTradeResult = await contractExecuteQuery(
			lstContractId,
			lazySecureTradeIface,
			client,
			null,
			'lazyCostForTrade',
		);
		expect(Number(lazyCostForTradeResult[0])).to.be.equal(
			Number(LAZY_COST_FOR_TRADE),
		);

		// get contractSunset
		const contractSunsetResult = await contractExecuteQuery(
			lstContractId,
			lazySecureTradeIface,
			client,
			null,
			'contractSunset',
		);
		// expect the reult to be > 88 days from now
		expect(Number(contractSunsetResult[0])).to.be.greaterThan(
			Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 88,
		);

		// get LSH_GEN1
		const lshGen1Result = await contractExecuteQuery(
			lstContractId,
			lazySecureTradeIface,
			client,
			null,
			'LSH_GEN1',
		);

		expect(lshGen1Result[0].slice(2).toLowerCase()).to.be.equal(
			StkNFTB_TokenId.toSolidityAddress().toLowerCase(),
		);

		// get LSH_GEN2 from the mirror nodes
		const encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'LSH_GEN2',
		);

		const lshGen2 = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const lshGenResult = lazySecureTradeIface.decodeFunctionResult(
			'LSH_GEN2',
			lshGen2,
		);

		expect(lshGenResult[0].slice(2).toLowerCase()).to.be.equal(
			StkNFTC_TokenId.toSolidityAddress().toLowerCase(),
		);
	});

	it('Should check access controls', async () => {
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		// ALICE is not owner so expect failures
		client.setOperator(aliceId, alicePK);

		// setLazyCostForTrade
		try {
			const result = await contractExecuteFunction(
				lstContractId,
				lazySecureTradeIface,
				client,
				null,
				'setLazyCostForTrade',
				[1],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (setLazyCostForTrade):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// setLazyBurnPercentage
		try {
			const result = await contractExecuteFunction(
				lstContractId,
				lazySecureTradeIface,
				client,
				null,
				'setLazyBurnPercentage',
				[11],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (setLazyBurnPercentage):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// extendSunset
		try {
			const result = await contractExecuteFunction(
				lstContractId,
				lazySecureTradeIface,
				client,
				null,
				'extendSunset',
				[1],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (extendSunset):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// transferHbar
		try {
			const result = await contractExecuteFunction(
				lstContractId,
				lazySecureTradeIface,
				client,
				null,
				'transferHbar',
				[aliceId.toSolidityAddress(), 1],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (transferHbar):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// retrieveLazy
		try {
			const result = await contractExecuteFunction(
				lstContractId,
				lazySecureTradeIface,
				client,
				null,
				'retrieveLazy',
				[aliceId.toSolidityAddress(), 1],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				console.log('Expected Result (retrieveLazy):', result);
				expectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		console.log('Expected errors:', expectedErrors);
		console.log('Unexpected errors:', unexpectedErrors);

		expect(expectedErrors).to.be.equal(5);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('Secure Trades are go...', () => {
	it('Operator Creates a trade for Bob (hbar only)', async () => {
		client.setOperator(operatorId, operatorKey);

		// set an NFT allowance for the operator to the contract
		const nftAllowanceResult = await setNFTAllowanceAll(
			client,
			[StkNFTA_TokenId],
			operatorId,
			AccountId.fromString(lstContractId.toString()),
		);

		operatorNftAllowances.push({
			tokenId: StkNFTA_TokenId,
			owner: operatorId,
			spender: AccountId.fromString(lstContractId.toString()),
		});

		expect(nftAllowanceResult).to.be.equal('SUCCESS');

		// create a trade for Bob
		const tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			950_000 + 500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				bobId.toSolidityAddress(),
				1,
				Number(new Hbar(1, HbarUnit.Hbar).toTinybars()),
				0,
				0,
			],
		);

		expect(tradeResult[0].status.toString()).to.be.equal('SUCCESS');

		console.log('Trade created:', tradeResult[2]?.transactionId?.toString());
	});

	it('Check Alice/Operator can not accept the trade', async () => {
		// let mirror node catch up
		await sleep(5000);

		client.setOperator(aliceId, alicePK);
		// query trades available to Alice (expect 0) via mirror node
		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getUserTrades',
			[aliceId.toSolidityAddress()],
		);

		let userTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		let userTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getUserTrades',
			userTrades,
		);

		expect(userTradesResult[0].length).to.be.equal(0);

		// execute getUserTrades for Bob via mirror node
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getUserTrades',
			[bobId.toSolidityAddress()],
		);

		userTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		userTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getUserTrades',
			userTrades,
		);

		expect(userTradesResult[0].length).to.be.equal(1);

		const bobTrade = userTradesResult[0][0];

		// make sure the token is not in getTokenTrades for StkNFTA
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getTokenTrades',
			[StkNFTA_TokenId.toSolidityAddress()],
		);

		const tokenTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tokenTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getTokenTrades',
			tokenTrades,
		);

		expect(tokenTradesResult[0].length).to.be.equal(0);

		// check isTradeValid for address(0) expect true
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[bobTrade, ethers.ZeroAddress],
		);

		const tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.true;

		// executeTrade for Alice expect failure with TradeNotFoundOrInvalid
		let tradeExecutionResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			650_000,
			'executeTrade',
			[bobTrade],
			new Hbar(1, HbarUnit.Hbar),
		);

		if (tradeExecutionResult[0]?.status?.name != 'TradeNotFoundOrInvalid') {
			console.log('ERROR expecting TradeNotFoundOrInvalid:', tradeExecutionResult);
			fail();
		}

		// now try as operator
		client.setOperator(operatorId, operatorKey);

		// check isTradeValid for Operator expect true (as operator is the seeller)

		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[bobTrade, operatorId.toSolidityAddress()],
		);

		const tradeValidOperator = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tradeValidOperatorResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValidOperator,
		);

		expect(tradeValidOperatorResult[0]).to.be.true;

		// valid trade but not executable
		// executeTrade for Operator expect failure TradeNotFoundOrInvalid

		tradeExecutionResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			650_000,
			'executeTrade',
			[bobTrade],
			new Hbar(1, HbarUnit.Hbar),
		);

		if (tradeExecutionResult[0]?.status?.name != 'SellerCannotBeBuyer') {
			console.log('ERROR expecting SellerCannotBeBuyer:', tradeExecutionResult);
			fail();
		}
	});

	it('Bob accepts the trade', async () => {
		client.setOperator(bobId, bobPK);
		// Query the trades available to Bob
		// execute getUserTrades for Bob via mirror node
		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getUserTrades',
			[bobId.toSolidityAddress()],
		);

		const userTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const userTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getUserTrades',
			userTrades,
		);

		expect(userTradesResult[0].length).to.be.equal(1);

		const bobTrade = userTradesResult[0][0];

		console.log('Bob trade:', bobTrade);

		// check the trade details
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getTrade',
			[bobTrade],
		);

		const trade = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tradeResult = lazySecureTradeIface.decodeFunctionResult(
			'getTrade',
			trade,
		);

		console.log('Bob trade details:', tradeResult);

		// check isTradeValid for Bob expect true
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[bobTrade, bobId.toSolidityAddress()],
		);

		const tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		console.log('Bob trade valid:', tradeValidResult);

		expect(tradeValidResult[0]).to.be.true;

		// set a 1 tinybar allowance to LST
		const allowanceResult = await setHbarAllowance(
			client,
			bobId,
			AccountId.fromString(lstContractId.toString()),
			1,
			HbarUnit.Tinybar,
		);

		expect(allowanceResult).to.be.equal('SUCCESS');

		// executeTrade
		// sending > 1 hbar to check the additional value is returned
		const tradeExecutionResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			650_000,
			'executeTrade',
			[bobTrade],
			new Hbar(2, HbarUnit.Hbar),
		);

		if (tradeExecutionResult[0].status.toString() != 'SUCCESS') {
			console.log('Trade Execution Error:', tradeExecutionResult);
			fail();
		}

		console.log('Bob Trade Execution tx:', tradeExecutionResult[2]?.transactionId?.toString());
	});

	it('Operator creates a listing for Alice for $LAZY (0 hbar), Alice Accepts', async () => {
		client.setOperator(operatorId, operatorKey);

		// set an NFT allowance for the operator to the contract
		const nftAllowanceResult = await setNFTAllowanceAll(
			client,
			[StkNFTB_TokenId],
			operatorId,
			AccountId.fromString(lstContractId.toString()),
		);

		operatorNftAllowances.push({
			tokenId: StkNFTB_TokenId,
			owner: operatorId,
			spender: AccountId.fromString(lstContractId.toString()),
		});

		expect(nftAllowanceResult).to.be.equal('SUCCESS');

		// create a trade for Alice
		let tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			950_000 + 500_000,
			'createTrade',
			[
				StkNFTB_TokenId.toSolidityAddress(),
				aliceId.toSolidityAddress(),
				1,
				0,
				23,
				0,
			],
		);

		expect(tradeResult[0].status.toString()).to.be.equal('SUCCESS');

		// let mirror node catch up
		await sleep(5000);

		client.setOperator(aliceId, alicePK);

		// query trades available to Alice (expect 1) via mirror node
		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getUserTrades',
			[aliceId.toSolidityAddress()],
		);

		const userTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const userTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getUserTrades',
			userTrades,
		);

		expect(userTradesResult[0].length).to.be.equal(1);

		const aliceTrade = userTradesResult[0][0];

		// trade hash should be the keccak256 of token and serial
		const tradeHashToCheck = ethers.solidityPackedKeccak256(
			['address', 'uint256'],
			[StkNFTB_TokenId.toSolidityAddress(), 1],
		);

		expect(aliceTrade).to.be.equal(tradeHashToCheck);

		// check the trade details
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getTrade',
			[aliceTrade],
		);

		const trade = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		tradeResult = lazySecureTradeIface.decodeFunctionResult(
			'getTrade',
			trade,
		);

		console.log('Alice trade details:', tradeResult);

		// check isTradeValid for Alice expect true
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[aliceTrade, aliceId.toSolidityAddress()],
		);

		const tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		console.log('Alice trade valid:', tradeValidResult);

		expect(tradeValidResult[0]).to.be.true;

		// set a 1 tinybar allowance to LST
		const allowanceResult = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			AccountId.fromString(lazyGasStationId.toString()),
			23,
		);

		// set a 1 tinybar allowance to LST
		const hbarAllowanceResult = await setHbarAllowance(
			client,
			aliceId,
			AccountId.fromString(lstContractId.toString()),
			1,
			HbarUnit.Tinybar,
		);

		expect(hbarAllowanceResult).to.be.equal('SUCCESS');

		expect(allowanceResult).to.be.equal('SUCCESS');

		// executeTrade
		// sending 0 hbar
		const tradeExecutionResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			650_000,
			'executeTrade',
			[aliceTrade],
			0,
		);

		if (tradeExecutionResult[0].status.toString() != 'SUCCESS') {
			console.log('Trade Execution Error (Operator creates a listing for Alice for $LAZY):', tradeExecutionResult);
			fail();
		}

		console.log('Alice Trade Execution tx:', tradeExecutionResult[2]?.transactionId?.toString());
	});

	it('Operator creates a listing with zero address as user for 11 $LAZY (2 hbar), Bob Accepts', async () => {
		client.setOperator(operatorId, operatorKey);

		// Allowance should be in place for the StkA NFT

		// user owns an LSH Gen1 or Gen2 NFT so no $LAZY cost to list

		// create a trade for null user
		const tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				ethers.ZeroAddress,
				2,
				Number(new Hbar(2, HbarUnit.Hbar).toTinybars()),
				11,
				0,
			],
		);

		if (tradeResult[0].status.toString() != 'SUCCESS') {
			console.log('Trade Creation Error (buyer = zero):', tradeResult);
			fail();
		}

		console.log('Trade created:', tradeResult[2]?.transactionId?.toString());

		// let mirror node catch up
		await sleep(5500);

		// expect to see this in the getTokenTrades method
		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getTokenTrades',
			[StkNFTA_TokenId.toSolidityAddress()],
		);

		let tokenTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		let tokenTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getTokenTrades',
			tokenTrades,
		);

		if (tokenTradesResult[0].length != 1) {
			console.log('ERROR: Trade not found in getTokenTrades:', tokenTradesResult);
			fail();
		}

		const listingTrade = tokenTradesResult[0][0];

		client.setOperator(bobId, bobPK);

		// query trades available to Bob (expect 0) via mirror node
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getUserTrades',
			[bobId.toSolidityAddress()],
		);

		const userTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const userTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getUserTrades',
			userTrades,
		);

		expect(userTradesResult[0].length).to.be.equal(0);

		// check isTradeValid for Bob expect true

		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[listingTrade, bobId.toSolidityAddress()],
		);

		const tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.true;

		// set a 1 tinybar allowance to LST
		const allowanceResult = await setHbarAllowance(
			client,
			bobId,
			AccountId.fromString(lstContractId.toString()),
			1,
			HbarUnit.Tinybar,
		);

		// set a 11 $LAZY allowance to LGS
		const lazyAllowanceResult = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			AccountId.fromString(lazyGasStationId.toString()),
			11,
		);

		expect(lazyAllowanceResult).to.be.equal('SUCCESS');

		expect(allowanceResult).to.be.equal('SUCCESS');

		// executeTrade
		// sending 2 hbar as tinybars

		const tradeExecutionResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			650_000,
			'executeTrade',
			[listingTrade],
			new Hbar(2, HbarUnit.Hbar),
		);

		if (tradeExecutionResult[0].status.toString() != 'SUCCESS') {
			console.log('Trade Execution Error:', tradeExecutionResult);
			fail();
		}

		console.log('Bob Executes Listing Trade tx:', tradeExecutionResult[2]?.transactionId?.toString());

		// let mirror node catch up
		await sleep(5000);

		// check getTokenTrades for StkNFTC expect 0
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getTokenTrades',
			[StkNFTA_TokenId.toSolidityAddress()],
		);

		tokenTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		tokenTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getTokenTrades',
			tokenTrades,
		);

		expect(tokenTradesResult[0].length).to.be.equal(0);
	});

	it('Bob creates a listing with zero address as user, pays $LAZY to list, Alice Accepts', async () => {
		// Bob creates a listing for Zero address, has to pay $LAZY to list [initially does not set allowance, thus expect failure]
		client.setOperator(bobId, bobPK);

		// set allowance for StkNFTC from Bob to LST
		const nftAllowanceResult = await setNFTAllowanceAll(
			client,
			[StkNFTA_TokenId],
			bobId,
			AccountId.fromString(lstContractId.toString()),
		);

		expect(nftAllowanceResult).to.be.equal('SUCCESS');

		// create a trade for null user
		let tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				ethers.ZeroAddress,
				2,
				Number(new Hbar(1.5, HbarUnit.Hbar).toTinybars()),
				0,
				0,
			],
		);

		if (tradeResult[0]?.status?.toString() == 'SUCCESS') {
			console.log('ERROR: Trade Creation should have failed');
			console.log('Trade [Bob creates a listing with zero address] Create Result:', tradeResult);
			fail();
		}

		// set a $LAZY allowance for LAZY_COST_FOR_TRADE to LGS
		const lazyAllowanceResult = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			AccountId.fromString(lazyGasStationId.toString()),
			LAZY_COST_FOR_TRADE,
		);

		if (lazyAllowanceResult != 'SUCCESS') {
			console.log('ERROR: $LAZY allowance failed', lazyAllowanceResult);
			fail();
		}

		// create a trade for null user - now expect success
		tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				ethers.ZeroAddress,
				2,
				Number(new Hbar(1.5, HbarUnit.Hbar).toTinybars()),
				0,
				0,
			],
		);

		if (tradeResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('ERROR: Trade Creation failed');
			console.log('Trade Create Result:', tradeResult);
			fail();
		}

		console.log('Bob Trade Creation tx:', tradeResult[2]?.transactionId?.toString());
		console.log('Bob Trade Hash:', tradeResult[1]);

		// let mirror node catch up
		await sleep(5000);

		client.setOperator(aliceId, alicePK);

		// query trades available to Alice (expect 0) via mirror node

		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getUserTrades',
			[aliceId.toSolidityAddress()],
		);

		const userTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const userTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getUserTrades',
			userTrades,
		);

		expect(userTradesResult[0].length).to.be.equal(0);

		// query trades available for getTokenTrades for StkNFTA
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'getTokenTrades',
			[StkNFTA_TokenId.toSolidityAddress()],
		);

		const tokenTrades = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tokenTradesResult = lazySecureTradeIface.decodeFunctionResult(
			'getTokenTrades',
			tokenTrades,
		);

		console.log('Token Trades:', tokenTradesResult[0], 'compare to:', tradeResult[1]);

		expect(tokenTradesResult[0].length).to.be.equal(1);

		// Alice sets a tinybar allowance to LST
		const allowanceResult = await setHbarAllowance(
			client,
			aliceId,
			AccountId.fromString(lstContractId.toString()),
			1,
			HbarUnit.Tinybar,
		);

		expect(allowanceResult).to.be.equal('SUCCESS');

		// executeTrade for Alice
		const tradeExecutionResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			650_000,
			'executeTrade',
			[tradeResult[1][0]],
			new Hbar(1.5, HbarUnit.Hbar),
		);

		if (tradeExecutionResult[0].status.toString() != 'SUCCESS') {
			console.log('Trade Execution Error:', tradeExecutionResult);
			fail();
		}

		console.log('Alice Trade Execution tx:', tradeExecutionResult[2]?.transactionId?.toString());
	});

	it('Operator delegates LSH Gen 2 to Bob, Bob creates a listing for Zero Address with no payment needed, Alice Accepts', async () => {
		// let the mirror nodes catch up
		await sleep(5000);

		client.setOperator(bobId, bobPK);

		// check the $LAZY allowance for Bob to LGS is < LAZY_COST_FOR_TRADE
		const lazyAllowance = await checkFTAllowances(env, bobId);

		for (let a = 0; a < lazyAllowance.length; a++) {
			const allowance = lazyAllowance[a];
			if (
				allowance.token_id == lazyTokenId.toString() &&
				allowance.amount >= LAZY_COST_FOR_TRADE
			) {
				// revoke the allowance
				const res = await clearFTAllowances(client, [
					{
						tokenId: lazyTokenId,
						owner: bobId,
						spender: AccountId.fromString(lazyGasStationId.toString()),
					},
				]);

				expect(res).to.be.equal('SUCCESS');
				console.log('Revoked $LAZY allowance for Bob');
				break;
			}
		}

		client.setOperator(operatorId, operatorKey);

		// delegate StkNFTC, serial 4 to Bob
		const result = await contractExecuteFunction(
			ldrAddress,
			lazyDelegateRegistryIface,
			client,
			650_000,
			'delegateNFT',
			[bobId.toSolidityAddress(), StkNFTC_TokenId.toSolidityAddress(), [4]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('ERROR: Delegation failed');
			console.log('Delegation Result:', result);
			fail();
		}

		console.log('Bob delegated LSH Gen2 tx:', result[2]?.transactionId?.toString());

		client.setOperator(bobId, bobPK);

		// Bob creates a trade for null user (no $LAZY payment as an LSH Gen2 NFT (delegate) owner)
		const tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				ethers.ZeroAddress,
				1,
				Number(new Hbar(1, HbarUnit.Hbar).toTinybars()),
				0,
				Math.floor(new Date().getTime() / 1000) + 5,
			],
		);

		if (tradeResult[0]?.status?.toString() != 'SUCCESS') {
			console.log('ERROR: Trade Creation failed');
			console.log('Trade Create Result:', tradeResult);
			fail();
		}

		console.log('trade hash:', tradeResult[1][0]);
		const tradeHashToCheck = ethers.solidityPackedKeccak256(
			['address', 'uint256'],
			[StkNFTA_TokenId.toSolidityAddress(), 1],
		);
		console.log('trade hash to check:', tradeHashToCheck);

		console.log('Bob (delegate) Trade Creation tx:', tradeResult[2]?.transactionId?.toString());

		// let mirror node catch up
		await sleep(5000);

		// expect this trade to be valid - check via mirror node
		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[tradeHashToCheck, operatorId.toSolidityAddress()],
		);

		let tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		let tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.true;

		// now sleep for 6 seconds to allow the trade to expire

		await sleep(6000);

		// expect this trade to be invalid - check via mirror node

		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[tradeHashToCheck, operatorId.toSolidityAddress()],
		);

		tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.false;
	});

	it('Operator create a trade, then cancels it', async () => {
		client.setOperator(operatorId, operatorKey);

		// rely on NFT allowance being in place StkNFTA_TokenId

		// create a trade for Bob
		const tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				bobId.toSolidityAddress(),
				4,
				Number(new Hbar(3, HbarUnit.Hbar).toTinybars()),
				0,
				0,
			],
		);

		expect(tradeResult[0].status.toString()).to.be.equal('SUCCESS');

		console.log('Trade created:', tradeResult[2]?.transactionId?.toString());

		const hashToCheck = tradeResult[1][0];

		// let mirror node catch up
		await sleep(5000);

		// check trade is valid for Bob via mirror node, expect true
		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[hashToCheck, bobId.toSolidityAddress()],
		);

		let tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		let tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.true;

		// cancel the trade
		const cancelResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			300_000,
			'cancelTrade',
			[hashToCheck],
		);

		expect(cancelResult[0].status.toString()).to.be.equal('SUCCESS');

		console.log('Trade cancelled:', cancelResult[2]?.transactionId?.toString());

		// let mirror node catch up
		await sleep(5000);

		// check trade is valid for Bob via mirror node, expect false
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[hashToCheck, bobId.toSolidityAddress()],
		);

		tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.false;
	});

	it('Operator creates a trade then modifies it', async () => {
		client.setOperator(operatorId, operatorKey);

		// rely on NFT allowance being in place StkNFTA_TokenId

		// create a trade for Bob
		const tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				bobId.toSolidityAddress(),
				4,
				Number(new Hbar(3, HbarUnit.Hbar).toTinybars()),
				0,
				0,
			],
		);

		expect(tradeResult[0].status.toString()).to.be.equal('SUCCESS');

		console.log('Trade created:', tradeResult[2]?.transactionId?.toString());

		const hashToCheck = tradeResult[1][0];

		// let mirror node catch up
		await sleep(5000);

		// check trade is valid for Bob via mirror node, expect true

		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[hashToCheck, bobId.toSolidityAddress()],
		);

		let tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		let tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.true;

		// modify the trade using createTrade for same token and serial
		const modifyResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				aliceId.toSolidityAddress(),
				4,
				Number(new Hbar(5, HbarUnit.Hbar).toTinybars()),
				10,
				0,
			],
		);

		expect(modifyResult[0].status.toString()).to.be.equal('SUCCESS');

		console.log('Trade modified:', modifyResult[2]?.transactionId?.toString());

		// let mirror node catch up
		await sleep(5000);

		// check trade is now invalid for Bob via mirror node, expect false

		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[hashToCheck, bobId.toSolidityAddress()],
		);

		tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.false;

		// check trade is valid for Alice via mirror node, expect true

		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[modifyResult[1][0], aliceId.toSolidityAddress()],
		);

		tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.true;
	});

	it('Operator creates a trade for Alice, sends NFT to Bob, Alice can not execute', async () => {
		client.setOperator(operatorId, operatorKey);

		// rely on NFT allowance being in place StkNFTA_TokenId

		// create a trade for Alice
		const tradeResult = await contractExecuteFunction(
			lstContractId,
			lazySecureTradeIface,
			client,
			500_000,
			'createTrade',
			[
				StkNFTA_TokenId.toSolidityAddress(),
				aliceId.toSolidityAddress(),
				3,
				Number(new Hbar(0.25, HbarUnit.Hbar).toTinybars()),
				0,
				0,
			],
		);

		expect(tradeResult[0].status.toString()).to.be.equal('SUCCESS');

		console.log('Trade created:', tradeResult[2]?.transactionId?.toString());

		const hashToCheck = tradeResult[1][0];

		// let mirror node catch up
		await sleep(5000);

		// check trade is valid for Alice via mirror node, expect true
		let encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[hashToCheck, aliceId.toSolidityAddress()],
		);

		let tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		let tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.true;

		// transfer the NFT to Bob

		const NFTTransferResult = await sendNFTDefeatRoyalty(
			client,
			operatorId,
			bobId,
			bobPK,
			StkNFTA_TokenId,
			[3],
		);

		expect(NFTTransferResult).to.be.equal('SUCCESS');

		// let mirror node catch up
		await sleep(5000);

		// check trade is valid for Alice via mirror node, expect false
		encodedCommand = lazySecureTradeIface.encodeFunctionData(
			'isTradeValid',
			[hashToCheck, aliceId.toSolidityAddress()],
		);

		tradeValid = await readOnlyEVMFromMirrorNode(
			env,
			lstContractId,
			encodedCommand,
			operatorId,
			false,
		);

		tradeValidResult = lazySecureTradeIface.decodeFunctionResult(
			'isTradeValid',
			tradeValid,
		);

		expect(tradeValidResult[0]).to.be.false;
	});
});

describe('Clean-up', () => {
	it('removes allowances from Operator', async () => {
		client.setOperator(operatorId, operatorKey);
		let result;
		if (operatorNftAllowances.length != 0) {
			result = await clearNFTAllowances(client, operatorNftAllowances);
			expect(result).to.be.equal('SUCCESS');
		}

		// clean up the LGS authorizations
		// getContractUsers()
		const lgsContractUsers = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getContractUsers',
		);

		for (let i = 0; i < lgsContractUsers[0].length; i++) {
			result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeContractUser',
				[lgsContractUsers[0][i]],
			);

			if (result[0]?.status.toString() !== 'SUCCESS') {console.log('Failed to remove LGS contract user:', result);}
			expect(result[0].status.toString()).to.be.equal('SUCCESS');
		}

		// getAuthorizers()
		const lgsAuthorizers = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getAuthorizers',
		);

		for (let i = 0; i < lgsAuthorizers[0].length; i++) {
			result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeAuthorizer',
				[lgsAuthorizers[0][i]],
			);

			if (result[0]?.status.toString() !== 'SUCCESS') {console.log('Failed to remove LGS authorizer:', result);}
			expect(result[0].status.toString()).to.be.equal('SUCCESS');
		}

		// getAdmins()
		const lgsAdmins = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getAdmins',
		);

		for (let i = 0; i < lgsAdmins[0].length; i++) {
			if (
				lgsAdmins[0][i].slice(2).toLowerCase() == operatorId.toSolidityAddress()
			) {
				console.log('Skipping removal of Operator as LGS admin');
				continue;
			}

			result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeAdmin',
				[lgsAdmins[0][i]],
			);

			if (result[0]?.status.toString() !== 'SUCCESS') {console.log('Failed to remove LGS admin:', result);}
			expect(result[0].status.toString()).to.be.equal('SUCCESS');
		}

		// ensure mirrors have caught up
		await sleep(4500);

		const outstandingAllowances = [];
		// get the FT allowances for operator
		const mirrorFTAllowances = await checkFTAllowances(env, operatorId);
		for (let a = 0; a < mirrorFTAllowances.length; a++) {
			const allowance = mirrorFTAllowances[a];
			// console.log('FT Allowance found:', allowance.token_id, allowance.owner, allowance.spender);
			if (allowance.token_id == lazyTokenId.toString() && allowance.amount > 0) {outstandingAllowances.push(allowance.spender);}
		}

		// if the contract was created reset any $LAZY allowance for the operator
		if (
			lstContractId &&
			outstandingAllowances.includes(lstContractId.toString())
		) {
			operatorFtAllowances.push({
				tokenId: lazyTokenId,
				owner: operatorId,
				spender: AccountId.fromString(lstContractId.toString()),
			});
		}
		if (
			lazyGasStationId &&
			outstandingAllowances.includes(lazyGasStationId.toString())
		) {
			operatorFtAllowances.push({
				tokenId: lazyTokenId,
				owner: operatorId,
				spender: AccountId.fromString(lazyGasStationId.toString()),
			});
		}

		result = await clearFTAllowances(client, operatorFtAllowances);
		expect(result).to.be.equal('SUCCESS');
	});

	it('sweep hbar from the test accounts', async () => {
		await sleep(5000);
		client.setOperator(operatorId, operatorKey);
		let balance = await checkMirrorHbarBalance(env, aliceId, alicePK);
		balance -= 1_000_000;
		console.log('sweeping alice', balance / 10 ** 8);
		let result = await sweepHbar(client, aliceId, alicePK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
		console.log('alice:', result);
		balance = await checkMirrorHbarBalance(env, bobId, bobPK);
		balance -= 1_000_000;
		console.log('sweeping bob', balance / 10 ** 8);
		result = await sweepHbar(client, bobId, bobPK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
		console.log('bob:', result);
	});
});

/**
 * Helper function to encpapsualte minting an FT
 * @param {string} tokenName
 * @param {string} tokenSymbol
 * @param {string} tokenMemo
 * @param {number} tokenInitalSupply
 * @param {number} tokenDecimal
 * @param {number} tokenMaxSupply
 * @param {number} payment
 */
async function mintLazy(
	tokenName,
	tokenSymbol,
	tokenMemo,
	tokenInitalSupply,
	decimal,
	tokenMaxSupply,
	payment,
) {
	const gasLim = 800000;
	// call associate method
	const params = [
		tokenName,
		tokenSymbol,
		tokenMemo,
		tokenInitalSupply,
		decimal,
		tokenMaxSupply,
	];

	const [, , createTokenRecord] = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		gasLim,
		'createFungibleWithBurn',
		params,
		payment,
	);
	const tokenIdSolidityAddr =
		createTokenRecord.contractFunctionResult.getAddress(0);
	lazyTokenId = TokenId.fromSolidityAddress(tokenIdSolidityAddr);
}

/**
 * Use the LSCT to send $LAZY out
 * @param {AccountId} receiverId
 * @param {*} amt
 */
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
		console.log('Failed to send $LAZY:', result);
		fail();
	}
	return result[0]?.status.toString();
}
