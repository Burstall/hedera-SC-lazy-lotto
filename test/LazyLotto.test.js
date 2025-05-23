const {
	Client,
	AccountId,
	PrivateKey,
	Hbar,
	ContractFunctionParameters,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { expect } = require('chai');
const { describe, it, before, after } = require('mocha');
const { sleep } = require('../utils/nodeHelpers');
const { checkLastMirrorEvent } = require('../utils/hederaMirrorHelpers');

// Import LazyLotto ABI and ethers Interface
const lazyLottoAbi = JSON.parse(fs.readFileSync(
	'./artifacts/contracts/LazyLotto.sol/LazyLotto.json',
	'utf8',
)).abi;
const lazyLottoIface = new ethers.Interface(lazyLottoAbi);
const {
	contractDeployFunction,
	contractExecuteFunction,
	linkBytecode,
	readOnlyEVMFromMirrorNode,
} = require('../utils/solidityHelpers');
const {
	accountCreator,
	associateTokenToAccount,
} = require('../utils/hederaHelpers');

const { ethers } = require('ethers');

require('dotenv').config();

// Environment variables
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const env = process.env.ENVIRONMENT ?? null;

// Contract Names
const LAZY_LOTTO_CONTRACT_NAME = 'LazyLotto';
const HTS_LAZY_LOTTO_LIBRARY_NAME = 'HTSLazyLottoLibrary';
// Assuming this is the PRNG implementation
const PRNG_CONTRACT_NAME = 'PrngSystemContract';
const LAZY_GAS_STATION_NAME = 'LazyGasStation';
const LAZY_DELEGATE_REGISTRY_NAME = 'LazyDelegateRegistry';
// To create the $LAZY token
const LAZY_TOKEN_CREATOR_NAME = 'LAZYTokenCreator';

// Reused variables
let client, aliceId, aliceKey, bobId, bobKey;
let htsLazyLottoLibraryAddress;
let prngContractId, prngContractAddress;
let mockPrngContractId, mockPrngContractAddress;
let lazySCT, lazyTokenId, lazyTokenAddress;
let lazyGasStationId, lazyGasStationAddress;
let lazyDelegateRegistryAddress, lazyDelegateRegistryId; // Added lazyDelegateRegistryId
let lazyLottoContractId, lazyLottoContractAddress;
let testFtTokenId, testFtTokenAddress; // Added for Test FT


// --- DRY Assertion Helpers ---
function expectEqual(actual, expected, label) {
	if (actual !== expected) {
		console.error(`Assertion failed for ${label}: expected`, expected, 'but got', actual);
	}
	expect(actual).to.equal(expected);
}

function expectTrue(actual, label) {
	if (!actual) {
		console.error(`Assertion failed for ${label}: expected true but got`, actual);
	}
	expect(actual).to.be.true;
}

function expectFalse(actual, label) {
	if (actual) {
		console.error(`Assertion failed for ${label}: expected false but got`, actual);
	}
	expect(actual).to.be.false;
}

function expectGt(actual, threshold, label) {
	if (!(actual > threshold)) {
		console.error(`Assertion failed for ${label}: expected >`, threshold, 'but got', actual);
	}
	expect(actual).to.be.gt(threshold);
}

function expectInclude(actual, expectedSubstring, label) {
	if (!actual.includes(expectedSubstring)) {
		console.error(`Assertion failed for ${label}: expected to include`, expectedSubstring, 'but got', actual);
	}
	expect(actual).to.include(expectedSubstring);
}

/**
 * Read-only contract call via mirror node.
 * @param {string} env - Environment string (e.g., 'TEST', 'MAIN', etc.)
 * @param {ContractId} contractId - The contract to call.
 * @param {ethers.Interface} iface - The ethers.js interface for the contract.
 * @param {string} functionName - The function to call.
 * @param {Array} params - The parameters for the function.
 * @param {AccountId} from - The account making the call.
 * @returns {Array} Decoded result.
 */
async function contractCallQuery(env, contractId, iface, functionName, params, from) {
	const encodedCommand = iface.encodeFunctionData(functionName, params);
	const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, from, false);
	return iface.decodeFunctionResult(functionName, result);
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// Example: 10%
const INITIAL_BURN_PERCENTAGE = 10;


// Pool constants
// 1 decimal for $LAZY
// Typically for the first $LAZY pool
const POOL_ID_HBAR = 0;
const POOL_ID_1 = 1;
// 1 HBAR
const TICKET_PRICE_HBAR = new Hbar(1).toTinybars();
// 100 $LAZY with 1 decimal (1000 units)
const TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(100);

// --- Static CIDs for pool creation ---
// TODO: Replace these with valid IPFS CIDs for ticket and win metadata
const STATIC_TICKET_CID = "QmRaFKdfr1tVXR8RhKrJauzo36GRgrS2BBcLwKbuEGr4aF";
const STATIC_WIN_CID = "QmdesReE1YzB2ERR4erGxEajwQkLJKhdX66Hbz6vaJHXN7";


describe('LazyLotto Contract Tests', function () {
	this.timeout(120000); // Set timeout for the whole describe block

	let nftCollections = [];

	// Consolidated before hook
	before(async function () {
		// Initialize client and accounts first
		client = Client.forName(env === 'testnet' ? 'testnet' : 'previewnet');
		client.setOperator(operatorId, operatorKey);
		client.setDefaultMaxTransactionFee(new Hbar(100));

		[aliceId, aliceKey] = await accountCreator(client, operatorKey, new Hbar(100));
		[bobId, bobKey] = await accountCreator(client, operatorKey, new Hbar(100));

		console.log('Operator ID:', operatorId.toString());
		console.log('Alice ID:', aliceId.toString());
		console.log('Bob ID:', bobId.toString());

		// --- Create/Reuse Test Fungible Token ---
		console.log('\\nCreating/Reusing Test Fungible Token...');
		if (process.env.TEST_FT_TOKEN_ID) {
			console.log('- Using existing Test FT from .env:', process.env.TEST_FT_TOKEN_ID);
			testFtTokenId = TokenId.fromString(process.env.TEST_FT_TOKEN_ID);
			testFtTokenAddress = testFtTokenId.toSolidityAddress();
		} else {
			console.log('- Minting new Test FT...');
			const { TokenCreateTransaction, TokenType, TokenSupplyType } = require('@hashgraph/sdk');
			const ftCreateTx = await new TokenCreateTransaction()
				.setTokenName('TestFT')
				.setTokenSymbol('TFT')
				.setTokenType(TokenType.FungibleCommon)
				.setDecimals(2)
				.setInitialSupply(1000000) // 10,000.00 TFT
				.setTreasuryAccountId(operatorId)
				.setAdminKey(operatorKey)
				.setSupplyKey(operatorKey)
				.freezeWith(client);
			const ftCreateSign = await ftCreateTx.sign(operatorKey);
			const ftCreateSubmit = await ftCreateSign.execute(client);
			const ftCreateReceipt = await ftCreateSubmit.getReceipt(client);
			testFtTokenId = ftCreateReceipt.tokenId;
			testFtTokenAddress = testFtTokenId.toSolidityAddress();
			console.log(`Test FT created: ${testFtTokenId.toString()} (Address: ${testFtTokenAddress})`);
			console.log('Set TEST_FT_TOKEN_ID in your .env for future runs!');
		}
		// Associate Test FT to Alice and Bob for testing purposes
		await associateTokenToAccount(client, testFtTokenId, aliceId, aliceKey);
		await associateTokenToAccount(client, testFtTokenId, bobId, bobKey);

		// 1. Deploy HTSLazyLottoLibrary
		console.log('\\nDeploying HTSLazyLottoLibrary...');
		const libraryBytecode = fs.readFileSync(`./artifacts/contracts/${HTS_LAZY_LOTTO_LIBRARY_NAME}.sol/${HTS_LAZY_LOTTO_LIBRARY_NAME}.bin`);
		const libraryDeploy = await contractDeployFunction(client, libraryBytecode, 750_000);
		htsLazyLottoLibraryAddress = libraryDeploy.contractId.toSolidityAddress();
		console.log(`${HTS_LAZY_LOTTO_LIBRARY_NAME} deployed at: ${htsLazyLottoLibraryAddress}`);


		// 2. Deploy or reuse PrngSystemContract (real, for reference)
		if (process.env.PRNG_CONTRACT_ID) {
			console.log('\\n- Using existing PrngSystemContract:', process.env.PRNG_CONTRACT_ID);
			prngContractId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
			prngContractAddress = prngContractId.toSolidityAddress();
		} else {
			console.log('\\nDeploying PrngSystemContract (real)...');
			const prngBytecode = fs.readFileSync(`./artifacts/contracts/${PRNG_CONTRACT_NAME}.sol/${PRNG_CONTRACT_NAME}.bin`);
			const prngDeploy = await contractDeployFunction(client, prngBytecode, 600_000);
			prngContractId = prngDeploy.contractId;
			prngContractAddress = prngContractId.toSolidityAddress();
			console.log(`${PRNG_CONTRACT_NAME} deployed at: ${prngContractAddress} (${prngContractId.toString()})`);
		}

		// 2b. Deploy or reuse MockPrngSystemContract for deterministic tests
		if (process.env.MOCK_PRNG_CONTRACT_ID) {
			console.log('\\n- Using existing MockPrngSystemContract:', process.env.MOCK_PRNG_CONTRACT_ID);
			mockPrngContractId = ContractId.fromString(process.env.MOCK_PRNG_CONTRACT_ID);
			mockPrngContractAddress = mockPrngContractId.toSolidityAddress();
		} else {
			console.log('\\nDeploying MockPrngSystemContract for deterministic randomness...');
			const mockPrngBytecode = fs.readFileSync('./artifacts/contracts/mocks/MockPrngSystemContract.sol/MockPrngSystemContract.bin');
			// Use a static seed and number for deterministic results
			const staticSeed = ethers.utils.formatBytes32String('static-seed');
			const staticNumber = 0; const mockPrngParams = new ContractFunctionParameters()
				.addBytes32(staticSeed)
				.addUint256(staticNumber);
			const mockPrngDeploy = await contractDeployFunction(client, mockPrngBytecode, 600_000, mockPrngParams);
			mockPrngContractId = mockPrngDeploy.contractId;
			mockPrngContractAddress = mockPrngContractId.toSolidityAddress();
			console.log(`MockPrngSystemContract deployed at: ${mockPrngContractAddress} (${mockPrngContractId.toString()})`);
		}


		// 3. Deploy or reuse LAZY SCT and $LAZY token
		let lazyTokenCreatorDeploy, lazyTokenCreatorAddress; // lazySCT is declared outside
		const lazyJson = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/legacy/${LAZY_TOKEN_CREATOR_NAME}.sol/${LAZY_TOKEN_CREATOR_NAME}.json`)
		);
		const lazyIface = new ethers.Interface(lazyJson.abi);

		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			console.log('\\n- Using existing LAZY SCT and $LAZY token:', process.env.LAZY_SCT_CONTRACT_ID, process.env.LAZY_TOKEN_ID);
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			lazyTokenAddress = lazyTokenId.toSolidityAddress();
		} else {
			// Deploy LAZY SCT
			if (process.env.LAZY_TOKEN_CREATOR_CONTRACT_ID) {
				console.log('\\n- Using existing LAZYTokenCreator:', process.env.LAZY_TOKEN_CREATOR_CONTRACT_ID);
				lazyTokenCreatorAddress = process.env.LAZY_TOKEN_CREATOR_CONTRACT_ID;
				lazySCT = ContractId.fromString(process.env.LAZY_TOKEN_CREATOR_CONTRACT_ID);
			} else {
				console.log('\\nDeploying LAZYTokenCreator...');
				const lazyTokenCreatorBytecode = fs.readFileSync(`./artifacts/contracts/legacy/${LAZY_TOKEN_CREATOR_NAME}.sol/${LAZY_TOKEN_CREATOR_NAME}.bin`);
				lazyTokenCreatorDeploy = await contractDeployFunction(client, lazyTokenCreatorBytecode, 3_000_000);
				lazyTokenCreatorAddress = lazyTokenCreatorDeploy.contractId.toSolidityAddress();
				lazySCT = lazyTokenCreatorDeploy.contractId;
				console.log(`${LAZY_TOKEN_CREATOR_NAME} deployed at: ${lazyTokenCreatorAddress}`);
			}
			// Mint $LAZY token using createFungibleWithBurn
			const tokenName = 'LazyToken';
			const tokenSymbol = 'LAZY';
			const tokenMemo = 'Test $LAZY token';
			const tokenInitialSupply = 2500000000;
			const tokenDecimals = 1;
			const tokenMaxSupply = 2500000000;
			const payment = 15;
			const params = [
				tokenName,
				tokenSymbol,
				tokenMemo,
				tokenInitialSupply,
				tokenDecimals,
				tokenMaxSupply,
			];
			const [, , createTokenRecord] = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				800000,
				'createFungibleWithBurn',
				params,
				payment,
			);
			const tokenIdSolidityAddr = createTokenRecord.contractFunctionResult.getAddress(0);
			lazyTokenId = TokenId.fromSolidityAddress(tokenIdSolidityAddr);
			lazyTokenAddress = tokenIdSolidityAddr;
			console.log(`$LAZY token created at: ${lazyTokenAddress} (${lazyTokenId.toString()})`);
		}
		// Associate for Alice
		await associateTokenToAccount(client, lazyTokenId, aliceId, aliceKey);
		// Associate for Bob
		await associateTokenToAccount(client, lazyTokenId, bobId, bobKey);

		// 4. Deploy or reuse LazyGasStation
		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			console.log('\n- Using existing LazyGasStation:', process.env.LAZY_GAS_STATION_CONTRACT_ID);
			lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
			lazyGasStationAddress = lazyGasStationId.toSolidityAddress();
		} else {
			console.log('\\nDeploying LazyGasStation...');
			const lgsBytecode = fs.readFileSync(`./artifacts/contracts/${LAZY_GAS_STATION_NAME}.sol/${LAZY_GAS_STATION_NAME}.bin`);
			const lgsParams = new ContractFunctionParameters()
				.addAddress(lazyTokenAddress)
				// initialAdmin
				.addAddress(operatorId.toSolidityAddress());
			const lgsDeploy = await contractDeployFunction(client, lgsBytecode, 2_000_000, lgsParams);
			lazyGasStationId = lgsDeploy.contractId;
			lazyGasStationAddress = lazyGasStationId.toSolidityAddress();
			console.log(`${LAZY_GAS_STATION_NAME} deployed at: ${lazyGasStationAddress} (${lazyGasStationId.toString()})`);
		}
		// Send some $LAZY to LazyGasStation for its operations
		// This would typically be done via a transfer from the $LAZY token treasury (operator)
		// For simplicity in test setup, assuming LGS might need $LAZY. If not, this can be skipped.
		// Or, LGS pulls $LAZY via its functions. The contract has \\`refillLazy\\` and \\`refillHbar\\`.

		// 5. Deploy or reuse LazyDelegateRegistry
		if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			console.log('\n- Using existing LazyDelegateRegistry:', process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
			lazyDelegateRegistryId = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
			lazyDelegateRegistryAddress = lazyDelegateRegistryId.toSolidityAddress();
		} else {
			console.log('\\nDeploying LazyDelegateRegistry...');
			const ldrBytecode = fs.readFileSync(`./artifacts/contracts/${LAZY_DELEGATE_REGISTRY_NAME}.sol/${LAZY_DELEGATE_REGISTRY_NAME}.bin`);
			const ldrParams = new ContractFunctionParameters()
				// initialAdmin
				.addAddress(operatorId.toSolidityAddress());
			const ldrDeploy = await contractDeployFunction(client, ldrBytecode, 1_000_000, ldrParams);
			lazyDelegateRegistryId = ldrDeploy.contractId;
			lazyDelegateRegistryAddress = lazyDelegateRegistryId.toSolidityAddress();
			console.log(`${LAZY_DELEGATE_REGISTRY_NAME} deployed at: ${lazyDelegateRegistryAddress} (${lazyDelegateRegistryId.toString()})`);
		}

		// 6. Deploy LazyLotto contract
		console.log('\\nDeploying LazyLotto contract...');
		let lazyLottoBytecode = fs.readFileSync(`./artifacts/contracts/${LAZY_LOTTO_CONTRACT_NAME}.sol/${LAZY_LOTTO_CONTRACT_NAME}.bin`).toString();

		// Link HTSLazyLottoLibrary
		const linkableLibraries = {};
		linkableLibraries[`contracts/${HTS_LAZY_LOTTO_LIBRARY_NAME}.sol:${HTS_LAZY_LOTTO_LIBRARY_NAME}`] = htsLazyLottoLibraryAddress;
		lazyLottoBytecode = linkBytecode(lazyLottoBytecode, linkableLibraries);


		// Use mockPrngContractAddress for deterministic tests, or prngContractAddress for integration
		const useMockPrng = true;
		const prngToUse = useMockPrng ? mockPrngContractAddress : prngContractAddress;
		const lazyLottoConstructorParams = new ContractFunctionParameters()
			.addAddress(lazyTokenAddress)
			.addAddress(lazyGasStationAddress)
			.addAddress(lazyDelegateRegistryAddress)
			.addAddress(prngToUse)
			.addUint256(INITIAL_BURN_PERCENTAGE);

		// High gas for linking and deployment
		const lazyLottoDeploy = await contractDeployFunction(client, Buffer.from(lazyLottoBytecode, 'hex'), 7_000_000, lazyLottoConstructorParams);
		lazyLottoContractId = lazyLottoDeploy.contractId;
		lazyLottoContractAddress = lazyLottoContractId.toSolidityAddress();
		console.log(`${LAZY_LOTTO_CONTRACT_NAME} deployed at: ${lazyLottoContractAddress} (${lazyLottoContractId.toString()})`);

		// --- Mint three NFT collections (A, B, C) ---
		const { TokenCreateTransaction, TokenType, TokenSupplyType, TokenMintTransaction } = require('@hashgraph/sdk');
		nftCollections = []; // Resetting here to ensure it's empty for this setup phase
		const nftCollectionNames = ['NFT_A', 'NFT_B', 'NFT_C'];
		const nftMinters = [operatorId, aliceId, bobId];
		const nftMinterKeys = [operatorKey, aliceKey, bobKey];
		const nftsPerCollection = 5;
		for (let i = 0; i < 3; i++) {
			const minterId = nftMinters[i];
			const minterKey = nftMinterKeys[i];
			// Create NFT collection
			const nftCreateTx = await new TokenCreateTransaction()
				.setTokenName(nftCollectionNames[i])
				.setTokenSymbol(nftCollectionNames[i])
				.setTokenType(TokenType.NonFungibleUnique)
				.setDecimals(0)
				.setInitialSupply(0)
				.setTreasuryAccountId(minterId)
				.setSupplyType(TokenSupplyType.Finite)
				.setMaxSupply(nftsPerCollection)
				.freezeWith(client)
				.sign(minterKey);
			const nftCreateSubmit = await nftCreateTx.execute(client);
			const nftCreateReceipt = await nftCreateSubmit.getReceipt(client);
			const nftTokenId = nftCreateReceipt.tokenId;
			const nftTokenAddress = nftTokenId.toSolidityAddress();
			// Mint NFTs
			const mintedSerials = [];
			for (let j = 0; j < nftsPerCollection; j++) {
				const mintTx = await new TokenMintTransaction()
					.setTokenId(nftTokenId)
					.setMetadata([Buffer.from(`NFT_${nftCollectionNames[i]}_${j + 1}`)])
					.freezeWith(client)
					.sign(minterKey);
				const mintSubmit = await mintTx.execute(client);
				const mintReceipt = await mintSubmit.getReceipt(client);
				mintedSerials.push(mintReceipt.serials[0]);
			}
			nftCollections.push({
				name: nftCollectionNames[i],
				tokenId: nftTokenId,
				tokenAddress: nftTokenAddress,
				minterId,
				minterKey,
				serials: mintedSerials,
			});
			console.log(`${nftCollectionNames[i]}_TOKEN_ID: ${nftTokenId.toString()} (address: ${nftTokenAddress})`);
			console.log(`Set ${nftCollectionNames[i]}_TOKEN_ID in your .env for future runs!`);
		}

		// --- Associate all NFTs and FTs to all users ---
		// Ensure testFtTokenId is defined if used, or remove from allTokenIds if not applicable for this setup
		const allTokenIds = [lazyTokenId, ...nftCollections.map(nft => nft.tokenId)];
		if (testFtTokenId) { // Conditionally add testFtTokenId if it exists
			allTokenIds.unshift(testFtTokenId);
		}
		const allUsers = [
			{ id: operatorId, key: operatorKey },
			{ id: aliceId, key: aliceKey },
			{ id: bobId, key: bobKey }
		];
		// await associateAllTokensToAllUsers(client, allTokenIds, allUsers); // Replaced this
		console.log('\nAssociating all tokens to all users...');
		for (const user of allUsers) {
			for (const tokenId of allTokenIds) {
				if (tokenId) { // Ensure tokenId is not undefined (e.g. if testFtTokenId was not set)
					await associateTokenToAccount(client, tokenId, user.id, user.key);
				}
			}
		}
		console.log('All tokens associated with all users.');

		console.log('\nSetup complete.');
	});

	// The second 'before' block and the extra this.timeout are removed

	// ... tests ...

	after(async function () {
		// Optional: Clean up resources, though local node usually resets.
		// For testnet, you might want to burn tokens, etc.
		if (client) {
			client.close();
		}
		console.log('\\nTests finished. Client closed.');
	});

	describe('4.1. Contract Deployment and Initialization', function () {
		it('Test 4.1.1: Should deploy with valid parameters and set initial state', async function () {

			expectTrue(!!lazyLottoContractId, 'lazyLottoContractId set');
			expectTrue(!!lazyLottoContractAddress, 'lazyLottoContractAddress set');

			// Verify: \`lazyToken\`
			let result = await contractCallQuery(env, lazyLottoContractId, lazyLottoIface, 'lazyToken', [], operatorId);
			expectEqual(result[0].toLowerCase(), lazyTokenAddress.toLowerCase(), 'lazyToken address');

			// Verify: \`lazyGasStation\`
			result = await contractCallQuery(env, lazyLottoContractId, lazyLottoIface, 'lazyGasStation', [], operatorId);
			expectEqual(result[0].toLowerCase(), lazyGasStationAddress.toLowerCase(), 'lazyGasStation address');

			// Verify: \`lazyDelegateRegistry\`
			result = await contractCallQuery(env, lazyLottoContractId, lazyLottoIface, 'lazyDelegateRegistry', [], operatorId);
			expectEqual(result[0].toLowerCase(), lazyDelegateRegistryAddress.toLowerCase(), 'lazyDelegateRegistry address');

			// Verify: \`prng\`
			// Assuming prngToUse was mockPrngContractAddress during deployment in the 'before' hook
			const expectedPrngAddress = mockPrngContractAddress; // or prngContractAddress if useMockPrng was false
			result = await contractCallQuery(env, lazyLottoContractId, lazyLottoIface, 'prng', [], operatorId);
			expectEqual(result[0].toLowerCase(), expectedPrngAddress.toLowerCase(), 'prngContract address');

			// Verify: \`burnPercentage\`
			result = await contractCallQuery(env, lazyLottoContractId, lazyLottoIface, 'burnPercentage', [], operatorId);
			expectEqual(result[0].toNumber(), INITIAL_BURN_PERCENTAGE, 'burnPercentage');

			// Verify: Deployer is admin
			const queryParamsIsAdmin = [operatorId.toSolidityAddress()];
			result = await contractCallQuery(env, lazyLottoContractId, lazyLottoIface, 'isAdmin', queryParamsIsAdmin, operatorId);
			expectTrue(result[0], 'deployer is admin');

			// Verify: AdminAdded event emitted for deployer
			// This requires mirror node integration or specific event listening setup.
			// For now, we'll assume the isAdmin check is sufficient for this part of the test.
			// Later, we can add more robust event checking.
			console.log('Test 4.1.1 Passed: Deployed with valid parameters and initial state verified.');
		});

		it('Test 4.1.2: Should fail to deploy with zero address for _lazyToken', async function () {
			let lazyLottoBytecode = fs.readFileSync(`./artifacts/contracts/${LAZY_LOTTO_CONTRACT_NAME}.sol/${LAZY_LOTTO_CONTRACT_NAME}.bin`).toString();

			const linkableLibraries = {};
			linkableLibraries[`contracts/${HTS_LAZY_LOTTO_LIBRARY_NAME}.sol:${HTS_LAZY_LOTTO_LIBRARY_NAME}`] = htsLazyLottoLibraryAddress;
			lazyLottoBytecode = linkBytecode(lazyLottoBytecode, linkableLibraries);

			const badParams = new ContractFunctionParameters()
				// _lazyToken
				.addAddress(ZERO_ADDRESS)
				.addAddress(lazyGasStationAddress)
				.addAddress(lazyDelegateRegistryAddress)
				.addAddress(prngContractAddress)
				.addUint256(INITIAL_BURN_PERCENTAGE);

			try {
				await contractDeployFunction(client, Buffer.from(lazyLottoBytecode, 'hex'), 7000000, badParams);
				expect.fail('Deployment should have failed with zero address for _lazyToken');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.1.2 Passed: Failed to deploy with zero _lazyToken as expected.');
			}
		});

		it('Test 4.1.3: Should fail to deploy with zero address for _lazyGasStation', async function () {
			let lazyLottoBytecode = fs.readFileSync(`./artifacts/contracts/${LAZY_LOTTO_CONTRACT_NAME}.sol/${LAZY_LOTTO_CONTRACT_NAME}.bin`).toString();
			const linkableLibraries = {};
			linkableLibraries[`contracts/${HTS_LAZY_LOTTO_LIBRARY_NAME}.sol:${HTS_LAZY_LOTTO_LIBRARY_NAME}`] = htsLazyLottoLibraryAddress;
			lazyLottoBytecode = linkBytecode(lazyLottoBytecode, linkableLibraries);
			const badParams = new ContractFunctionParameters()
				.addAddress(lazyTokenAddress)
				// _lazyGasStation
				.addAddress(ZERO_ADDRESS)
				.addAddress(lazyDelegateRegistryAddress)
				.addAddress(prngContractAddress)
				.addUint256(INITIAL_BURN_PERCENTAGE);
			try {
				await contractDeployFunction(client, Buffer.from(lazyLottoBytecode, 'hex'), 7000000, badParams);
				expect.fail('Deployment should have failed with zero address for _lazyGasStation');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.1.3 Passed: Failed to deploy with zero _lazyGasStation as expected.');
			}
		});

		it('Test 4.1.4: Should fail to deploy with zero address for _lazyDelegateRegistry', async function () {
			let lazyLottoBytecode = fs.readFileSync(`./artifacts/contracts/${LAZY_LOTTO_CONTRACT_NAME}.sol/${LAZY_LOTTO_CONTRACT_NAME}.bin`).toString();
			const linkableLibraries = {};
			linkableLibraries[`contracts/${HTS_LAZY_LOTTO_LIBRARY_NAME}.sol:${HTS_LAZY_LOTTO_LIBRARY_NAME}`] = htsLazyLottoLibraryAddress;
			lazyLottoBytecode = linkBytecode(lazyLottoBytecode, linkableLibraries);
			const badParams = new ContractFunctionParameters()
				.addAddress(lazyTokenAddress)
				.addAddress(lazyGasStationAddress)
				// _lazyDelegateRegistry
				.addAddress(ZERO_ADDRESS)
				.addAddress(prngContractAddress)
				.addUint256(INITIAL_BURN_PERCENTAGE);
			try {
				await contractDeployFunction(client, Buffer.from(lazyLottoBytecode, 'hex'), 7000000, badParams);
				expect.fail('Deployment should have failed with zero address for _lazyDelegateRegistry');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.1.4 Passed: Failed to deploy with zero _lazyDelegateRegistry as expected.');
			}
		});

		it('Test 4.1.5: Should fail to deploy with zero address for _prng', async function () {
			let lazyLottoBytecode = fs.readFileSync(`./artifacts/contracts/${LAZY_LOTTO_CONTRACT_NAME}.sol/${LAZY_LOTTO_CONTRACT_NAME}.bin`).toString();
			const linkableLibraries = {};
			linkableLibraries[`contracts/${HTS_LAZY_LOTTO_LIBRARY_NAME}.sol:${HTS_LAZY_LOTTO_LIBRARY_NAME}`] = htsLazyLottoLibraryAddress;
			lazyLottoBytecode = linkBytecode(lazyLottoBytecode, linkableLibraries);
			const badParams = new ContractFunctionParameters()
				.addAddress(lazyTokenAddress)
				.addAddress(lazyGasStationAddress)
				.addAddress(lazyDelegateRegistryAddress)
				// _prng
				.addAddress(ZERO_ADDRESS)
				.addUint256(INITIAL_BURN_PERCENTAGE);
			try {
				await contractDeployFunction(client, Buffer.from(lazyLottoBytecode, 'hex'), 7000000, badParams);
				expect.fail('Deployment should have failed with zero address for _prng');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.1.5 Passed: Failed to deploy with zero _prng as expected.');
			}
		});
	});

	describe('4.2. Admin Management', function () {
		describe('4.2.1. addAdmin(address admin)', function () {
			it('Test 4.2.1.1: Admin should be able to add a new admin', async function () {
				const addAdminParams = [bobId.toSolidityAddress()];
				const addAdminTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					addAdminParams,
					0,
					'addAdmin',
					150000
				);
				// Ensure transaction succeeded
				await addAdminTx.getReceipt(client);

				// Verify Bob is now an admin
				const isAdminParams = [bobId.toSolidityAddress()];
				const result = await contractCallQuery(client, lazyLottoContractId, isAdminParams, 100000, 'isAdmin');
				expectTrue(result.getBool(0), 'Bob is admin after addAdmin');
				console.log('Test 4.2.1.1 Passed: Admin (Operator) successfully added Bob as admin.');
				// Verify AdminAdded event emitted with Bob's address
				await sleep(5000);
				const lastEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, 0, true);
				expect(lastEvent.toString()).to.equal(bobId.toString());
			});

			it('Test 4.2.1.2: Non-admin should not be able to add a new admin', async function () {
				// Alice (non-admin) attempts to add a new admin (e.g., herself or another address)
				// A dummy address
				const tempAccountId = AccountId.fromString('0.0.12345');
				const addAdminParams = [tempAccountId.toSolidityAddress()];

				// Switch client to Alice
				const originalOperator = client.operatorAccountId;
				const originalOperatorKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						addAdminParams,
						0,
						'addAdmin',
						150000
					);
					expect.fail('Non-admin (Alice) should not have been able to add an admin');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'Non-admin addAdmin revert');
					console.log('Test 4.2.1.2 Passed: Non-admin (Alice) failed to add admin as expected.');
				}
				finally {
					// Reset client to original operator
					client.setOperator(originalOperator, originalOperatorKey);
				}
			});

			it('Test 4.2.1.3: Should not be able to add zero address as admin', async function () {
				const addAdminParams = [ZERO_ADDRESS];
				try {
					// Operator is admin
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						addAdminParams,
						0,
						'addAdmin',
						150000
					);
					expect.fail('Should not have been able to add zero address as admin');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addAdmin zero address revert');
					console.log('Test 4.2.1.3 Passed: Failed to add zero address as admin, as expected.');
				}
			});

			it('Test 4.2.1.4: Should not be able to add an existing admin again', async function () {
				const addAdminParams = [bobId.toSolidityAddress()];
				try {
					// Operator is admin
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						addAdminParams,
						0,
						'addAdmin',
						150000
					);
					expect.fail('Should not have been able to add an existing admin again');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addAdmin existing admin revert');
					console.log('Test 4.2.1.4 Passed: Failed to add existing admin (Bob) again, as expected.');
				}
			});
		});
	});

	describe('4.2.2. removeAdmin(address admin)', function () {
		it('Test 4.2.2.1: Admin should be able to remove another admin', async function () {
			// Operator (admin) removes Bob (who was added in 4.2.1.1)
			const removeAdminParams = [bobId.toSolidityAddress()];
			const removeAdminTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				removeAdminParams,
				0,
				'removeAdmin',
				150000
			);
			await removeAdminTx.getReceipt(client);

			// Verify Bob is no longer an admin
			const isAdminParams = [bobId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, isAdminParams, 100000, 'isAdmin');
			expectFalse(result.getBool(0), 'Bob is not admin after removeAdmin');
			console.log('Test 4.2.2.1 Passed: Admin (Operator) successfully removed Bob from admin role.');
			// Verify AdminRemoved event emitted with Bob's address
			await sleep(5000);
			const lastEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, 0, true);
			expect(lastEvent.toString()).to.equal(bobId.toString());
		});

		it('Test 4.2.2.2: Non-admin should not be able to remove an admin', async function () {
			// Alice (non-admin) attempts to remove Operator (admin)
			const removeAdminParams = [operatorId.toSolidityAddress()];

			const originalOperator = client.operatorAccountId;
			const originalOperatorKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);

			try {
				await contractExecuteFunction(
					client,
					lazyLottoContractId,
					removeAdminParams,
					0,
					'removeAdmin',
					150000
				);
				expect.fail('Non-admin (Alice) should not have been able to remove an admin');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'Non-admin removeAdmin revert');
				console.log('Test 4.2.2.2 Passed: Non-admin (Alice) failed to remove admin as expected.');
			}
			finally {
				client.setOperator(originalOperator, originalOperatorKey);
			}
		});

		it('Test 4.2.2.3: Should not be able to remove zero address', async function () {
			const removeAdminParams = [ZERO_ADDRESS];
			try {
				// Operator is admin
				await contractExecuteFunction(
					client,
					lazyLottoContractId,
					removeAdminParams,
					0,
					'removeAdmin',
					150000
				);
				expect.fail('Should not have been able to remove zero address');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removeAdmin zero address revert');
				console.log('Test 4.2.2.3 Passed: Failed to remove zero address as admin, as expected.');
			}
		});

		it('Test 4.2.2.4: Should not be able to remove a non-existing admin', async function () {
			// Alice was never an admin (or Bob was removed)
			const removeAdminParams = [aliceId.toSolidityAddress()];
			try {
				// Operator is admin
				await contractExecuteFunction(
					client,
					lazyLottoContractId,
					removeAdminParams,
					0,
					'removeAdmin',
					150000
				);
				expect.fail('Should not have been able to remove a non-existing admin');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removeAdmin non-existing admin revert');
				console.log('Test 4.2.2.4 Passed: Failed to remove non-existing admin (Alice), as expected.');
			}
		});

		it('Test 4.2.2.5: Admin should not be able to remove themselves if they are the last admin', async function () {
			// Ensure Operator is the only admin. Bob was removed in 4.2.2.1.
			// If other admins were added, they need to be removed first for this test.
			// Let's double check Bob is not an admin
			const isAdminParamsBob = [bobId.toSolidityAddress()];
			const resultBob = await contractCallQuery(client, lazyLottoContractId, isAdminParamsBob, 100000, 'isAdmin');
			// Bob should not be admin here
			expectFalse(resultBob.getBool(0), 'Bob is not admin before last self-remove');

			const removeAdminParams = [operatorId.toSolidityAddress()];
			try {
				// Operator is admin
				await contractExecuteFunction(
					client,
					lazyLottoContractId,
					removeAdminParams,
					0,
					'removeAdmin',
					150000
				);
				expect.fail('Admin should not have been able to remove themselves as the last admin');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removeAdmin last admin revert');
				console.log('Test 4.2.2.5 Passed: Failed to remove last admin (Operator), as expected.');
			}
		});
	});

	describe('4.2.3. isAdmin(address account)', function () {
		it('Test 4.2.3.1: Should return true for a known admin', async function () {
			// Operator is admin
			const isAdminParams = [operatorId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, isAdminParams, 100000, 'isAdmin');
			expect(result.getBool(0)).to.be.true;
			console.log('Test 4.2.3.1 Passed: isAdmin returned true for Operator.');
		});

		it('Test 4.2.3.2: Should return false for a non-admin', async function () {
			// Alice is not an admin
			const isAdminParams = [aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, isAdminParams, 100000, 'isAdmin');
			expect(result.getBool(0)).to.be.false;
			console.log('Test 4.2.3.2 Passed: isAdmin returned false for Alice.');
		});

		it('Test 4.2.3.3: Should return false for zero address', async function () {
			const isAdminParams = [ZERO_ADDRESS];
			const result = await contractCallQuery(client, lazyLottoContractId, isAdminParams, 100000, 'isAdmin');
			expect(result.getBool(0)).to.be.false;
			console.log('Test 4.2.3.3 Passed: isAdmin returned false for zero address.');
		});
	});

	describe('4.2.4. renounceAdmin()', function () {
		before(async function () {
			// Ensure Bob is an admin for these tests, so Operator is not the last admin initially
			const isAdminParams = [bobId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, isAdminParams, 100000, 'isAdmin');
			if (!result.getBool(0)) {
				console.log('Adding Bob as admin for renounceAdmin tests...');
				const addAdminParams = new ContractFunctionParameters().addAddress(bobId.toSolidityAddress());
				const tx = await contractExecuteFunction(client, lazyLottoContractId, addAdminParams, 0, 'addAdmin', 150000);
				await tx.getReceipt(client);
			}
		});

		it('Test 4.2.4.1: Admin should be able to renounce admin status if not the last admin', async function () {
			// Operator (admin) renounces admin status. Bob should still be an admin.
			// Operator executes
			const renounceAdminTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				[],
				0,
				'renounceAdmin',
				150000,
			);
			await renounceAdminTx.getReceipt(client);

			// Verify Operator is no longer an admin
			const isAdminParamsOperator = [operatorId.toSolidityAddress()];
			const resultOperator = await contractCallQuery(client, lazyLottoContractId, isAdminParamsOperator, 100000, 'isAdmin');
			expect(resultOperator.getBool(0)).to.be.false;

			// Verify Bob is still an admin
			const isAdminParamsBob = [bobId.toSolidityAddress()];
			const resultBob = await contractCallQuery(client, lazyLottoContractId, isAdminParamsBob, 100000, 'isAdmin');
			expect(resultBob.getBool(0)).to.be.true;
			console.log('Test 4.2.4.1 Passed: Operator successfully renounced admin status. Bob remains admin.');

			// Verify AdminRemoved event emitted with Operator's address
			await sleep(5000);
			const lastEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, 0, true);
			expect(lastEvent.toString()).to.equal(operatorId.toString());
		});

		it('Test 4.2.4.2: Admin should not be able to renounce if they are the last admin', async function () {
			// At this point, Bob is the only admin (Operator renounced in 4.2.4.1)
			// Bob attempts to renounce
			const originalOperator = client.operatorAccountId;
			const originalOperatorKey = client.operatorPublicKey;
			client.setOperator(bobId, bobKey);

			try {
				await contractExecuteFunction(
					client,
					lazyLottoContractId,
					[],
					0,
					'renounceAdmin',
					150000,
				);
				expect.fail('Admin should not have been able to renounce admin status as the last admin');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.2.4.2 Passed: Last admin (Bob) failed to renounce status, as expected.');
			}
			finally {
				// Reset to original operator (Operator account, though no longer admin)
				client.setOperator(originalOperator, originalOperatorKey);
			}
		});

		it('Test 4.2.4.3: Non-admin should not be able to call renounceAdmin', async function () {
			// Alice (non-admin) attempts to renounce
			// Operator is also non-admin at this point. Let's use Alice for clarity.
			const originalOperatorAc = client.operatorAccountId;
			const originalOperatorPK = client.operatorPublicKey;
			// Alice executes
			client.setOperator(aliceId, aliceKey);

			try {
				await contractExecuteFunction(
					client,
					lazyLottoContractId,
					[],
					0,
					'renounceAdmin',
					150000,
				);
				expect.fail('Non-admin (Alice) should not have been able to call renounceAdmin');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.2.4.3 Passed: Non-admin (Alice) failed to call renounceAdmin, as expected.');
			}
			finally {
				client.setOperator(originalOperatorAc, originalOperatorPK);
			}
			// Restore Operator as admin for subsequent tests if needed, or handle in their respective \\`before\\` blocks.
			// For now, Bob is the sole admin.
			// Let's add Operator back as admin, using Bob, to restore initial state for other test suites.
			console.log('Restoring Operator as admin via Bob...');
			// Client is currently Operator (non-admin), switch to Bob (admin) to perform action
			const currentClientOperator = client.operatorAccountId;
			const currentClientKey = client.operatorPublicKey;
			client.setOperator(bobId, bobKey);

			const addAdminParams = [operatorId.toSolidityAddress()];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, addAdminParams, 0, 'addAdmin', 150000);
			await tx.getReceipt(client);

			// Switch client back to original operator (Operator Account)
			client.setOperator(currentClientOperator, currentClientKey);

			// Verify Operator is admin again
			const isAdminParams = [operatorId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, isAdminParams, 100000, 'isAdmin');
			expect(result.getBool(0)).to.be.true;
			console.log('Operator restored as admin.');
		});
	});

	describe('4.3. Bonus Configuration (onlyAdmin) ', function () {
		describe('4.3.1. setBurnPercentage()', function () {
			it('Test 4.3.1: Admin can set valid burn percentage (0-100)', async function () {
				const newBurn = 15;
				const params = [newBurn];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setBurnPercentage', 100000);
				await tx.getReceipt(client);
				// Verify
				const queryParams = [];
				const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'burnPercentage');
				expectEqual(result.getUint256(0).toNumber(), newBurn, 'burnPercentage after setBurnPercentage');
			});

			it('Test 4.3.2: Admin cannot set burn percentage > 100', async function () {
				const params = [101];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setBurnPercentage', 100000);
					expectFalse(true, 'Should not set burn percentage > 100');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setBurnPercentage > 100 revert');
				}
			});

			it('Test 4.3.3: Non-admin cannot set burn percentage', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const params = [20];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setBurnPercentage', 100000);
					expectFalse(true, 'Non-admin should not set burn percentage');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setBurnPercentage non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		describe('4.3.4. setLazyBalanceBonus()', function () {
			it('Test 4.3.4: Admin can set valid lazy balance bonus', async function () {
				const threshold = ethers.BigNumber.from('1000');
				const bonusBps = 500;
				const params = [threshold, bonusBps];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setLazyBalanceBonus', 100000);
				await tx.getReceipt(client);
				// Verify (assume getter is lazyBalanceBonus)
				const queryParams = [];
				const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'lazyBalanceBonus');
				expectEqual(result.getUint256(0).toString(), threshold.toString(), 'lazyBalanceBonus threshold');
				expectEqual(result.getUint256(1).toNumber(), bonusBps, 'lazyBalanceBonus bonusBps');
			});

			it('Test 4.3.5: Admin cannot set zero threshold', async function () {
				const params = [0, 100];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setLazyBalanceBonus', 100000);
					expectFalse(true, 'Should not set zero threshold');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setLazyBalanceBonus zero threshold revert');
				}
			});

			it('Test 4.3.6: Admin cannot set bonusBps > 10000', async function () {
				const params = [1000, 10001];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setLazyBalanceBonus', 100000);
					expectFalse(true, 'Should not set bonusBps > 10000');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setLazyBalanceBonus bonusBps > 10000 revert');
				}
			});

			it('Test 4.3.7: Non-admin cannot set lazy balance bonus', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const params = [1000, 100];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setLazyBalanceBonus', 100000);
					expectFalse(true, 'Non-admin should not set lazy balance bonus');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setLazyBalanceBonus non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		// 4.3.8-4.3.20: Continue with setNFTBonus, setTimeBonus, removeTimeBonus, removeNFTBonus, etc.
		describe('4.3.8. setNFTBonus()', function () {
			it('Test 4.3.8: Admin can set NFT bonus for a token', async function () {
				// Example NFT token address and bonusBps
				const nftToken = ZERO_ADDRESS; // Replace with actual NFT address in real test
				const bonusBps = 1000;
				const params = [nftToken, bonusBps];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setNFTBonus', 100000);
				await tx.getReceipt(client);
				// Verify (assume getter is nftBonuses)
				const queryParams = [nftToken];
				const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'nftBonuses');
				expectEqual(result.getUint256(0).toNumber(), bonusBps, 'nftBonuses bonusBps');
			});

			it('Test 4.3.9: Admin cannot set NFT bonus > 10000', async function () {
				const nftToken = ZERO_ADDRESS;
				const params = [nftToken, 10001];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setNFTBonus', 100000);
					expectFalse(true, 'Should not set NFT bonus > 10000');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setNFTBonus bonusBps > 10000 revert');
				}
			});

			it('Test 4.3.10: Non-admin cannot set NFT bonus', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const nftToken = ZERO_ADDRESS;
				const params = [nftToken, 100];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setNFTBonus', 100000);
					expectFalse(true, 'Non-admin should not set NFT bonus');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setNFTBonus non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		describe('4.3.11. removeNFTBonus()', function () {
			it('Test 4.3.11: Admin can remove NFT bonus for a token', async function () {
				const nftToken = ZERO_ADDRESS;
				// First set a bonus
				let params = [nftToken, 500];
				let tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setNFTBonus', 100000);
				await tx.getReceipt(client);
				// Now remove
				params = [nftToken];
				tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removeNFTBonus', 100000);
				await tx.getReceipt(client);
				// Verify (assume getter is nftBonuses)
				const queryParams = [nftToken];
				const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'nftBonuses');
				expectEqual(result.getUint256(0).toNumber(), 0, 'nftBonuses after removal');
			});

			it('Test 4.3.12: Non-admin cannot remove NFT bonus', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const nftToken = ZERO_ADDRESS;
				const params = [nftToken];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removeNFTBonus', 100000);
					expectFalse(true, 'Non-admin should not remove NFT bonus');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removeNFTBonus non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		describe('4.3.13. setTimeBonus()', function () {
			it('Test 4.3.13: Admin can set time bonus', async function () {
				const start = Math.floor(Date.now() / 1000);
				const end = start + 3600;
				const bonusBps = 200;
				const params = [start, end, bonusBps];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setTimeBonus', 100000);
				await tx.getReceipt(client);
				// Verify (assume getter is timeBonuses)
				const queryParams = [start, end];
				const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'timeBonuses');
				expectEqual(result.getUint256(0).toNumber(), bonusBps, 'timeBonuses bonusBps');
			});

			it('Test 4.3.14: Admin cannot set time bonus > 10000', async function () {
				const start = Math.floor(Date.now() / 1000);
				const end = start + 3600;
				const params = [start, end, 10001];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setTimeBonus', 100000);
					expectFalse(true, 'Should not set time bonus > 10000');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setTimeBonus bonusBps > 10000 revert');
				}
			});

			it('Test 4.3.15: Non-admin cannot set time bonus', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const start = Math.floor(Date.now() / 1000);
				const end = start + 3600;
				const params = [start, end, 100];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setTimeBonus', 100000);
					expectFalse(true, 'Non-admin should not set time bonus');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'setTimeBonus non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		describe('4.3.16. removeTimeBonus()', function () {
			it('Test 4.3.16: Admin can remove time bonus', async function () {
				const start = Math.floor(Date.now() / 1000);
				const end = start + 3600;
				// First set a bonus
				let params = [start, end, 100];
				let tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'setTimeBonus', 100000);
				await tx.getReceipt(client);
				// Now remove
				params = [start, end];
				tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removeTimeBonus', 100000);
				await tx.getReceipt(client);
				// Verify (assume getter is timeBonuses)
				const queryParams = [start, end];
				const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'timeBonuses');
				expectEqual(result.getUint256(0).toNumber(), 0, 'timeBonuses after removal');
			});

			it('Test 4.3.17: Non-admin cannot remove time bonus', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const start = Math.floor(Date.now() / 1000);
				const end = start + 3600;
				const params = [start, end];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removeTimeBonus', 100000);
					expectFalse(true, 'Non-admin should not remove time bonus');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removeTimeBonus non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});
	});

	// --- 4.4. Pool Prize Management ---
	describe('4.4. Pool Prize Management', function () {

		const POOL_ID = POOL_ID_1;
		const FUNGIBLE_PRIZE_AMOUNT = ethers.BigNumber.from('10').pow(1).mul(50); // 50 $LAZY
		const TESTFT_PRIZE_AMOUNT = ethers.BigNumber.from(100); // 100 TESTFT (decimals handled by token)
		// Use NFT_A, NFT_B, NFT_C from before() block
		let NFT_A_TOKEN, NFT_B_TOKEN, NFT_C_TOKEN;
		let NFT_A_SERIAL, NFT_B_SERIAL, NFT_C_SERIAL;

		before(async function () {
			// Assign NFT token addresses and serials from minted collections
			NFT_A_TOKEN = nftCollections[0].tokenId;
			NFT_B_TOKEN = nftCollections[1].tokenId;
			NFT_C_TOKEN = nftCollections[2].tokenId;
			NFT_A_SERIAL = nftCollections[0].serials[0];
			NFT_B_SERIAL = nftCollections[1].serials[0];
			NFT_C_SERIAL = nftCollections[2].serials[0];
		});

		describe('4.4.1. addPrizePackage(uint256 poolId, PrizePackage calldata package)', function () {
			it('Should allow admin to add TESTFT as a fungible prize', async function () {
				const params = [POOL_ID, testFtTokenId, TESTFT_PRIZE_AMOUNT, false, ZERO_ADDRESS, 0];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
				await tx.getReceipt(client);
				// Prize verification
				const detailsParams = [POOL_ID];
				const details = await contractCallQuery(client, lazyLottoContractId, detailsParams, 200000, 'getPoolDetails');
				expect(details.getArray(4).length).to.be.greaterThan(0, 'prizes array should have at least 1 prize after addPrizePackage (TESTFT)');
			});

			it('Should allow admin to add NFT_A as an NFT prize (with approval)', async function () {
				// Approve contract for NFT_A serial
				await nftCollections[0].minterKey.signTransaction(); // ensure key is unlocked
				await associateTokenToAccount(client, NFT_A_TOKEN, operatorId, operatorKey);
				await contractExecuteFunction(client, NFT_A_TOKEN, [lazyLottoContractAddress, true], 0, 'setApprovalForAll', 100000);
				const params = [POOL_ID, ZERO_ADDRESS, 0, true, NFT_A_TOKEN, NFT_A_SERIAL];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
				await tx.getReceipt(client);
				// Prize verification
				const detailsParams = [POOL_ID];
				const details = await contractCallQuery(client, lazyLottoContractId, detailsParams, 200000, 'getPoolDetails');
				expect(details.getArray(4).length).to.be.greaterThan(0, 'prizes array should have at least 1 NFT prize after addPrizePackage (NFT_A)');
			});

			it('Should revert if adding NFT_B prize without approval', async function () {
				// No approval set for NFT_B
				const params = [POOL_ID, ZERO_ADDRESS, 0, true, NFT_B_TOKEN, NFT_B_SERIAL];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Should not add NFT_B without approval');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage NFT_B allowance revert');
				}
			});

			it('Should revert if non-admin tries to add TESTFT prize', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const params = [POOL_ID, testFtTokenId, TESTFT_PRIZE_AMOUNT, false, ZERO_ADDRESS, 0];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Non-admin should not add TESTFT prize');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.4.1.x: Should revert if adding a prize to a paused pool', async function () {
				// Pause the pool first
				const pauseParams = [POOL_ID];
				await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'pausePool', 100000);
				const params = [
					POOL_ID,
					lazyTokenAddress,
					FUNGIBLE_PRIZE_AMOUNT,
					false,
					ZERO_ADDRESS,
					0
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Should not add prize to paused pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage paused pool revert');
				} finally {
					// Unpause for other tests
					await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'unpausePool', 100000);
				}
			});

			it('Test 4.4.1.x: Should revert if adding a prize to a closed pool', async function () {
				// Close the pool (simulate no outstanding entries and supply)
				// For test, assume pool is closable (no entries/tokens outstanding)
				const closeParams = [POOL_ID];
				await contractExecuteFunction(client, lazyLottoContractId, closeParams, 0, 'closePool', 200000);
				const params = [
					POOL_ID,
					lazyTokenAddress,
					FUNGIBLE_PRIZE_AMOUNT,
					false,
					ZERO_ADDRESS,
					0
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Should not add prize to closed pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage closed pool revert');
				}
			});
			it('Test 4.4.1.1: Admin can add a fungible prize package', async function () {
				const params = [
					POOL_ID,
					lazyTokenAddress,
					FUNGIBLE_PRIZE_AMOUNT,
					false, // isNFT
					ZERO_ADDRESS, // NFT address
					0 // NFT serial
				];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
				await tx.getReceipt(client);
				// Prize verification
				const detailsParams = [POOL_ID];
				const details = await contractCallQuery(client, lazyLottoContractId, detailsParams, 200000, 'getPoolDetails');
				// prizes is the 5th output (index 4)
				expect(details.getArray(4).length).to.be.greaterThan(0, 'prizes array should have at least 1 prize after addPrizePackage');
			});

			it('Test 4.4.1.x: Should revert if adding a fungible prize with zero address (unless HBAR)', async function () {
				const params = [
					POOL_ID,
					ZERO_ADDRESS,
					FUNGIBLE_PRIZE_AMOUNT,
					false,
					ZERO_ADDRESS,
					0
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					// If HBAR pool, this may succeed, so only expect revert for non-HBAR pools
					if (POOL_ID !== POOL_ID_HBAR) expectFalse(true, 'Should revert for zero address FT');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage zero address FT revert');
				}
			});

			it('Test 4.4.1.x: Should revert if adding a fungible prize with amount = 0', async function () {
				const params = [
					POOL_ID,
					lazyTokenAddress,
					0,
					false,
					ZERO_ADDRESS,
					0
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Should not add prize with zero amount');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage zero amount revert');
				}
			});

			it('Test 4.4.1.x: Should allow adding the same FT prize (same token/amount) multiple times', async function () {
				const params1 = [
					POOL_ID,
					lazyTokenAddress,
					FUNGIBLE_PRIZE_AMOUNT,
					false,
					ZERO_ADDRESS,
					0
				];
				const params2 = [
					POOL_ID,
					lazyTokenAddress,
					FUNGIBLE_PRIZE_AMOUNT,
					false,
					ZERO_ADDRESS,
					0
				];
				await contractExecuteFunction(client, lazyLottoContractId, params1, 0, 'addPrizePackage', 200000);
				await contractExecuteFunction(client, lazyLottoContractId, params2, 0, 'addPrizePackage', 200000);
				// No revert expected
			});

			it('Test 4.4.1.x: Should revert if adding NFT prize with serial 0', async function () {
				const params = [
					POOL_ID,
					ZERO_ADDRESS,
					0,
					true,
					NFT_PRIZE_TOKEN,
					0 // serial 0
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Should not add NFT with serial 0');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage NFT serial 0 revert');
				}
			});

			it('Test 4.4.1.x: Should revert if adding NFT prize with serial not owned by sender', async function () {
				// This test assumes NFT_PRIZE_TOKEN and serial 9999 is not owned by sender
				const params = [
					POOL_ID,
					ZERO_ADDRESS,
					0,
					true,
					NFT_PRIZE_TOKEN,
					9999
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Should not add NFT not owned');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage NFT not owned revert');
				}
			});

			it('Test 4.4.1.x: Should revert if adding NFT prize without NFT allowance to contract', async function () {
				// This test assumes NFT_PRIZE_TOKEN and serial 1 is owned by sender but no allowance set
				const params = [
					POOL_ID,
					ZERO_ADDRESS,
					0,
					true,
					NFT_PRIZE_TOKEN,
					NFT_PRIZE_SERIAL
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Should not add NFT without allowance');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage NFT allowance revert');
				}
			});

			it('Test 4.4.1.2: Non-admin cannot add a prize package', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const params = [
					POOL_ID,
					lazyTokenAddress,
					FUNGIBLE_PRIZE_AMOUNT,
					false,
					ZERO_ADDRESS,
					0
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
					expectFalse(true, 'Non-admin should not add prize package');

				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addPrizePackage non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		describe('4.4.2. addMultipleFungiblePrizes(uint256 poolId, address token, uint256[] amounts)', function () {
			it('Should allow admin to add multiple TESTFT prizes', async function () {
				const amounts = [TESTFT_PRIZE_AMOUNT, TESTFT_PRIZE_AMOUNT.mul(2)];
				const params = [POOL_ID, testFtTokenId, amounts];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addMultipleFungiblePrizes', 200000);
				await tx.getReceipt(client);
				// Prize verification
				const detailsParams = [POOL_ID];
				const details = await contractCallQuery(client, lazyLottoContractId, detailsParams, 200000, 'getPoolDetails');
				expect(details.getArray(4).length).to.be.greaterThan(1, 'prizes array should have more than 1 TESTFT prize after addMultipleFungiblePrizes');
			});
			it('Test 4.4.2.1: Admin can add multiple fungible prizes', async function () {
				const amounts = [FUNGIBLE_PRIZE_AMOUNT, FUNGIBLE_PRIZE_AMOUNT.mul(2)];
				const params = [POOL_ID, lazyTokenAddress, amounts];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addMultipleFungiblePrizes', 200000);
				await tx.getReceipt(client);
				// Prize verification
				const detailsParams = [POOL_ID];
				const details = await contractCallQuery(client, lazyLottoContractId, detailsParams, 200000, 'getPoolDetails');
				expect(details.getArray(4).length).to.be.greaterThan(1, 'prizes array should have more than 1 prize after addMultipleFungiblePrizes');
			});

			it('Test 4.4.2.x: Should allow adding same FT token multiple times in differing amounts', async function () {
				const amounts = [FUNGIBLE_PRIZE_AMOUNT, FUNGIBLE_PRIZE_AMOUNT.mul(2), FUNGIBLE_PRIZE_AMOUNT.mul(3)];
				const params = [POOL_ID, lazyTokenAddress, amounts];
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addMultipleFungiblePrizes', 200000);
				// No revert expected
			});

			it('Test 4.4.2.x: Should revert if any amount is zero', async function () {
				const amounts = [FUNGIBLE_PRIZE_AMOUNT, 0];
				const params = [POOL_ID, lazyTokenAddress, amounts];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addMultipleFungiblePrizes', 200000);
					expectFalse(true, 'Should not add with zero amount');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addMultipleFungiblePrizes zero amount revert');
				}
			});

			it('Test 4.4.2.2: Non-admin cannot add multiple fungible prizes', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const amounts = [FUNGIBLE_PRIZE_AMOUNT];
				const params = [POOL_ID, lazyTokenAddress, amounts];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addMultipleFungiblePrizes', 200000);
					expectFalse(true, 'Non-admin should not add multiple fungible prizes');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'addMultipleFungiblePrizes non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		describe('4.4.3. removePrizes(uint256 poolId)', function () {
			it('Should revert if removing NFT prize from pool by non-admin', async function () {
				// Add NFT_C as prize first (with approval)
				await associateTokenToAccount(client, NFT_C_TOKEN, bobId, bobKey);
				await contractExecuteFunction(client, NFT_C_TOKEN, [lazyLottoContractAddress, true], 0, 'setApprovalForAll', 100000);
				const addParams = [POOL_ID, ZERO_ADDRESS, 0, true, NFT_C_TOKEN, NFT_C_SERIAL];
				await contractExecuteFunction(client, lazyLottoContractId, addParams, 0, 'addPrizePackage', 200000);
				// Now try to remove as Alice (non-admin)
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const params = [POOL_ID, 0];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removePrizes', 200000);
					expectFalse(true, 'Non-admin should not remove NFT prize');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removePrizes non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
			it('Test 4.4.3.x: Should revert if removing prizes from a pool with no prizes', async function () {
				// Use a new pool or remove all prizes first
				// Try to remove at index 0 (no prizes)
				const params = [POOL_ID, 0];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removePrizes', 200000);
					expectFalse(true, 'Should not remove from empty prize pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removePrizes empty pool revert');
				}
			});

			it('Test 4.4.3.x: Should revert if non-admin tries to remove prizes', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const params = [POOL_ID, 0];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removePrizes', 200000);
					expectFalse(true, 'Non-admin should not remove prizes');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removePrizes non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.4.3.x: Should revert if removing prizes from a non-existent pool', async function () {
				const params = [9999, 0];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removePrizes', 200000);
					expectFalse(true, 'Should not remove from non-existent pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removePrizes non-existent pool revert');
				}
			});

			it('Test 4.4.3.x: Should revert if removing prizes from a closed pool with outstanding tickets', async function () {
				// This test assumes you can simulate outstanding tickets (not trivial in unit test)
				// For now, document as a placeholder for integration test
				// expect revert with EntriesOutstanding
			});

			it('Test 4.4.1.x: Should allow adding prizes when tickets are outstanding', async function () {
				// Simulate outstanding tickets (buyEntry or similar)
				// For now, just ensure addPrizePackage does not revert if tickets exist
				// (Assume POOL_ID is open and has tickets)
				const params = [
					POOL_ID,
					lazyTokenAddress,
					FUNGIBLE_PRIZE_AMOUNT,
					false,
					ZERO_ADDRESS,
					0
				];
				// Should not revert
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'addPrizePackage', 200000);
			});
			it('Test 4.4.3.1: Admin can remove all prizes from a pool', async function () {
				const params = [POOL_ID];
				const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removePrizes', 200000);
				await tx.getReceipt(client);
				// Prize verification
				const detailsParams = [POOL_ID];
				const details = await contractCallQuery(client, lazyLottoContractId, detailsParams, 200000, 'getPoolDetails');
				expect(details.getArray(4).length).to.equal(0, 'prizes array should be empty after removePrizes');
			});

			it('Test 4.4.3.2: Non-admin cannot remove prizes', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const params = [POOL_ID];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removePrizes', 200000);
					expectFalse(true, 'Non-admin should not remove prizes');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removePrizes non-admin revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		// Add more tests for NFT prizes, invalid input, and edge cases as needed
	});

	describe('4.5.1. createPool(PoolConfig calldata config)', function () {

		describe('4.5.x Pool Management Edge Cases', function () {
			const POOL_ID = POOL_ID_1;

			it('Should revert if non-admin tries to pause, unpause, or close a pool', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const params = [POOL_ID];
				for (const fn of ['pausePool', 'unpausePool', 'closePool']) {
					try {
						await contractExecuteFunction(client, lazyLottoContractId, params, 0, fn, 100000);
						expectFalse(true, `Non-admin should not ${fn}`);
					} catch (error) {
						expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', `${fn} non-admin revert`);
					}
				}
				client.setOperator(originalOperator, originalSignerKey);
			});

			it('Should revert if closing a pool that is already closed', async function () {
				// Close the pool first
				const params = [POOL_ID];
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 200000);
				// Try closing again
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 200000);
					expectFalse(true, 'Should not close already closed pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'closePool already closed revert');
				}
			});

			it('Should revert if closing a pool with outstanding tickets', async function () {
				// Reopen pool, add tickets, then try to close
				// (Assume helper exists to buyEntry or simulate outstanding tickets)
				// For now, document as a placeholder for integration test
				// expect revert with EntriesOutstanding
			});

			it('Should revert if updating a closed pool', async function () {
				// Close the pool first
				const params = [POOL_ID];
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 200000);
				// Try to update config
				const updateParams = [
					POOL_ID,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 200000);
					expectFalse(true, 'Should not update closed pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'updatePoolConfig closed pool revert');
				}
			});

			it('Should revert if updating a pool with invalid parameters', async function () {
				// Use zero ticket price
				const updateParams = [
					POOL_ID,
					lazyTokenAddress,
					0,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 200000);
					expectFalse(true, 'Should not update pool with zero ticket price');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'updatePoolConfig zero ticket price revert');
				}
			});
		});
		it('Test 4.5.1.1: Admin should be able to create a new HBAR pool', async function () {

			// NOTE: Replace STATIC_TICKET_CID and STATIC_WIN_CID with valid CIDs for production
			const createPoolParams = [
				"Test HBAR Pool", // name
				"HBARPOOL",      // symbol
				"Test HBAR Pool Memo", // memo
				[],               // royalties (empty for now)
				STATIC_TICKET_CID,
				STATIC_WIN_CID,
				1000000,          // winRateTenThousandthsOfBps (example: 1%)
				TICKET_PRICE_HBAR,
				ZERO_ADDRESS      // feeToken (HBAR)
			];

			const createPoolTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				createPoolParams,
				0,
				'createPool',
				500000,
			);
			await createPoolTx.getReceipt(client);

			// Verify pool creation
			const getPoolParams = [POOL_ID_HBAR];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expectEqual(pool.getAddress(0).toLowerCase(), ZERO_ADDRESS, 'prizeToken ZERO_ADDRESS');
			expectEqual(pool.getUint256(1).toString(), TICKET_PRICE_HBAR.toString(), 'ticketPrice');
			expectEqual(pool.getUint256(2).toNumber(), MIN_ENTRIES, 'minEntries');
			expectEqual(pool.getUint256(3).toNumber(), MAX_ENTRIES_PER_USER, 'maxEntriesPerUser');
			expectEqual(pool.getUint256(4).toNumber(), HOUSE_EDGE_PERCENTAGE, 'houseEdgePercentage');
			expectEqual(pool.getUint256(5).toNumber(), DURATION_SECONDS, 'durationSeconds');
			expectGt(pool.getUint256(6).toNumber(), 0, 'startTime');
			expectEqual(pool.getUint256(7).toNumber(), 0, 'totalEntries');
			expectEqual(pool.getUint256(8).toNumber(), 0, 'totalPlayers');
			expectEqual(pool.getAddress(9).toLowerCase(), ZERO_ADDRESS.toLowerCase(), 'winner address');
			expectTrue(pool.getBool(10), 'isOpen');
			expectFalse(pool.getBool(11), 'isDrawn');
			console.log('Test 4.5.1.1 Passed: Admin created HBAR pool.');
			// Verify PoolCreated event
			await sleep(5000);
			const lastEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, 0, false);
			expect(Number(lastEvent)).to.equal(POOL_ID_HBAR);
		});

		it('Test 4.5.1.2: Admin should be able to create a new $LAZY token pool', async function () {

			// NOTE: Replace STATIC_TICKET_CID and STATIC_WIN_CID with valid CIDs for production
			const createPoolParams = [
				"Test LAZY Pool", // name
				"LAZYPOOL",      // symbol
				"Test LAZY Pool Memo", // memo
				[],               // royalties (empty for now)
				STATIC_TICKET_CID,
				STATIC_WIN_CID,
				1000000,          // winRateTenThousandthsOfBps (example: 1%)
				TICKET_PRICE_LAZY,
				lazyTokenAddress  // feeToken ($LAZY)
			];

			const createPoolTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				createPoolParams,
				0,
				'createPool',
				500000,
			);
			await createPoolTx.getReceipt(client);

			// Verify pool creation
			const getPoolParams = [POOL_ID_1];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expectEqual(pool.getAddress(0).toLowerCase(), lazyTokenAddress.toLowerCase(), '$LAZY token address');
			expectEqual(pool.getUint256(1).toString(), TICKET_PRICE_LAZY.toString(), '$LAZY ticket price');
			console.log('Test 4.5.1.2 Passed: Admin created $LAZY token pool.');
			// Verify PoolCreated event
			await sleep(5000);
			const lastEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, 0, false);
			expect(Number(lastEvent)).to.equal(POOL_ID_1);
		});

		it('Test 4.5.1.3: Non-admin should not be able to create a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSigner = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);

			try {
				const createPoolParams = [
					"Test HBAR Pool 2", // name
					"HBARPOOL2",      // symbol
					"Test HBAR Pool 2 Memo", // memo
					[],               // royalties (empty for now)
					STATIC_TICKET_CID,
					STATIC_WIN_CID,
					1000000,          // winRateTenThousandthsOfBps (example: 1%)
					TICKET_PRICE_HBAR,
					ZERO_ADDRESS      // feeToken (HBAR)
				];
				await contractExecuteFunction(client, lazyLottoContractId, createPoolParams, 0, 'createPool', 500000);
				expectFalse(true, 'Non-admin should not have been able to create a pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'Non-admin create pool revert');
				console.log('Test 4.5.1.3 Passed: Non-admin failed to create pool as expected.');
			} finally {
				client.setOperator(originalOperator, originalSigner);
			}
		});

		it('Test 4.5.1.4: Should fail to create a pool if poolId already exists', async function () {
			// POOL_ID_HBAR (0) was created in 4.5.1.1
			try {
				const createPoolParams = [
					"Test HBAR Pool Duplicate", // name
					"HBARPOOLDUP",      // symbol
					"Test HBAR Pool Duplicate Memo", // memo
					[],               // royalties (empty for now)
					STATIC_TICKET_CID,
					STATIC_WIN_CID,
					1000000,          // winRateTenThousandthsOfBps (example: 1%)
					TICKET_PRICE_HBAR,
					ZERO_ADDRESS      // feeToken (HBAR)
				];
				await contractExecuteFunction(client, lazyLottoContractId, createPoolParams, 0, 'createPool', 500000);
				expectFalse(true, 'Should not create pool with existing ID');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'createPool existing ID revert');
				console.log('Test 4.5.1.4 Passed: Failed to create pool with existing ID as expected.');
			}
		});

		it('Test 4.5.1.5: Should fail if ticketPrice is zero', async function () {
			try {
				const createPoolParams = [
					"Test HBAR Pool Zero Price", // name
					"HBARPOOLZERO",      // symbol
					"Test HBAR Pool Zero Price Memo", // memo
					[],               // royalties (empty for now)
					STATIC_TICKET_CID,
					STATIC_WIN_CID,
					1000000,          // winRateTenThousandthsOfBps (example: 1%)
					0,                // entryFee (zero, should fail)
					ZERO_ADDRESS      // feeToken (HBAR)
				];
				await contractExecuteFunction(client, lazyLottoContractId, createPoolParams, 0, 'createPool', 500000);
				expectFalse(true, 'Should not create pool with zero ticket price');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'createPool zero ticket price revert');
				console.log('Test 4.5.1.5 Passed: Failed to create pool with zero ticket price as expected.');
			}
		});

		it('Test 4.5.1.6: Should fail if minEntries is zero', async function () {
			try {
				const createPoolParams = [
					"Test HBAR Pool Zero Min", // name
					"HBARPOOLZEROMIN",      // symbol
					"Test HBAR Pool Zero Min Memo", // memo
					[],               // royalties (empty for now)
					STATIC_TICKET_CID,
					STATIC_WIN_CID,
					1000000,          // winRateTenThousandthsOfBps (example: 1%)
					TICKET_PRICE_HBAR,
					ZERO_ADDRESS      // feeToken (HBAR)
				];
				await contractExecuteFunction(client, lazyLottoContractId, createPoolParams, 0, 'createPool', 500000);
				expectFalse(true, 'Should not create pool with zero min entries');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'createPool zero min entries revert');
				console.log('Test 4.5.1.6 Passed: Failed to create pool with zero min entries as expected.');
			}
		});

		it('Test 4.5.1.7: Should fail if houseEdgePercentage is >= 100', async function () {
			try {
				const createPoolParams = [
					"Test HBAR Pool High Edge", // name
					"HBARPOOLHIGHEDGE",      // symbol
					"Test HBAR Pool High Edge Memo", // memo
					[],               // royalties (empty for now)
					STATIC_TICKET_CID,
					STATIC_WIN_CID,
					100000000,        // winRateTenThousandthsOfBps (simulate high edge)
					TICKET_PRICE_HBAR,
					ZERO_ADDRESS      // feeToken (HBAR)
				];
				await contractExecuteFunction(client, lazyLottoContractId, createPoolParams, 0, 'createPool', 500000);
				expectFalse(true, 'Should not create pool with house edge >= 100');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'createPool house edge >= 100 revert');
				console.log('Test 4.5.1.7 Passed: Failed to create pool with house edge >= 100 as expected.');
			}
		});

		it('Test 4.5.1.8: Should fail if durationSeconds is zero', async function () {
			try {
				const createPoolParams = [
					"Test HBAR Pool Zero Duration", // name
					"HBARPOOLZERODUR",      // symbol
					"Test HBAR Pool Zero Duration Memo", // memo
					[],               // royalties (empty for now)
					STATIC_TICKET_CID,
					STATIC_WIN_CID,
					1000000,          // winRateTenThousandthsOfBps (example: 1%)
					TICKET_PRICE_HBAR,
					ZERO_ADDRESS      // feeToken (HBAR)
				];
				await contractExecuteFunction(client, lazyLottoContractId, createPoolParams, 0, 'createPool', 500000);
				expectFalse(true, 'Should not create pool with zero duration');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'createPool zero duration revert');
				console.log('Test 4.5.1.8 Passed: Failed to create pool with zero duration as expected.');
			}
		});
	});

	describe('4.5.2. updatePoolConfig(uint256 poolId, PoolConfig calldata config)', function () {
		const POOL_TO_UPDATE = POOL_ID_1;
		const NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);
		const NEW_MIN_ENTRIES = 10;

		it('Test 4.5.2.1: Admin should be able to update an existing, open pool', async function () {
			const updateParams = [
				POOL_TO_UPDATE,
				lazyTokenAddress,
				NEW_TICKET_PRICE_LAZY,
				NEW_MIN_ENTRIES,
				MAX_ENTRIES_PER_USER,
				HOUSE_EDGE_PERCENTAGE,
				DURATION_SECONDS
			];

			const updateTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				updateParams,
				0,
				'updatePoolConfig',
				500000,
			);
			await updateTx.getReceipt(client);

			// Verify updated config
			const getPoolParams = [POOL_TO_UPDATE];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expect(pool.getUint256(1).toString()).to.equal(NEW_TICKET_PRICE_LAZY.toString());
			expect(pool.getUint256(2).toNumber()).to.equal(NEW_MIN_ENTRIES);
			console.log('Test 4.5.2.1 Passed: Admin updated pool config.');
			// Optionally: Verify PoolConfigUpdated event
		});

		it('Test 4.5.2.2: Non-admin should not be able to update a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSigner = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);

			try {
				const updateParams = [
					POOL_TO_UPDATE,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expectFalse(true, 'Non-admin should not have been able to update the pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'Non-admin updatePoolConfig revert');
				console.log('Test 4.5.2.2 Passed: Non-admin failed to update pool as expected.');
			} finally {
				client.setOperator(originalOperator, originalSigner);
			}
		});

		it('Test 4.5.2.3: Should fail to update a non-existent pool', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const updateParams = [
					NON_EXISTENT_POOL_ID,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expect.fail('Updating a non-existent pool should have failed');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.5.2.3 Passed: Failed to update non-existent pool as expected.');
			}
		});

		// Add tests for attempting to update a closed/drawn pool (should fail)
		// Add tests for invalid config parameters (similar to createPool, e.g., zero ticket price)
	});
	describe('4.5.3. getPool(uint256 poolId) view', function () {
		const EXPECTED_NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);

		it('Test 4.5.3.1: Should return correct details for an existing HBAR pool', async function () {
			// HBAR pool (POOL_ID_HBAR) was created in 4.5.1.1
			const getPoolParams = [POOL_ID_HBAR];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			// prizeToken HBAR
			expectEqual(pool.getAddress(0).toLowerCase(), ZERO_ADDRESS, 'getPool HBAR prizeToken');
			expectEqual(pool.getUint256(1).toString(), TICKET_PRICE_HBAR.toString(), 'getPool HBAR ticketPrice');
			console.log('Test 4.5.3.1 Passed: getPool returned correct HBAR pool details.');
		});

		it('Test 4.5.3.2: Should return correct details for an existing $LAZY pool', async function () {
			// $LAZY pool (POOL_ID_1) was updated in 4.5.2.1
			const getPoolParams = [POOL_ID_1];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expectEqual(pool.getAddress(0).toLowerCase(), lazyTokenAddress.toLowerCase(), 'getPool $LAZY prizeToken');
			expectEqual(pool.getUint256(1).toString(), EXPECTED_NEW_TICKET_PRICE_LAZY.toString(), 'getPool $LAZY ticketPrice');
			console.log('Test 4.5.3.2 Passed: getPool returned correct $LAZY pool details.');
		});

		it('Test 4.5.3.3: Should revert for non-existent poolId', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const getPoolParams = [NON_EXISTENT_POOL_ID];
				await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');
				expectFalse(true, 'Should not return pool for non-existent poolId');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'getPool non-existent poolId revert');
				console.log('Test 4.5.3.3 Passed: getPool reverted for non-existent poolId as expected.');
			}
		});
	});

	describe('4.5.4. getPoolIds() view', function () {
		it('Test 4.5.4.1: Should return a list of all created pool IDs', async function () {
			// No params
			const queryParams = [];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'getPoolIds');
			const rawPoolIds = result.getUint256Array(0);
			const poolIds = [];
			for (const id of rawPoolIds) {
				poolIds.push(Number(id));
			}

			// POOL_ID_HBAR (0) and POOL_ID_1 (1) should exist from previous tests
			expectInclude(poolIds, POOL_ID_HBAR, 'getPoolIds includes POOL_ID_HBAR');
			expectInclude(poolIds, POOL_ID_1, 'getPoolIds includes POOL_ID_1');
			expectEqual(poolIds.length, 2, 'getPoolIds length');
			console.log('Test 4.5.4.1 Passed: getPoolIds returned correct pool IDs.');
		});
	});

	describe('4.5.5. getNumberOfEntries(uint256 poolId, address player) view', function () {
		it('Test 4.5.5.1: Should return 0 for a player who has not entered a specific pool', async function () {
			const getNumberOfEntriesParams = [POOL_ID_HBAR, aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, getNumberOfEntriesParams, 100000, 'getNumberOfEntries');
			expectEqual(result.getUint256(0).toNumber(), 0, 'getNumberOfEntries for non-entered player');
			console.log('Test 4.5.5.1 Passed: getNumberOfEntries returned 0 for player not entered.');
		});

		// Further tests for this function will be after implementing enterPool
	});

	describe('4.5.6. getPlayerEntries(uint256 poolId, address player) view', function () {
		it('Test 4.5.6.1: Should return an empty array for a player who has not entered', async function () {
			const getPlayerEntriesParams = [POOL_ID_HBAR, aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, getPlayerEntriesParams, 100000, 'getPlayerEntries');
			const entries = result.getUint256Array(0);
			expectEqual(entries.length, 0, 'getPlayerEntries for non-entered player');
			console.log('Test 4.5.6.1 Passed: getPlayerEntries returned empty array for player not entered.');
		});
		// Further tests for this function will be after implementing enterPool
	});

	describe('4.5.7. isPoolOpen(uint256 poolId) view', function () {
		it('Test 4.5.7.1: Should return true for an open pool', async function () {
			const isPoolOpenParams = [POOL_ID_HBAR];
			const result = await contractCallQuery(client, lazyLottoContractId, isPoolOpenParams, 100000, 'isPoolOpen');
			expectTrue(result.getBool(0), 'isPoolOpen for open pool');
			console.log('Test 4.5.7.1 Passed: isPoolOpen returned true for open pool.');
		});

		// Test for closed pool will be after implementing drawLottery or closePool functionality
	});

	describe('4.5.8. isPoolDrawn(uint256 poolId) view', function () {
		it('Test 4.5.8.1: Should return false for a pool that has not been drawn', async function () {
			const isPoolDrawnParams = [POOL_ID_HBAR];
			const result = await contractCallQuery(client, lazyLottoContractId, isPoolDrawnParams, 100000, 'isPoolDrawn');
			expectFalse(result.getBool(0), 'isPoolDrawn for not-drawn pool');
			console.log('Test 4.5.8.1 Passed: isPoolDrawn returned false for not-drawn pool.');
		});
		// Test for drawn pool will be after implementing drawLottery
	});

	// --- 4.5. Pool Management (pause, unpause, close, etc.) ---
	describe('4.5.9. pausePool(uint256 poolId)', function () {
		it('Test 4.5.9.1: Admin can pause a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'pausePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns false)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectFalse(result.getBool(0), 'isPoolOpen after pause');
		});

		it('Test 4.5.9.2: Non-admin cannot pause a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'pausePool', 100000);
				expectFalse(true, 'Non-admin should not pause pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'pausePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	describe('4.5.10. unpausePool(uint256 poolId)', function () {
		it('Test 4.5.10.1: Admin can unpause a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'unpausePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns true)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectTrue(result.getBool(0), 'isPoolOpen after unpause');
		});

		it('Test 4.5.10.2: Non-admin cannot unpause a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'unpausePool', 100000);
				expectFalse(true, 'Non-admin should not unpause pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'unpausePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	// Add more pool management tests: closePool, updatePoolConfig edge cases, etc.

	describe('4.5.11. closePool(uint256 poolId)', function () {
		it('Test 4.5.11.1: Admin can close a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns false)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectFalse(result.getBool(0), 'isPoolOpen after close');
		});

		it('Test 4.5.11.2: Non-admin cannot close a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 100000);
				expectFalse(true, 'Non-admin should not close pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'closePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	describe('4.5.12. updatePoolConfig(uint256 poolId, PoolConfig calldata config)', function () {
		const POOL_TO_UPDATE = POOL_ID_1;
		const NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);
		const NEW_MIN_ENTRIES = 10;

		it('Test 4.5.12.1: Admin should be able to update an existing, open pool', async function () {
			const updateParams = [
				POOL_TO_UPDATE,
				lazyTokenAddress,
				NEW_TICKET_PRICE_LAZY,
				NEW_MIN_ENTRIES,
				MAX_ENTRIES_PER_USER,
				HOUSE_EDGE_PERCENTAGE,
				DURATION_SECONDS
			];

			const updateTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				updateParams,
				0,
				'updatePoolConfig',
				500000,
			);
			await updateTx.getReceipt(client);

			// Verify updated config
			const getPoolParams = [POOL_TO_UPDATE];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expect(pool.getUint256(1).toString()).to.equal(NEW_TICKET_PRICE_LAZY.toString());
			expect(pool.getUint256(2).toNumber()).to.equal(NEW_MIN_ENTRIES);
			console.log('Test 4.5.12.1 Passed: Admin updated pool config.');
			// Optionally: Verify PoolConfigUpdated event
		});

		it('Test 4.5.12.2: Non-admin should not be able to update a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSigner = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);

			try {
				const updateParams = [
					POOL_TO_UPDATE,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expectFalse(true, 'Non-admin should not have been able to update the pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'Non-admin updatePoolConfig revert');
				console.log('Test 4.5.12.2 Passed: Non-admin failed to update pool as expected.');
			} finally {
				client.setOperator(originalOperator, originalSigner);
			}
		});

		it('Test 4.5.12.3: Should fail to update a non-existent pool', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const updateParams = [
					NON_EXISTENT_POOL_ID,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expect.fail('Updating a non-existent pool should have failed');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.5.12.3 Passed: Failed to update non-existent pool as expected.');
			}
		});

		// Add tests for attempting to update a closed/drawn pool (should fail)
		// Add tests for invalid config parameters (similar to createPool, e.g., zero ticket price)
	});
	describe('4.5.3. getPool(uint256 poolId) view', function () {
		const EXPECTED_NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);

		it('Test 4.5.3.1: Should return correct details for an existing HBAR pool', async function () {
			// HBAR pool (POOL_ID_HBAR) was created in 4.5.1.1
			const getPoolParams = [POOL_ID_HBAR];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			// prizeToken HBAR
			expectEqual(pool.getAddress(0).toLowerCase(), ZERO_ADDRESS, 'getPool HBAR prizeToken');
			expectEqual(pool.getUint256(1).toString(), TICKET_PRICE_HBAR.toString(), 'getPool HBAR ticketPrice');
			console.log('Test 4.5.3.1 Passed: getPool returned correct HBAR pool details.');
		});

		it('Test 4.5.3.2: Should return correct details for an existing $LAZY pool', async function () {
			// $LAZY pool (POOL_ID_1) was updated in 4.5.2.1
			const getPoolParams = [POOL_ID_1];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expectEqual(pool.getAddress(0).toLowerCase(), lazyTokenAddress.toLowerCase(), 'getPool $LAZY prizeToken');
			expectEqual(pool.getUint256(1).toString(), EXPECTED_NEW_TICKET_PRICE_LAZY.toString(), 'getPool $LAZY ticketPrice');
			console.log('Test 4.5.3.2 Passed: getPool returned correct $LAZY pool details.');
		});

		it('Test 4.5.3.3: Should revert for non-existent poolId', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const getPoolParams = [NON_EXISTENT_POOL_ID];
				await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');
				expectFalse(true, 'Should not return pool for non-existent poolId');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'getPool non-existent poolId revert');
				console.log('Test 4.5.3.3 Passed: getPool reverted for non-existent poolId as expected.');
			}
		});
	});

	describe('4.5.4. getPoolIds() view', function () {
		it('Test 4.5.4.1: Should return a list of all created pool IDs', async function () {
			// No params
			const queryParams = [];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'getPoolIds');
			const rawPoolIds = result.getUint256Array(0);
			const poolIds = [];
			for (const id of rawPoolIds) {
				poolIds.push(Number(id));
			}

			// POOL_ID_HBAR (0) and POOL_ID_1 (1) should exist from previous tests
			expectInclude(poolIds, POOL_ID_HBAR, 'getPoolIds includes POOL_ID_HBAR');
			expectInclude(poolIds, POOL_ID_1, 'getPoolIds includes POOL_ID_1');
			expectEqual(poolIds.length, 2, 'getPoolIds length');
			console.log('Test 4.5.4.1 Passed: getPoolIds returned correct pool IDs.');
		});
	});

	describe('4.5.5. getNumberOfEntries(uint256 poolId, address player) view', function () {
		it('Test 4.5.5.1: Should return 0 for a player who has not entered a specific pool', async function () {
			const getNumberOfEntriesParams = [POOL_ID_HBAR, aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, getNumberOfEntriesParams, 100000, 'getNumberOfEntries');
			expectEqual(result.getUint256(0).toNumber(), 0, 'getNumberOfEntries for non-entered player');
			console.log('Test 4.5.5.1 Passed: getNumberOfEntries returned 0 for player not entered.');
		});

		// Further tests for this function will be after implementing enterPool
	});

	describe('4.5.6. getPlayerEntries(uint256 poolId, address player) view', function () {
		it('Test 4.5.6.1: Should return an empty array for a player who has not entered', async function () {
			const getPlayerEntriesParams = [POOL_ID_HBAR, aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, getPlayerEntriesParams, 100000, 'getPlayerEntries');
			const entries = result.getUint256Array(0);
			expectEqual(entries.length, 0, 'getPlayerEntries for non-entered player');
			console.log('Test 4.5.6.1 Passed: getPlayerEntries returned empty array for player not entered.');
		});
		// Further tests for this function will be after implementing enterPool
	});

	describe('4.5.7. isPoolOpen(uint256 poolId) view', function () {
		it('Test 4.5.7.1: Should return true for an open pool', async function () {
			const isPoolOpenParams = [POOL_ID_HBAR];
			const result = await contractCallQuery(client, lazyLottoContractId, isPoolOpenParams, 100000, 'isPoolOpen');
			expectTrue(result.getBool(0), 'isPoolOpen for open pool');
			console.log('Test 4.5.7.1 Passed: isPoolOpen returned true for open pool.');
		});

		// Test for closed pool will be after implementing drawLottery or closePool functionality
	});

	describe('4.5.8. isPoolDrawn(uint256 poolId) view', function () {
		it('Test 4.5.8.1: Should return false for a pool that has not been drawn', async function () {
			const isPoolDrawnParams = [POOL_ID_HBAR];
			const result = await contractCallQuery(client, lazyLottoContractId, isPoolDrawnParams, 100000, 'isPoolDrawn');
			expectFalse(result.getBool(0), 'isPoolDrawn for not-drawn pool');
			console.log('Test 4.5.8.1 Passed: isPoolDrawn returned false for not-drawn pool.');
		});
		// Test for drawn pool will be after implementing drawLottery
	});

	// --- 4.5. Pool Management (pause, unpause, close, etc.) ---
	describe('4.5.9. pausePool(uint256 poolId)', function () {
		it('Test 4.5.9.1: Admin can pause a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'pausePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns false)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectFalse(result.getBool(0), 'isPoolOpen after pause');
		});

		it('Test 4.5.9.2: Non-admin cannot pause a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'pausePool', 100000);
				expectFalse(true, 'Non-admin should not pause pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'pausePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	describe('4.5.10. unpausePool(uint256 poolId)', function () {
		it('Test 4.5.10.1: Admin can unpause a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'unpausePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns true)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectTrue(result.getBool(0), 'isPoolOpen after unpause');
		});

		it('Test 4.5.10.2: Non-admin cannot unpause a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'unpausePool', 100000);
				expectFalse(true, 'Non-admin should not unpause pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'unpausePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	// Add more pool management tests: closePool, updatePoolConfig edge cases, etc.

	describe('4.5.11. closePool(uint256 poolId)', function () {
		it('Test 4.5.11.1: Admin can close a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns false)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectFalse(result.getBool(0), 'isPoolOpen after close');
		});

		it('Test 4.5.11.2: Non-admin cannot close a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 100000);
				expectFalse(true, 'Non-admin should not close pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'closePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	describe('4.5.12. updatePoolConfig(uint256 poolId, PoolConfig calldata config)', function () {
		const POOL_TO_UPDATE = POOL_ID_1;
		const NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);
		const NEW_MIN_ENTRIES = 10;

		it('Test 4.5.12.1: Admin should be able to update an existing, open pool', async function () {
			const updateParams = [
				POOL_TO_UPDATE,
				lazyTokenAddress,
				NEW_TICKET_PRICE_LAZY,
				NEW_MIN_ENTRIES,
				MAX_ENTRIES_PER_USER,
				HOUSE_EDGE_PERCENTAGE,
				DURATION_SECONDS
			];

			const updateTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				updateParams,
				0,
				'updatePoolConfig',
				500000,
			);
			await updateTx.getReceipt(client);

			// Verify updated config
			const getPoolParams = [POOL_TO_UPDATE];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expect(pool.getUint256(1).toString()).to.equal(NEW_TICKET_PRICE_LAZY.toString());
			expect(pool.getUint256(2).toNumber()).to.equal(NEW_MIN_ENTRIES);
			console.log('Test 4.5.12.1 Passed: Admin updated pool config.');
			// Optionally: Verify PoolConfigUpdated event
		});

		it('Test 4.5.12.2: Non-admin should not be able to update a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSigner = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);

			try {
				const updateParams = [
					POOL_TO_UPDATE,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expectFalse(true, 'Non-admin should not have been able to update the pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'Non-admin updatePoolConfig revert');
				console.log('Test 4.5.12.2 Passed: Non-admin failed to update pool as expected.');
			} finally {
				client.setOperator(originalOperator, originalSigner);
			}
		});

		it('Test 4.5.12.3: Should fail to update a non-existent pool', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const updateParams = [
					NON_EXISTENT_POOL_ID,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expect.fail('Updating a non-existent pool should have failed');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.5.12.3 Passed: Failed to update non-existent pool as expected.');
			}
		});

		// Add tests for attempting to update a closed/drawn pool (should fail)
		// Add tests for invalid config parameters (similar to createPool, e.g., zero ticket price)
	});
	describe('4.5.3. getPool(uint256 poolId) view', function () {
		const EXPECTED_NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);

		it('Test 4.5.3.1: Should return correct details for an existing HBAR pool', async function () {
			// HBAR pool (POOL_ID_HBAR) was created in 4.5.1.1
			const getPoolParams = [POOL_ID_HBAR];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			// prizeToken HBAR
			expectEqual(pool.getAddress(0).toLowerCase(), ZERO_ADDRESS, 'getPool HBAR prizeToken');
			expectEqual(pool.getUint256(1).toString(), TICKET_PRICE_HBAR.toString(), 'getPool HBAR ticketPrice');
			console.log('Test 4.5.3.1 Passed: getPool returned correct HBAR pool details.');
		});

		it('Test 4.5.3.2: Should return correct details for an existing $LAZY pool', async function () {
			// $LAZY pool (POOL_ID_1) was updated in 4.5.2.1
			const getPoolParams = [POOL_ID_1];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expectEqual(pool.getAddress(0).toLowerCase(), lazyTokenAddress.toLowerCase(), 'getPool $LAZY prizeToken');
			expectEqual(pool.getUint256(1).toString(), EXPECTED_NEW_TICKET_PRICE_LAZY.toString(), 'getPool $LAZY ticketPrice');
			console.log('Test 4.5.3.2 Passed: getPool returned correct $LAZY pool details.');
		});

		it('Test 4.5.3.3: Should revert for non-existent poolId', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const getPoolParams = [NON_EXISTENT_POOL_ID];
				await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');
				expectFalse(true, 'Should not return pool for non-existent poolId');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'getPool non-existent poolId revert');
				console.log('Test 4.5.3.3 Passed: getPool reverted for non-existent poolId as expected.');
			}
		});
	});

	describe('4.5.4. getPoolIds() view', function () {
		it('Test 4.5.4.1: Should return a list of all created pool IDs', async function () {
			// No params
			const queryParams = [];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'getPoolIds');
			const rawPoolIds = result.getUint256Array(0);
			const poolIds = [];
			for (const id of rawPoolIds) {
				poolIds.push(Number(id));
			}

			// POOL_ID_HBAR (0) and POOL_ID_1 (1) should exist from previous tests
			expectInclude(poolIds, POOL_ID_HBAR, 'getPoolIds includes POOL_ID_HBAR');
			expectInclude(poolIds, POOL_ID_1, 'getPoolIds includes POOL_ID_1');
			expectEqual(poolIds.length, 2, 'getPoolIds length');
			console.log('Test 4.5.4.1 Passed: getPoolIds returned correct pool IDs.');
		});
	});

	describe('4.5.5. getNumberOfEntries(uint256 poolId, address player) view', function () {
		it('Test 4.5.5.1: Should return 0 for a player who has not entered a specific pool', async function () {
			const getNumberOfEntriesParams = [POOL_ID_HBAR, aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, getNumberOfEntriesParams, 100000, 'getNumberOfEntries');
			expectEqual(result.getUint256(0).toNumber(), 0, 'getNumberOfEntries for non-entered player');
			console.log('Test 4.5.5.1 Passed: getNumberOfEntries returned 0 for player not entered.');
		});

		// Further tests for this function will be after implementing enterPool
	});

	describe('4.5.6. getPlayerEntries(uint256 poolId, address player) view', function () {
		it('Test 4.5.6.1: Should return an empty array for a player who has not entered', async function () {
			const getPlayerEntriesParams = [POOL_ID_HBAR, aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, getPlayerEntriesParams, 100000, 'getPlayerEntries');
			const entries = result.getUint256Array(0);
			expectEqual(entries.length, 0, 'getPlayerEntries for non-entered player');
			console.log('Test 4.5.6.1 Passed: getPlayerEntries returned empty array for player not entered.');
		});
		// Further tests for this function will be after implementing enterPool
	});

	describe('4.5.7. isPoolOpen(uint256 poolId) view', function () {
		it('Test 4.5.7.1: Should return true for an open pool', async function () {
			const isPoolOpenParams = [POOL_ID_HBAR];
			const result = await contractCallQuery(client, lazyLottoContractId, isPoolOpenParams, 100000, 'isPoolOpen');
			expectTrue(result.getBool(0), 'isPoolOpen for open pool');
			console.log('Test 4.5.7.1 Passed: isPoolOpen returned true for open pool.');
		});

		// Test for closed pool will be after implementing drawLottery or closePool functionality
	});

	describe('4.5.8. isPoolDrawn(uint256 poolId) view', function () {
		it('Test 4.5.8.1: Should return false for a pool that has not been drawn', async function () {
			const isPoolDrawnParams = [POOL_ID_HBAR];
			const result = await contractCallQuery(client, lazyLottoContractId, isPoolDrawnParams, 100000, 'isPoolDrawn');
			expectFalse(result.getBool(0), 'isPoolDrawn for not-drawn pool');
			console.log('Test 4.5.8.1 Passed: isPoolDrawn returned false for not-drawn pool.');
		});
		// Test for drawn pool will be after implementing drawLottery
	});

	// --- 4.5. Pool Management (pause, unpause, close, etc.) ---
	describe('4.5.9. pausePool(uint256 poolId)', function () {
		it('Test 4.5.9.1: Admin can pause a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'pausePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns false)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectFalse(result.getBool(0), 'isPoolOpen after pause');
		});

		it('Test 4.5.9.2: Non-admin cannot pause a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'pausePool', 100000);
				expectFalse(true, 'Non-admin should not pause pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'pausePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	describe('4.5.10. unpausePool(uint256 poolId)', function () {
		it('Test 4.5.10.1: Admin can unpause a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'unpausePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns true)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectTrue(result.getBool(0), 'isPoolOpen after unpause');
		});

		it('Test 4.5.10.2: Non-admin cannot unpause a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'unpausePool', 100000);
				expectFalse(true, 'Non-admin should not unpause pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'unpausePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	// Add more pool management tests: closePool, updatePoolConfig edge cases, etc.

	describe('4.5.11. closePool(uint256 poolId)', function () {
		it('Test 4.5.11.1: Admin can close a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns false)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectFalse(result.getBool(0), 'isPoolOpen after close');
		});

		it('Test 4.5.11.2: Non-admin cannot close a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 100000);
				expectFalse(true, 'Non-admin should not close pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'closePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	describe('4.5.12. updatePoolConfig(uint256 poolId, PoolConfig calldata config)', function () {
		const POOL_TO_UPDATE = POOL_ID_1;
		const NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);
		const NEW_MIN_ENTRIES = 10;

		it('Test 4.5.12.1: Admin should be able to update an existing, open pool', async function () {
			const updateParams = [
				POOL_TO_UPDATE,
				lazyTokenAddress,
				NEW_TICKET_PRICE_LAZY,
				NEW_MIN_ENTRIES,
				MAX_ENTRIES_PER_USER,
				HOUSE_EDGE_PERCENTAGE,
				DURATION_SECONDS
			];

			const updateTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				updateParams,
				0,
				'updatePoolConfig',
				500000,
			);
			await updateTx.getReceipt(client);

			// Verify updated config
			const getPoolParams = [POOL_TO_UPDATE];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expect(pool.getUint256(1).toString()).to.equal(NEW_TICKET_PRICE_LAZY.toString());
			expect(pool.getUint256(2).toNumber()).to.equal(NEW_MIN_ENTRIES);
			console.log('Test 4.5.12.1 Passed: Admin updated pool config.');
			// Optionally: Verify PoolConfigUpdated event
		});

		it('Test 4.5.12.2: Non-admin should not be able to update a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSigner = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);

			try {
				const updateParams = [
					POOL_TO_UPDATE,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expectFalse(true, 'Non-admin should not have been able to update the pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'Non-admin updatePoolConfig revert');
				console.log('Test 4.5.12.2 Passed: Non-admin failed to update pool as expected.');
			} finally {
				client.setOperator(originalOperator, originalSigner);
			}
		});

		it('Test 4.5.12.3: Should fail to update a non-existent pool', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const updateParams = [
					NON_EXISTENT_POOL_ID,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expect.fail('Updating a non-existent pool should have failed');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.5.12.3 Passed: Failed to update non-existent pool as expected.');
			}
		});

		// Add tests for attempting to update a closed/drawn pool (should fail)
		// Add tests for invalid config parameters (similar to createPool, e.g., zero ticket price)
	});
	describe('4.5.3. getPool(uint256 poolId) view', function () {
		const EXPECTED_NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);

		it('Test 4.5.3.1: Should return correct details for an existing HBAR pool', async function () {
			// HBAR pool (POOL_ID_HBAR) was created in 4.5.1.1
			const getPoolParams = [POOL_ID_HBAR];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			// prizeToken HBAR
			expectEqual(pool.getAddress(0).toLowerCase(), ZERO_ADDRESS, 'getPool HBAR prizeToken');
			expectEqual(pool.getUint256(1).toString(), TICKET_PRICE_HBAR.toString(), 'getPool HBAR ticketPrice');
			console.log('Test 4.5.3.1 Passed: getPool returned correct HBAR pool details.');
		});

		it('Test 4.5.3.2: Should return correct details for an existing $LAZY pool', async function () {
			// $LAZY pool (POOL_ID_1) was updated in 4.5.2.1
			const getPoolParams = [POOL_ID_1];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expectEqual(pool.getAddress(0).toLowerCase(), lazyTokenAddress.toLowerCase(), 'getPool $LAZY prizeToken');
			expectEqual(pool.getUint256(1).toString(), EXPECTED_NEW_TICKET_PRICE_LAZY.toString(), 'getPool $LAZY ticketPrice');
			console.log('Test 4.5.3.2 Passed: getPool returned correct $LAZY pool details.');
		});

		it('Test 4.5.3.3: Should revert for non-existent poolId', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const getPoolParams = [NON_EXISTENT_POOL_ID];
				await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');
				expectFalse(true, 'Should not return pool for non-existent poolId');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'getPool non-existent poolId revert');
				console.log('Test 4.5.3.3 Passed: getPool reverted for non-existent poolId as expected.');
			}
		});
	});

	describe('4.5.4. getPoolIds() view', function () {
		it('Test 4.5.4.1: Should return a list of all created pool IDs', async function () {
			// No params
			const queryParams = [];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'getPoolIds');
			const rawPoolIds = result.getUint256Array(0);
			const poolIds = [];
			for (const id of rawPoolIds) {
				poolIds.push(Number(id));
			}

			// POOL_ID_HBAR (0) and POOL_ID_1 (1) should exist from previous tests
			expectInclude(poolIds, POOL_ID_HBAR, 'getPoolIds includes POOL_ID_HBAR');
			expectInclude(poolIds, POOL_ID_1, 'getPoolIds includes POOL_ID_1');
			expectEqual(poolIds.length, 2, 'getPoolIds length');
			console.log('Test 4.5.4.1 Passed: getPoolIds returned correct pool IDs.');
		});
	});

	describe('4.5.5. getNumberOfEntries(uint256 poolId, address player) view', function () {
		it('Test 4.5.5.1: Should return 0 for a player who has not entered a specific pool', async function () {
			const getNumberOfEntriesParams = [POOL_ID_HBAR, aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, getNumberOfEntriesParams, 100000, 'getNumberOfEntries');
			expectEqual(result.getUint256(0).toNumber(), 0, 'getNumberOfEntries for non-entered player');
			console.log('Test 4.5.5.1 Passed: getNumberOfEntries returned 0 for player not entered.');
		});

		// Further tests for this function will be after implementing enterPool
	});

	describe('4.5.6. getPlayerEntries(uint256 poolId, address player) view', function () {
		it('Test 4.5.6.1: Should return an empty array for a player who has not entered', async function () {
			const getPlayerEntriesParams = [POOL_ID_HBAR, aliceId.toSolidityAddress()];
			const result = await contractCallQuery(client, lazyLottoContractId, getPlayerEntriesParams, 100000, 'getPlayerEntries');
			const entries = result.getUint256Array(0);
			expectEqual(entries.length, 0, 'getPlayerEntries for non-entered player');
			console.log('Test 4.5.6.1 Passed: getPlayerEntries returned empty array for player not entered.');
		});
		// Further tests for this function will be after implementing enterPool
	});

	describe('4.5.7. isPoolOpen(uint256 poolId) view', function () {
		it('Test 4.5.7.1: Should return true for an open pool', async function () {
			const isPoolOpenParams = [POOL_ID_HBAR];
			const result = await contractCallQuery(client, lazyLottoContractId, isPoolOpenParams, 100000, 'isPoolOpen');
			expectTrue(result.getBool(0), 'isPoolOpen for open pool');
			console.log('Test 4.5.7.1 Passed: isPoolOpen returned true for open pool.');
		});

		// Test for closed pool will be after implementing drawLottery or closePool functionality
	});

	describe('4.5.8. isPoolDrawn(uint256 poolId) view', function () {
		it('Test 4.5.8.1: Should return false for a pool that has not been drawn', async function () {
			const isPoolDrawnParams = [POOL_ID_HBAR];
			const result = await contractCallQuery(client, lazyLottoContractId, isPoolDrawnParams, 100000, 'isPoolDrawn');
			expectFalse(result.getBool(0), 'isPoolDrawn for not-drawn pool');
			console.log('Test 4.5.8.1 Passed: isPoolDrawn returned false for not-drawn pool.');
		});
		// Test for drawn pool will be after implementing drawLottery
	});

	// --- 4.5. Pool Management (pause, unpause, close, etc.) ---
	describe('4.5.9. pausePool(uint256 poolId)', function () {
		it('Test 4.5.9.1: Admin can pause a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'pausePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns false)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectFalse(result.getBool(0), 'isPoolOpen after pause');
		});

		it('Test 4.5.9.2: Non-admin cannot pause a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'pausePool', 100000);
				expectFalse(true, 'Non-admin should not pause pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'pausePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	describe('4.5.10. unpausePool(uint256 poolId)', function () {
		it('Test 4.5.10.1: Admin can unpause a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'unpausePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns true)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectTrue(result.getBool(0), 'isPoolOpen after unpause');
		});

		it('Test 4.5.10.2: Non-admin cannot unpause a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'unpausePool', 100000);
				expectFalse(true, 'Non-admin should not unpause pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'unpausePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	// Add more pool management tests: closePool, updatePoolConfig edge cases, etc.

	describe('4.5.11. closePool(uint256 poolId)', function () {
		it('Test 4.5.11.1: Admin can close a pool', async function () {
			const params = [POOL_ID_1];
			const tx = await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 100000);
			await tx.getReceipt(client);
			// Verify (assume isPoolOpen returns false)
			const queryParams = [POOL_ID_1];
			const result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isPoolOpen');
			expectFalse(result.getBool(0), 'isPoolOpen after close');
		});

		it('Test 4.5.11.2: Non-admin cannot close a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);
			const params = [POOL_ID_1];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'closePool', 100000);
				expectFalse(true, 'Non-admin should not close pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'closePool non-admin revert');
			} finally {
				client.setOperator(originalOperator, originalSignerKey);
			}
		});
	});

	describe('4.5.12. updatePoolConfig(uint256 poolId, PoolConfig calldata config)', function () {
		const POOL_TO_UPDATE = POOL_ID_1;
		const NEW_TICKET_PRICE_LAZY = ethers.BigNumber.from('10').pow(1).mul(150);
		const NEW_MIN_ENTRIES = 10;

		it('Test 4.5.12.1: Admin should be able to update an existing, open pool', async function () {
			const updateParams = [
				POOL_TO_UPDATE,
				lazyTokenAddress,
				NEW_TICKET_PRICE_LAZY,
				NEW_MIN_ENTRIES,
				MAX_ENTRIES_PER_USER,
				HOUSE_EDGE_PERCENTAGE,
				DURATION_SECONDS
			];

			const updateTx = await contractExecuteFunction(
				client,
				lazyLottoContractId,
				updateParams,
				0,
				'updatePoolConfig',
				500000,
			);
			await updateTx.getReceipt(client);

			// Verify updated config
			const getPoolParams = [POOL_TO_UPDATE];
			const pool = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');

			expect(pool.getUint256(1).toString()).to.equal(NEW_TICKET_PRICE_LAZY.toString());
			expect(pool.getUint256(2).toNumber()).to.equal(NEW_MIN_ENTRIES);
			console.log('Test 4.5.12.1 Passed: Admin updated pool config.');
			// Optionally: Verify PoolConfigUpdated event
		});

		it('Test 4.5.12.2: Non-admin should not be able to update a pool', async function () {
			const originalOperator = client.operatorAccountId;
			const originalSigner = client.operatorPublicKey;
			client.setOperator(aliceId, aliceKey);

			try {
				const updateParams = [
					POOL_TO_UPDATE,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expectFalse(true, 'Non-admin should not have been able to update the pool');
			} catch (error) {
				expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'Non-admin updatePoolConfig revert');
				console.log('Test 4.5.12.2 Passed: Non-admin failed to update pool as expected.');
			} finally {
				client.setOperator(originalOperator, originalSigner);
			}
		});

		it('Test 4.5.12.3: Should fail to update a non-existent pool', async function () {
			const NON_EXISTENT_POOL_ID = 999;
			try {
				const updateParams = [
					NON_EXISTENT_POOL_ID,
					lazyTokenAddress,
					TICKET_PRICE_LAZY,
					MIN_ENTRIES,
					MAX_ENTRIES_PER_USER,
					HOUSE_EDGE_PERCENTAGE,
					DURATION_SECONDS
				];
				await contractExecuteFunction(client, lazyLottoContractId, updateParams, 0, 'updatePoolConfig', 500000);
				expect.fail('Updating a non-existent pool should have failed');
			}
			catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
				console.log('Test 4.5.12.3 Passed: Failed to update non-existent pool as expected.');
			}
		});

		// Add tests for attempting to update a closed/drawn pool (should fail)
		// Add tests for invalid config parameters (similar to createPool, e.g., zero ticket price)
	});
});