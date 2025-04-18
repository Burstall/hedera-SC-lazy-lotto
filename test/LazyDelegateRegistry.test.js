const fs = require('fs');
const { ethers, ZeroAddress } = require('ethers');
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
	Hbar,
	HbarUnit,
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
	sweepHbar,
} = require('../utils/hederaHelpers');
const { fail } = require('assert');
const {
	checkLastMirrorEvent,
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

const ldrTesterName = 'LDRTester';
const contractName = 'LazyDelegateRegistry';
const env = process.env.ENVIRONMENT ?? null;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variables
let ldaContractAddress, ldrContractId;
let ldrIface, ldrtesterIface;
let alicePK, aliceId;
let bobPK, bobId;
let client;
let DelNFTA_TokenId,
	DelNFTB_TokenId,
	DelNFTC_TokenId,
	DelNFTD_TokenId,
	DelNFTE_TokenId;
let ldrTesterId;


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
			const rootKey = PrivateKey.fromString(
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
		}
		else {
			alicePK = PrivateKey.generateED25519();
			aliceId = await accountCreator(client, alicePK, 375);
			console.log(
				'Alice account ID:',
				aliceId.toString(),
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
		}
		else {
			bobPK = PrivateKey.generateED25519();
			bobId = await accountCreator(client, bobPK, 50);
			console.log(
				'Bob account ID:',
				bobId.toString(),
				'\nkey:',
				bobPK.toString(),
			);
		}
		expect(bobId.toString().match(addressRegex).length == 2).to.be.true;

		const gasLimit = 500_000;

		// now deploy main contract
		const lazyDelegateRegistryJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
			),
		);

		// import ABI
		ldrIface = ethers.Interface.from(lazyDelegateRegistryJson.abi);

		const contractBytecode = lazyDelegateRegistryJson.bytecode;

		console.log(
			'\n- Deploying contract...',
			contractName,
			'\n\tgas@',
			gasLimit,
		);

		const constructorParams = new ContractFunctionParameters();

		[ldrContractId, ldaContractAddress] = await contractDeployFunction(
			client,
			contractBytecode,
			gasLimit,
			constructorParams,
		);

		expect(ldrContractId.toString().match(addressRegex).length == 2).to.be.true;

		console.log(
			`Lazy Delegate Registry Contract created with ID: ${ldrContractId} / ${ldaContractAddress}`,
		);

		// now deploy the tester contract
		const ldrTesterJSON = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${ldrTesterName}.sol/${ldrTesterName}.json`,
			),
		);

		ldrtesterIface = new ethers.Interface(ldrTesterJSON.abi);
		if (process.env.LDA_TESTER_CONTRACT_ID) {
			console.log(
				'\n-Using existing LDA Tester:',
				process.env.LDA_TESTER_CONTRACT_ID,
			);
			ldrTesterId = ContractId.fromString(
				process.env.LDA_TESTER_CONTRACT_ID,
			);

			console.log('Updating LDA Tester with new LDR contract address');
			client.setOperator(operatorId, operatorKey);
			const result = await contractExecuteFunction(
				ldrTesterId,
				ldrtesterIface,
				client,
				null,
				'updateLDRContractAddress',
				[ldrContractId.toSolidityAddress()],
			);

			if (result[0]?.status.toString() != 'SUCCESS') {
				console.log('ERROR: updateLDRContractAddress failed', result);
				fail();
			}
		}
		else {
			console.log(
				'\n- Deploying contract...',
				ldrTesterName,
				'\n\tgas@',
				gasLimit,
			);

			const ldrTesterBytecode = ldrTesterJSON.bytecode;

			const ldrTesterParams = new ContractFunctionParameters()
				.addAddress(ldaContractAddress);

			[ldrTesterId] = await contractDeployFunction(
				client,
				ldrTesterBytecode,
				gasLimit,
				ldrTesterParams,
			);

			console.log(
				`Lazy Delegate Registry Test contract created with ID: ${ldrTesterId} / ${ldrTesterId.toSolidityAddress()}`,
			);

			expect(ldrTesterId.toString().match(addressRegex).length == 2).to.be
				.true;
		}

		console.log('\n-Testing:', contractName);

		// mint NFTs from the 3rd party Alice Account
		// ensure royalties in place
		/*
			5 x Different NFTs of size 20 each
		*/

		const nftSize = 60;

		client.setOperator(aliceId, alicePK);
		let [result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Del NFT A',
			'DelNFTA',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		DelNFTA_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Del NFT B',
			'DelNFTB',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		DelNFTB_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Del NFT C',
			'DelNFTC',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		DelNFTC_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Del NFT D',
			'DelNFTD',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		DelNFTD_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Del NFT E',
			'DelNFTE',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		DelNFTE_TokenId = tokenId;

		// configure the LazyNFTStaking instance
		client.setOperator(operatorId, operatorKey);

		// associate the NFTs to operator
		client.setOperator(operatorId, operatorKey);
		const operatorTokensToAssociate = [];

		operatorTokensToAssociate.push(
			DelNFTA_TokenId,
			DelNFTB_TokenId,
			DelNFTC_TokenId,
			DelNFTD_TokenId,
			DelNFTE_TokenId,
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

		const bobTokensToAssociate = [];

		bobTokensToAssociate.push(
			DelNFTA_TokenId,
			DelNFTB_TokenId,
			DelNFTC_TokenId,
			DelNFTD_TokenId,
			DelNFTE_TokenId,
		);

		// associate the tokens for Bob
		result = await associateTokensToAccount(
			client,
			bobId,
			bobPK,
			bobTokensToAssociate,
		);
		expect(result).to.be.equal('SUCCESS');

		// send NFTs 1-5 to Operator and 6-10 to Bob
		client.setOperator(aliceId, alicePK);
		const serials = [...Array(nftSize).keys()].map((x) => ++x);
		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			DelNFTA_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			DelNFTB_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			DelNFTC_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			DelNFTD_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			DelNFTE_TokenId,
			serials.slice(0, 5),
		);

		result = await sendNFT(
			client,
			aliceId,
			bobId,
			DelNFTA_TokenId,
			serials.slice(5, 10),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			bobId,
			DelNFTB_TokenId,
			serials.slice(5, 10),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			bobId,
			DelNFTC_TokenId,
			serials.slice(5, 10),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			bobId,
			DelNFTD_TokenId,
			serials.slice(5, 10),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			bobId,
			DelNFTE_TokenId,
			serials.slice(5, 10),
		);
		expect(result).to.be.equal('SUCCESS');
	});
});

describe('Testing direct to LDA', () => {
	it('set a delegate wallet and test getters', async () => {
		// set the delegate wallet
		client.setOperator(operatorId, operatorKey);
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'delegateWalletTo',
			[aliceId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateWalletTo failed', result);
			fail();
		}

		// speed bump for event to appear on mirror
		await sleep(5000);

		// check the WalletDelegated event
		const delegatorMirror = await checkLastMirrorEvent(
			env,
			ldrContractId,
			ldrIface,
			1,
			true,
		);

		expect(delegatorMirror.toString()).to.be.equal(aliceId.toString());

		// call getDelegateWallet
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getDelegateWallet',
			[operatorId.toSolidityAddress()],
		);

		// expect the result to be alice
		expect(result[0].slice(2).toLowerCase()).to.be.equal(aliceId.toSolidityAddress().toLowerCase());

		client.setOperator(bobId, bobPK);

		// call checkDelegateWallet
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkDelegateWallet',
			[operatorId.toSolidityAddress(), aliceId.toSolidityAddress()],
		);

		// expect the result to be true
		expect(result[0]).to.be.true;

		// perform the check via mirror node
		const encodedCommand = ldrIface.encodeFunctionData('checkDelegateWallet', [
			operatorId.toSolidityAddress(),
			aliceId.toSolidityAddress(),
		]);

		const validateDelegateWalletOnmirror = await readOnlyEVMFromMirrorNode(
			env,
			ldrContractId,
			encodedCommand,
			bobId,
			false,
		);

		result = ldrIface.decodeFunctionResult('checkDelegateWallet', validateDelegateWalletOnmirror);

		expect(result[0]).to.be.true;

	});

	it('circular delegation back to the original wallet', async () => {
		client.setOperator(aliceId, alicePK);

		// delegate Alice back to operator
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'delegateWalletTo',
			[operatorId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateWalletTo failed', result);
			fail();
		}

		// speed bump for event to appear on mirror
		await sleep(5000);

		// check the WalletDelegated event
		const delegatorMirror = await checkLastMirrorEvent(
			env,
			ldrContractId,
			ldrIface,
			1,
			true,
		);

		expect(delegatorMirror.toString()).to.be.equal(operatorId.toString());

		// call getDelegateWallet
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getDelegateWallet',
			[aliceId.toSolidityAddress()],
		);

		// expect the result to be operator
		expect(result[0].slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		client.setOperator(bobId, bobPK);

		// call checkDelegateWallet
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkDelegateWallet',
			[aliceId.toSolidityAddress(), operatorId.toSolidityAddress()],
		);

		// expect the result to be true
		expect(result[0]).to.be.true;
	});

	it('checks who wallets are delegated to', async () => {
		client.setOperator(operatorId, operatorKey);

		// test getWalletsDelegatedTo
		const result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getWalletsDelegatedTo',
			[aliceId.toSolidityAddress()],
		);

		// expect the result to be operator
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

	});

	it('operator moves delegation to bob', async () => {
		client.setOperator(operatorId, operatorKey);

		// delegate bob to operator
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'delegateWalletTo',
			[bobId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateWalletTo failed', result);
			fail();
		}

		// call getDelegateWallet
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getDelegateWallet',
			[operatorId.toSolidityAddress()],
		);

		// expect the result to be operator
		expect(result[0].slice(2).toLowerCase()).to.be.equal(bobId.toSolidityAddress().toLowerCase());
	});

	it('bob queries wallets with delegation', async () => {
		client.setOperator(bobId, bobPK);

		// getTotalWalletsWithDelegates
		let result = await readOnlyEVMFromMirrorNode(
			env,
			ldrContractId,
			ldrIface.encodeFunctionData('getTotalWalletsWithDelegates', []),
			bobId,
			false,
		);

		result = ldrIface.decodeFunctionResult('getTotalWalletsWithDelegates', result);

		expect(result[0]).to.be.equal(2);

		// getWalletsWithDelegates
		result = await readOnlyEVMFromMirrorNode(
			env,
			ldrContractId,
			ldrIface.encodeFunctionData('getWalletsWithDelegates', []),
			bobId,
			false,
		);

		result = ldrIface.decodeFunctionResult('getWalletsWithDelegates', result);

		expect(result[0].length).to.be.equal(2);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());
		expect(result[0][1].slice(2).toLowerCase()).to.be.equal(aliceId.toSolidityAddress().toLowerCase());
	});

	it('cancel delegation', async () => {
		client.setOperator(aliceId, alicePK);

		// revokeDelegateWallet
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'revokeDelegateWallet',
			[],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: revokeDelegateWallet failed', result);
			fail();
		}

		// call getDelegateWallet
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getDelegateWallet',
			[aliceId.toSolidityAddress()],
		);

		// expect to get zero address
		expect(result[0].toString()).to.be.equal(ZeroAddress.toString());

		// call checkDelegateWallet
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkDelegateWallet',
			[aliceId.toSolidityAddress(), operatorId.toSolidityAddress()],
		);

		// expect the result to be false
		expect(result[0]).to.be.false;

		// getTotalWalletsWithDelegates
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getTotalWalletsWithDelegates',
			[],
		);

		expect(result[0]).to.be.equal(1);
	});

	it('try to delegate token you do not own - expect failure', async () => {
		client.setOperator(operatorId, operatorKey);
		// delegateNFT to operator for token A serial 11
		const result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			400_000,
			'delegateNFT',
			[operatorId.toSolidityAddress(), DelNFTA_TokenId.toSolidityAddress(), [11]],
		);

		if (result[0]?.status?.name != 'LazyDelegateRegistryOnlyOwner') {
			console.log('ERROR: delegateNFT should have failed', result);
			fail();
		}
	});

	it('check result of calls where no token delegation in place', async () => {
		client.setOperator(operatorId, operatorKey);

		// test getNFTDelegatedTo

		let result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			400_000,
			'getNFTDelegatedTo',
			[DelNFTA_TokenId.toSolidityAddress(), 11],
		);

		expect(result[0].toString()).to.be.equal(ZeroAddress.toString());

		// test checkDelegateToken
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[operatorId.toSolidityAddress(), DelNFTA_TokenId.toSolidityAddress(), 11],
		);

		expect(result[0]).to.be.false;

	});

	it('delegate a token you own and check the getters', async () => {
		client.setOperator(aliceId, alicePK);

		// test delegateNFT

		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			640_000,
			'delegateNFT',
			[operatorId.toSolidityAddress(), DelNFTA_TokenId.toSolidityAddress(), [11]],
		);

		console.log('singular - Tx id:', result[2]?.transactionId?.toString());

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateNFT failed', result);
			fail();
		}

		// call getNFTDelegatedTo
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getNFTDelegatedTo',
			[DelNFTA_TokenId.toSolidityAddress(), 11],
		);

		// expect the result to be operator
		expect(result[0].slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// call checkDelegateToken
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[operatorId.toSolidityAddress(), DelNFTA_TokenId.toSolidityAddress(), 11],
		);

		// expect the result to be true
		expect(result[0]).to.be.true;

		// now check the mirror node to see the event emitted
		await sleep(5000);

		const delegatorMirror = await checkLastMirrorEvent(
			env,
			ldrContractId,
			ldrIface,
			1,
			false,
		);

		expect(Number(delegatorMirror)).to.be.equal(11);
	});

	it('test 45 token delegations in batch', async () => {
		client.setOperator(aliceId, alicePK);

		// use delegateNFTs for serials 20-40 for token A, B and 15-20 for token C
		const serials = [...Array(60).keys()].map((x) => ++x);

		const result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			9_000_000,
			'delegateNFTs',
			[
				bobId.toSolidityAddress(),
				[
					DelNFTA_TokenId.toSolidityAddress(),
					DelNFTB_TokenId.toSolidityAddress(),
					DelNFTC_TokenId.toSolidityAddress(),
				],
				[serials.slice(20, 40), serials.slice(20, 40), serials.slice(15, 20)],
			],
		);

		// 8,834,861 gas used for the 45. Something like 180k per token delegation + 600k base
		console.log('45 batch - Tx id:', result[2]?.transactionId?.toString());

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateNFTs failed', result);
			fail();
		}
	});

	it('test getting list of delegates for tokens', async () => {
		client.setOperator(aliceId, alicePK);

		// delegate token C serial 15 to operator
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			400_000,
			'delegateNFT',
			[operatorId.toSolidityAddress(), DelNFTC_TokenId.toSolidityAddress(), [15]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateNFT failed', result);
			fail();
		}


		// test getNFTListDelegatedTo

		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getNFTListDelegatedTo',
			[
				[
					DelNFTA_TokenId.toSolidityAddress(),
					DelNFTB_TokenId.toSolidityAddress(),
					DelNFTC_TokenId.toSolidityAddress(),
				],
				[[20, 21], [23], [15, 16, 17, 18, 19]],
			],
		);

		expect(result[0].length).to.be.equal(3);
		expect(result[0][0].length).to.be.equal(2);
		expect(result[0][1].length).to.be.equal(1);
		expect(result[0][2].length).to.be.equal(5);
		expect(result[0][0][0].toLowerCase()).to.be.equal(ZeroAddress.toLowerCase());
		expect(result[0][0][1].slice(2).toLowerCase()).to.be.equal(bobId.toSolidityAddress().toLowerCase());
		expect(result[0][1][0].slice(2).toLowerCase()).to.be.equal(bobId.toSolidityAddress().toLowerCase());
		expect(result[0][2][0].slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());
		expect(result[0][2][1].slice(2).toLowerCase()).to.be.equal(bobId.toSolidityAddress().toLowerCase());
		expect(result[0][2][2].slice(2).toLowerCase()).to.be.equal(bobId.toSolidityAddress().toLowerCase());
		expect(result[0][2][3].slice(2).toLowerCase()).to.be.equal(bobId.toSolidityAddress().toLowerCase());
	});

	it('test getDelegatedNFTsBy', async () => {
		client.setOperator(aliceId, alicePK);

		// test getDelegatedNFTsBy
		let result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getDelegatedNFTsBy',
			[aliceId.toSolidityAddress(), false],
		);

		// as false passed expect to only get tokens and not serials
		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(3);
		expect(result[1].length).to.be.equal(0);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(DelNFTA_TokenId.toSolidityAddress().toLowerCase());
		expect(result[0][1].slice(2).toLowerCase()).to.be.equal(DelNFTB_TokenId.toSolidityAddress().toLowerCase());
		expect(result[0][2].slice(2).toLowerCase()).to.be.equal(DelNFTC_TokenId.toSolidityAddress().toLowerCase());

		// now get the serials
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getDelegatedNFTsBy',
			[aliceId.toSolidityAddress(), true],
		);

		// get back tokens and serials
		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(3);
		expect(result[1].length).to.be.equal(3);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(DelNFTA_TokenId.toSolidityAddress().toLowerCase());
		expect(result[0][1].slice(2).toLowerCase()).to.be.equal(DelNFTB_TokenId.toSolidityAddress().toLowerCase());
		expect(result[0][2].slice(2).toLowerCase()).to.be.equal(DelNFTC_TokenId.toSolidityAddress().toLowerCase());
		expect(result[1][0].length).to.be.equal(21);
		expect(result[1][1].length).to.be.equal(20);
		expect(result[1][2].length).to.be.equal(6);

		// now check for Bob who has not delegated any tokens
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getDelegatedNFTsBy',
			[bobId.toSolidityAddress(), true],
		);

		console.log('bobby', result);
	});

	it('test getNFTsDelegatedTo', async () => {
		client.setOperator(operatorId, operatorKey);

		// test getNFTsDelegatedTo
		const result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			400_000,
			'getNFTsDelegatedTo',
			[bobId.toSolidityAddress()],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(3);
		expect(result[1].length).to.be.equal(3);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(DelNFTA_TokenId.toSolidityAddress().toLowerCase());
		expect(result[0][1].slice(2).toLowerCase()).to.be.equal(DelNFTB_TokenId.toSolidityAddress().toLowerCase());
		expect(result[0][2].slice(2).toLowerCase()).to.be.equal(DelNFTC_TokenId.toSolidityAddress().toLowerCase());
		expect(result[1][0].length).to.be.equal(20);
		expect(result[1][1].length).to.be.equal(20);
		expect(result[1][2].length).to.be.equal(5);
	});

	it('test getSerialsDelegatedTo', async () => {
		client.setOperator(aliceId, alicePK);

		// test getSerialsDelegatedTo
		let result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getSerialsDelegatedTo',
			[bobId.toSolidityAddress(), DelNFTA_TokenId.toSolidityAddress()],
		);

		expect(result.length).to.be.equal(1);
		expect(result[0].length).to.be.equal(20);
		expect(Number(result[0][0])).to.be.equal(21);
		expect(Number(result[0][19])).to.be.equal(40);

		// test getSerialsDelegatedTo
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getSerialsDelegatedTo',
			[bobId.toSolidityAddress(), DelNFTB_TokenId.toSolidityAddress()],
		);

		expect(result[0].length).to.be.equal(20);
		expect(Number(result[0][0])).to.be.equal(21);
		expect(Number(result[0][19])).to.be.equal(40);

		// test getSerialsDelegatedTo
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getSerialsDelegatedTo',
			[bobId.toSolidityAddress(), DelNFTC_TokenId.toSolidityAddress()],
		);

		expect(result[0].length).to.be.equal(5);
		expect(Number(result[0][0])).to.be.equal(16);
		expect(Number(result[0][4])).to.be.equal(20);
	});

	it('check serials delegated tracker', async () => {
		client.setOperator(operatorId, operatorKey);

		// totalSerialsDelegated

		const result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(47);
	});

	it('test enumeration of delegated wallets', async () => {
		client.setOperator(operatorId, operatorKey);

		// getWalletsWithDelegates
		let result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getWalletsWithDelegates',
			[],
		);

		// only operator
		expect(result[0].length).to.be.equal(1);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// getTotalWalletsWithDelegates

		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getTotalWalletsWithDelegates',
			[],
		);

		expect(Number(result[0])).to.be.equal(1);
	});

	it('test enumeration of delegated tokens', async () => {
		client.setOperator(operatorId, operatorKey);

		// getTokensWithDelegates
		let result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getTokensWithDelegates',
			[],
		);

		expect(result[0].length).to.be.equal(3);

		// getTotalTokensWithDelegates
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getTotalTokensWithDelegates',
			[],
		);

		expect(Number(result[0])).to.be.equal(3);

		// getSerialsDelegatedBy
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getSerialsDelegatedBy',
			[aliceId.toSolidityAddress(), DelNFTA_TokenId.toSolidityAddress()],
		);

		expect(result[0].length).to.be.equal(21);
		expect(Number(result[0][0])).to.be.equal(11);
		expect(Number(result[0][20])).to.be.equal(40);
	});

	it('test range based enumeration methods', async () => {
		client.setOperator(operatorId, operatorKey);

		// getTokensWithDelegatesRange - 1-2
		let result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getTokensWithDelegatesRange',
			[1, 2],
		);

		expect(result[0].length).to.be.equal(2);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(DelNFTB_TokenId.toSolidityAddress().toLowerCase());
		expect(result[0][1].slice(2).toLowerCase()).to.be.equal(DelNFTC_TokenId.toSolidityAddress().toLowerCase());

		// getWalletsWithDelegatesRange
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getWalletsWithDelegatesRange',
			[0, 1],
		);

		expect(result[0].length).to.be.equal(1);

		// getSerialsDelegatedByRange
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getSerialsDelegatedByRange',
			[aliceId.toSolidityAddress(), DelNFTA_TokenId.toSolidityAddress(), 1, 2],
		);

		expect(result[0].length).to.be.equal(2);
		expect(Number(result[0][0])).to.be.equal(21);
		expect(Number(result[0][1])).to.be.equal(22);
	});

	it('test revokeDelegateNFT(s)', async () => {
		client.setOperator(aliceId, alicePK);

		// revokeDelegateNFT

		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'revokeDelegateNFT',
			[DelNFTA_TokenId.toSolidityAddress(), [11]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: revokeDelegateNFT failed', result);
			fail();
		}

		// check totalSerialsDelegated = 46

		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(46);

		// revokeDelegateNFTs - revoke all 46 serials
		const serials = [...Array(60).keys()].map((x) => ++x);
		const tokenASerialsArray = serials.slice(20, 40);
		// adding a token without a delegation to check it is handled correctly
		// [we removed it above]
		tokenASerialsArray.push(11);
		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			6_750_000,
			'revokeDelegateNFTs',
			[
				[DelNFTA_TokenId.toSolidityAddress(), DelNFTB_TokenId.toSolidityAddress(), DelNFTC_TokenId.toSolidityAddress()],
				[tokenASerialsArray, serials.slice(20, 40), serials.slice(14, 20)],
			],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: 47 batch revokeDelegateNFTs failed', result);
			fail();
		}

		console.log('47 batch - Tx id:', result[2]?.transactionId?.toString());

		// check totalSerialsDelegated = 1

		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		// just the one left operator delegated to Bob
		expect(Number(result[0])).to.be.equal(0);
	});

	it('test revokeDelegateNFT when not owned', async () => {
		client.setOperator(operatorId, operatorKey);

		// revokeDelegateNFT
		const result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'revokeDelegateNFT',
			[DelNFTA_TokenId.toSolidityAddress(), [11]],
		);

		if (result[0]?.status?.name != 'LazyDelegateRegistryOnlyOwner') {
			console.log('ERROR: delegateNFT should have failed', result);
			fail();
		}
	});

	it('test revokeDelegateNFT when owned but not delegated', async () => {
		client.setOperator(aliceId, alicePK);

		// get totalSerialsDelegated
		let result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(0);

		// revokeDelegateNFT
		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'revokeDelegateNFT',
			[DelNFTA_TokenId.toSolidityAddress(), [15]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: revokeDelegateNFT failed (A)', result);
			fail();
		}

		// revoke a bad serial
		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'revokeDelegateNFT',
			[DelNFTE_TokenId.toSolidityAddress(), [20]],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('ERROR: revokeDelegateNFT failed (E)', result);
			fail();
		}

		// expect command to succeed but no change in totalSerialsDelegated

		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(0);

		// check the last mirror event is not a TokenDelegated event for serial 15
		await sleep(5000);

		const delegatorMirror = await checkLastMirrorEvent(
			env,
			ldrContractId,
			ldrIface,
			1,
			false,
		);

		expect(Number(delegatorMirror)).to.be.not.equal(15);
	});

	it('test delegateNFT to switch (when already delegated to an account)', async () => {
		client.setOperator(aliceId, alicePK);

		// check getNFTsDelegatedTo for Bob
		let result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getNFTsDelegatedTo',
			[bobId.toSolidityAddress()],
		);

		expect(result[0].length).to.be.equal(0);

		// check getNFTsDelegatedTo for Operator
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'getNFTsDelegatedTo',
			[operatorId.toSolidityAddress()],
		);

		expect(result[0].length).to.be.equal(0);

		// delegateNFT to operator for token C serial 28
		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			800_000,
			'delegateNFT',
			[operatorId.toSolidityAddress(), DelNFTC_TokenId.toSolidityAddress(), [28]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateNFT failed', result);
			fail();
		}

		// check it is delegated to operator
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getNFTDelegatedTo',
			[DelNFTC_TokenId.toSolidityAddress(), 28],
		);

		expect(result[0].slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// check the totalSerialsDelegated
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(1);

		// delegateNFT to bob for token C serial 28
		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			800_000,
			'delegateNFT',
			[bobId.toSolidityAddress(), DelNFTC_TokenId.toSolidityAddress(), [28]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateNFT failed', result);
			fail();
		}

		// check it is delegated to bob
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getNFTDelegatedTo',
			[DelNFTC_TokenId.toSolidityAddress(), 28],
		);

		// check totalSerialsDelegated has not changed
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(1);

		// revoke the delegated token to clean up
		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			750_000,
			'revokeDelegateNFTs',
			[
				[DelNFTC_TokenId.toSolidityAddress()],
				[[28]],
			],
		);

	});

	it('test getNFTsDelegatedTo when delegate moved and hanging token', async () => {
		// when delegate tokens shifted risk there is a hanging token
		// assumed to be delegated to the old delegate, check this comes out clean (no serials for a hanging token)
		client.setOperator(aliceId, alicePK);

		// token B serial 23 to Operator
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			800_000,
			'delegateNFT',
			[operatorId.toSolidityAddress(), DelNFTB_TokenId.toSolidityAddress(), [23]],
		);

		// check totalSerialsDelegated = 2
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(1);

		// check Operator has token B serial 23 delegated to him
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getNFTsDelegatedTo',
			[operatorId.toSolidityAddress()],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(1);
		expect(result[1][0].length).to.be.equal(1);

		// move token B serial 23 to Bob
		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			800_000,
			'delegateNFT',
			[bobId.toSolidityAddress(), DelNFTB_TokenId.toSolidityAddress(), [23]],
		);

		// check Operator no longer has token B serial 23 delegated to him (and no record of Token B delegated to him)
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getNFTsDelegatedTo',
			[operatorId.toSolidityAddress()],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(0);
		expect(result[1].length).to.be.equal(0);

		// check Bob has token B serial 23 delegated to him
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getNFTsDelegatedTo',
			[bobId.toSolidityAddress()],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(1);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(DelNFTB_TokenId.toSolidityAddress().toLowerCase());
		expect(result[1].length).to.be.equal(1);
		expect(result[1][0].length).to.be.equal(1);
		expect(Number(result[1][0][0])).to.be.equal(23);

		// check totalSerialsDelegated = 1 (still)
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(1);

		// revoke the delegated tokens
		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			750_000,
			'revokeDelegateNFTs',
			[
				[DelNFTB_TokenId.toSolidityAddress()],
				[[23]],
			],
		);
	});

	it('test delegation by new owner', async () => {
		// delegate a token then move the token to a new owner and re-delegate

		client.setOperator(aliceId, alicePK);

		// delegate token B serial 25 to operator
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			800_000,
			'delegateNFT',
			[operatorId.toSolidityAddress(), DelNFTB_TokenId.toSolidityAddress(), [25]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateNFT failed', result);
			fail();
		}

		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkNFTDelegationIsValid',
			[DelNFTB_TokenId.toSolidityAddress(), 25],
		);

		expect(result[0]).to.be.true;

		// check totalSerialsDelegated = 1
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(1);

		// alice send token B serial 25 to Bob
		result = await sendNFT(client, aliceId, bobId, DelNFTB_TokenId, [25]);

		// no gas paid to update so the totalSerialsDelegated should still be 1

		// check totalSerialsDelegated = 1
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(1);

		// but if we check validity it should be false using checkNFTDelegationIsValid
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkNFTDelegationIsValid',
			[DelNFTB_TokenId.toSolidityAddress(), 25],
		);

		expect(result[0]).to.be.false;

		// test the batch validity check
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkNFTDelegationIsValidBatch',
			[
				[DelNFTB_TokenId.toSolidityAddress()],
				[[25]],
			],
		);


		// operator will show as having a delegation still
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getNFTsDelegatedTo',
			[operatorId.toSolidityAddress()],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(1);
		expect(result[1][0].length).to.be.equal(1);
		expect(result[1][0][0]).to.be.equal(25);

		// checkDelegateToken should be false
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[operatorId.toSolidityAddress(), DelNFTB_TokenId.toSolidityAddress(), 25],
		);

		expect(result[0]).to.be.false;

		// Alice will still show as having a delegation
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getDelegatedNFTsBy',
			[aliceId.toSolidityAddress(), true],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(1);
		expect(result[1].length).to.be.equal(1);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(DelNFTB_TokenId.toSolidityAddress().toLowerCase());
		expect(result[1][0].length).to.be.equal(1);
		expect(result[1][0][0]).to.be.equal(25);

		// when Bob delegates the token to operator it should be valid again and clean up the old delegation
		client.setOperator(bobId, bobPK);

		// delegate token B serial 25 to operator

		result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			800_000,
			'delegateNFT',
			[operatorId.toSolidityAddress(), DelNFTB_TokenId.toSolidityAddress(), [25]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateNFT failed', result);
			fail();
		}

		// check totalSerialsDelegated = 1
		// no increment as actually a reuse of the delegation

		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'totalSerialsDelegated',
			[],
		);

		expect(Number(result[0])).to.be.equal(1);

		// checkNFTDelegationIsValid
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkNFTDelegationIsValid',
			[DelNFTB_TokenId.toSolidityAddress(), 25],
		);

		// operator will have been cleaned up
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getNFTsDelegatedTo',
			[operatorId.toSolidityAddress()],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(0);
		expect(result[1].length).to.be.equal(0);

		// checkDelegateToken should be true
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[operatorId.toSolidityAddress(), DelNFTB_TokenId.toSolidityAddress(), 25],
		);

		expect(result[0]).to.be.true;

		// Alice will no longer show as having a delegation
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getDelegatedNFTsBy',
			[aliceId.toSolidityAddress(), true],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(0);
		expect(result[1].length).to.be.equal(0);

		// Bob will show as having a delegation
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			300_000,
			'getDelegatedNFTsBy',
			[bobId.toSolidityAddress(), true],
		);

		expect(result.length).to.be.equal(2);
		expect(result[0].length).to.be.equal(1);
		expect(result[1].length).to.be.equal(1);
		expect(result[0][0].slice(2).toLowerCase()).to.be.equal(DelNFTB_TokenId.toSolidityAddress().toLowerCase());
		expect(result[1][0].length).to.be.equal(1);
		expect(result[1][0][0]).to.be.equal(25);
	});
});

describe('Testing LDA in solidity', () => {
	it('check wallet delegate', async () => {
		// ensure alice is delegated back to operator
		client.setOperator(aliceId, alicePK);
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			null,
			'delegateWalletTo',
			[operatorId.toSolidityAddress()],
		);

		// set the delegate wallet
		client.setOperator(operatorId, operatorKey);

		// call getDelegatedWallet on ldrTester for Alice
		result = await contractExecuteQuery(
			ldrTesterId,
			ldrtesterIface,
			client,
			null,
			'getDelegatedWallet',
			[aliceId.toSolidityAddress()],
		);

		expect(result[0].slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());
	});

	it('check token delegate', async () => {
		client.setOperator(operatorId, operatorKey);

		// delegate a token to bob
		let result = await contractExecuteFunction(
			ldrContractId,
			ldrIface,
			client,
			800_000,
			'delegateNFT',
			[bobId.toSolidityAddress(), DelNFTA_TokenId.toSolidityAddress(), [4]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR: delegateNFT failed', result);
			fail();
		}

		// checkNFTDelegationIsValid
		result = await contractExecuteQuery(
			ldrContractId,
			ldrIface,
			client,
			null,
			'checkNFTDelegationIsValid',
			[DelNFTA_TokenId.toSolidityAddress(), 4],
		);

		expect(result[0]).to.be.true;

		// As bob -> call checkDelegatedToken on ldrTester for token A serial 4
		client.setOperator(bobId, bobPK);
		result = await contractExecuteQuery(
			ldrTesterId,
			ldrtesterIface,
			client,
			300_000,
			'checkDelegatedToken',
			[DelNFTA_TokenId.toSolidityAddress(), 4],
		);

		expect(result[0]).to.be.true;
	});
});

describe('Test scaling', () => {
	it.skip('test 10_000 total token delegations', async () => {
		client.setOperator(aliceId, alicePK);
	});

	it.skip('test getDelegatedNFTsBy for large quantities', async () => {
		client.setOperator(aliceId, alicePK);
	});
});

describe('clean-up resources', () => {
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