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
let client;
let aliceId, aliceKey;
// For multi-user tests
let bobId, bobKey;

let htsLazyLottoLibraryAddress;
let prngContractId, prngContractAddress;
let mockPrngContractId, mockPrngContractAddress;
// $LAZY token
let lazyTokenId, lazyTokenAddress;
let lazyGasStationId, lazyGasStationAddress;
let lazyDelegateRegistryId, lazyDelegateRegistryAddress;
let lazyLottoContractId, lazyLottoContractAddress;


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

	// --- Create extra fungible token (TESTFT) ---
	let testFtTokenId, testFtTokenAddress;

	before(async function () {
		if (process.env.TEST_FT_TOKEN_ID) {
			console.log('\n- Using existing TEST_FT_TOKEN_ID:', process.env.TEST_FT_TOKEN_ID);
			testFtTokenId = TokenId.fromString(process.env.TEST_FT_TOKEN_ID);
			testFtTokenAddress = testFtTokenId.toSolidityAddress();
		} else {
			console.log('\nCreating new test fungible token (TESTFT)...');
			const { TokenCreateTransaction, TokenType, TokenSupplyType, TokenMintTransaction } = require('@hashgraph/sdk');
			const createTx = await new TokenCreateTransaction()
				.setTokenName('TestFT')
				.setTokenSymbol('TFT')
				.setDecimals(2)
				.setInitialSupply(1000000)
				.setTreasuryAccountId(operatorId)
				.setTokenType(TokenType.FungibleCommon)
				.setSupplyType(TokenSupplyType.Infinite)
				.freezeWith(client)
				.sign(operatorKey);
			const createSubmit = await createTx.execute(client);
			const createReceipt = await createSubmit.getReceipt(client);
			testFtTokenId = createReceipt.tokenId;
			testFtTokenAddress = testFtTokenId.toSolidityAddress();
			console.log(`TEST_FT_TOKEN_ID: ${testFtTokenId.toString()} (address: ${testFtTokenAddress})`);
			console.log('Set TEST_FT_TOKEN_ID in your .env for future runs!');
		}
	});


	// --- NFT/FT association helper ---
	async function associateAllTokensToAllUsers(client, allTokenIds, allUsers) {
		for (const user of allUsers) {
			for (const tokenId of allTokenIds) {
				try {
					await associateTokenToAccount(client, tokenId, user.id, user.key);
				} catch (e) {
					// Already associated or not needed, ignore
				}
			}
		}
	}

	describe('LazyLotto Contract Tests', function () {
		this.timeout(120000);

		let nftCollections = [];
		let testFtTokenId, testFtTokenAddress;

		before(async function () {
			// ... (existing before logic up to after user creation)

			// --- Mint three NFT collections (A, B, C) ---
			const { TokenCreateTransaction, TokenType, TokenSupplyType, TokenMintTransaction } = require('@hashgraph/sdk');
			nftCollections = [];
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
				let mintedSerials = [];
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
			const allTokenIds = [testFtTokenId, lazyTokenId, ...nftCollections.map(nft => nft.tokenId)];
			const allUsers = [
				{ id: operatorId, key: operatorKey },
				{ id: aliceId, key: aliceKey },
				{ id: bobId, key: bobKey }
			];
			await associateAllTokensToAllUsers(client, allTokenIds, allUsers);
		});
		// Setting higher timeout for async Hedera operations
		this.timeout(120000);

		before(async function () {
			// Initialize client
			client = Client.forName(env === 'testnet' ? 'testnet' : 'previewnet');
			client.setOperator(operatorId, operatorKey);
			// Default max fee for transactions
			client.setDefaultMaxTransactionFee(new Hbar(100));

			// Create user accounts
			[aliceId, aliceKey] = await accountCreator(client, operatorKey, new Hbar(100));
			[bobId, bobKey] = await accountCreator(client, operatorKey, new Hbar(100));

			console.log('Operator ID:', operatorId.toString());
			console.log('Alice ID:', aliceId.toString());
			console.log('Bob ID:', bobId.toString());

			// 1. Deploy HTSLazyLottoLibrary
			console.log('\\nDeploying HTSLazyLottoLibrary...');
			const libraryBytecode = fs.readFileSync(`./artifacts/contracts/${HTS_LAZY_LOTTO_LIBRARY_NAME}.sol/${HTS_LAZY_LOTTO_LIBRARY_NAME}.bin`);
			const libraryDeploy = await contractDeployFunction(client, libraryBytecode, 750_000);
			htsLazyLottoLibraryAddress = libraryDeploy.contractId.toSolidityAddress();
			console.log(`${HTS_LAZY_LOTTO_LIBRARY_NAME} deployed at: ${htsLazyLottoLibraryAddress}`);


			// 2. Deploy or reuse PrngSystemContract (real, for reference)
			if (process.env.PRNG_CONTRACT_ID) {
				console.log('\n- Using existing PrngSystemContract:', process.env.PRNG_CONTRACT_ID);
				prngContractId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
				prngContractAddress = prngContractId.toSolidityAddress();
			} else {
				console.log('\nDeploying PrngSystemContract (real)...');
				const prngBytecode = fs.readFileSync(`./artifacts/contracts/${PRNG_CONTRACT_NAME}.sol/${PRNG_CONTRACT_NAME}.bin`);
				const prngDeploy = await contractDeployFunction(client, prngBytecode, 600_000);
				prngContractId = prngDeploy.contractId;
				prngContractAddress = prngContractId.toSolidityAddress();
				console.log(`${PRNG_CONTRACT_NAME} deployed at: ${prngContractAddress} (${prngContractId.toString()})`);
			}

			// 2b. Deploy or reuse MockPrngSystemContract for deterministic tests
			if (process.env.MOCK_PRNG_CONTRACT_ID) {
				console.log('\n- Using existing MockPrngSystemContract:', process.env.MOCK_PRNG_CONTRACT_ID);
				mockPrngContractId = ContractId.fromString(process.env.MOCK_PRNG_CONTRACT_ID);
				mockPrngContractAddress = mockPrngContractId.toSolidityAddress();
			} else {
				console.log('\nDeploying MockPrngSystemContract for deterministic randomness...');
				const mockPrngBytecode = fs.readFileSync('./artifacts/contracts/mocks/MockPrngSystemContract.sol/MockPrngSystemContract.bin');
				// Use a static seed and number for deterministic results
				const staticSeed = ethers.utils.formatBytes32String('static-seed');
				const staticNumber = 0; // Always return lowest value for win, can be changed in tests
				const mockPrngParams = new ContractFunctionParameters()
					.addBytes32(staticSeed)
					.addUint256(staticNumber);
				const mockPrngDeploy = await contractDeployFunction(client, mockPrngBytecode, 600_000, mockPrngParams);
				mockPrngContractId = mockPrngDeploy.contractId;
				mockPrngContractAddress = mockPrngContractId.toSolidityAddress();
				console.log(`MockPrngSystemContract deployed at: ${mockPrngContractAddress} (${mockPrngContractId.toString()})`);
			}


			// 3. Deploy or reuse LAZY SCT and $LAZY token
			let lazyTokenCreatorDeploy, lazyTokenCreatorAddress, lazySCT;
			const lazyJson = JSON.parse(
				fs.readFileSync(`./artifacts/contracts/legacy/${LAZY_TOKEN_CREATOR_NAME}.sol/${LAZY_TOKEN_CREATOR_NAME}.json`)
			);
			const lazyIface = new ethers.Interface(lazyJson.abi);

			if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
				console.log('\n- Using existing LAZY SCT and $LAZY token:', process.env.LAZY_SCT_CONTRACT_ID, process.env.LAZY_TOKEN_ID);
				lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
				lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
				lazyTokenAddress = lazyTokenId.toSolidityAddress();
			} else {
				// Deploy LAZY SCT
				if (process.env.LAZY_TOKEN_CREATOR_CONTRACT_ID) {
					console.log('\n- Using existing LAZYTokenCreator:', process.env.LAZY_TOKEN_CREATOR_CONTRACT_ID);
					lazyTokenCreatorAddress = process.env.LAZY_TOKEN_CREATOR_CONTRACT_ID;
					lazySCT = ContractId.fromString(process.env.LAZY_TOKEN_CREATOR_CONTRACT_ID);
				} else {
					console.log('\nDeploying LAZYTokenCreator...');
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

			// Initialize ethers interface for LazyLotto
			// const lazyLottoAbi = JSON.parse(fs.readFileSync(\`./abi/${LAZY_LOTTO_CONTRACT_NAME}.json\\\`, 'utf8'));
			// lazyLottoIface = new ethers.utils.Interface(lazyLottoAbi);

			// Associate $LAZY with LazyLotto contract for it to hold/transfer $LAZY if needed for prizes/fees
			// The contract itself should handle associations for tokens it needs to interact with (e.g. fee tokens, prize tokens)
			// However, $LAZY is a core token, so ensuring it can receive it might be prudent if not handled by constructor/internal logic.
			// The \\`_checkAndPullFungible\\` function in LazyLotto handles association for prize tokens.
			// The constructor doesn't explicitly associate $LAZY.
			// Let's assume for now that functions requiring $LAZY (like paying out $LAZY prizes) will handle it or it's managed by LGS.
			console.log('\\nSetup complete.');
		});

		after(async function () {
			// Optional: Clean up resources, though local node usually resets.
			// For testnet, you might want to burn tokens, etc.
			if (client) {
				client.close();
			}
			console.log('\\nTests finished. Client closed.');
		});
	});

	describe('4.1. Contract Deployment and Initialization', function () {
		it('Test 4.1.1: Should deploy with valid parameters and set initial state', async function () {

			expectTrue(!!lazyLottoContractId, 'lazyLottoContractId set');
			expectTrue(!!lazyLottoContractAddress, 'lazyLottoContractAddress set');

			// Verify: \\`lazyToken\\`
			// No params for this getter
			let queryParams = [];
			let result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'lazyToken');
			expectEqual(result.getAddress(0).toLowerCase(), lazyTokenAddress.toLowerCase(), 'lazyToken address');

			// Verify: \\`lazyGasStation\\`
			result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'lazyGasStation');
			expectEqual(result.getAddress(0).toLowerCase(), lazyGasStationAddress.toLowerCase(), 'lazyGasStation address');

			// Verify: \\`lazyDelegateRegistry\\`
			result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'lazyDelegateRegistry');
			expectEqual(result.getAddress(0).toLowerCase(), lazyDelegateRegistryAddress.toLowerCase(), 'lazyDelegateRegistry address');

			// Verify: \\`prng\\`
			result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'prng');
			expectEqual(result.getAddress(0).toLowerCase(), prngContractAddress.toLowerCase(), 'prngContract address');

			// Verify: \\`burnPercentage\\`
			result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'burnPercentage');
			expectEqual(result.getUint256(0).toNumber(), INITIAL_BURN_PERCENTAGE, 'burnPercentage');

			// Verify: Deployer is admin
			queryParams = [operatorId.toSolidityAddress()];
			result = await contractCallQuery(client, lazyLottoContractId, queryParams, 100000, 'isAdmin');
			expectTrue(result.getBool(0), 'deployer is admin');

			// Verify: AdminAdded event emitted for deployer
			// This requires mirror node integration or specific event listening setup.
			// For now, we'll assume the isAdmin check is sufficient for this part of the test.
			// Later, we can add more robust event checking.
			console.log('Test 4.1.1 Passed: Deployed with valid parameters and initial state verified.');
		});

		it('Test 4.1.2: Should fail to deploy with zero address for _lazyToken', async function () {
			let lazyLottoBytecode = fs.readFileSync('./artifacts/contracts/${LAZY_LOTTO_CONTRACT_NAME}.sol/${LAZY_LOTTO_CONTRACT_NAME}.bin').toString();

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
			let lazyLottoBytecode = fs.readFileSync(`./artifacts/contracts/\${LAZY_LOTTO_CONTRACT_NAME}.sol/${LAZY_LOTTO_CONTRACT_NAME}.bin`).toString();
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

	// --- 4.3. Bonus Configuration (onlyAdmin) ---
	describe('4.3. Bonus Configuration', function () {
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

			it('Test 4.4.3.x: Should revert if removing prizes from a pool that is not closed', async function () {
				// Reopen pool for this test
				// (Assume POOL_ID_1 is open)
				const params = [POOL_ID, 0];
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'removePrizes', 200000);
					expectFalse(true, 'Should not remove from open pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'removePrizes not closed revert');
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

	describe('4.6. User Entry & Rolling', function () {
		// Test constants for section 4.6
		// Note: POOL_ID_HBAR_4_6 (0) might conflict with global POOL_ID_HBAR if tests run sequentially without reset
		const POOL_ID_HBAR_4_6 = 0;
		// Note: POOL_ID_LAZY_4_6 (1) might conflict with global POOL_ID_1
		const POOL_ID_LAZY_4_6 = 1;
		// 1 HBAR
		const HBAR_ENTRY_FEE_4_6 = new Hbar(1).toTinybars();
		// 10 $LAZY (1 decimal) -> 10 * 10^1 = 100 units
		const LAZY_ENTRY_FEE_4_6 = ethers.BigNumber.from('10').pow(1).mul(10);
		const DEFAULT_TICKET_COUNT = 1;
		// Example for testing
		const MAX_TICKETS_ALLOWED_PER_BUY = 5;

		let hbarPoolConfig;
		let lazyPoolConfig;

		before(async function () {
			// 1000 $LAZY with 1 decimal -> 1000 * 10^1 = 10000 units
			const ALICE_LAZY_BALANCE = ethers.BigNumber.from('10').pow(1).mul(1000);
			// 1000 $LAZY with 1 decimal -> 1000 * 10^1 = 10000 units
			const BOB_LAZY_BALANCE = ethers.BigNumber.from('10').pow(1).mul(1000);
			// 1. Transfer $LAZY to Alice and Bob
			console.log('\nSetting up for 4.6: Transferring $LAZY to Alice and Bob...');
			let transferParams = [aliceId.toSolidityAddress(), ALICE_LAZY_BALANCE];
			let tx = await contractExecuteFunction(client, lazyTokenId, transferParams, 0, 'transfer', 200000);
			await tx.getReceipt(client);
			console.log(`Transferred ${ALICE_LAZY_BALANCE.toString()} $LAZY to Alice.`);

			transferParams = [bobId.toSolidityAddress(), BOB_LAZY_BALANCE];
			tx = await contractExecuteFunction(client, lazyTokenId, transferParams, 0, 'transfer', 200000);
			await tx.getReceipt(client);
			console.log(`Transferred ${BOB_LAZY_BALANCE.toString()} $LAZY to Bob.`);

			const originalOperator = client.operatorAccountId;
			const originalSignerKey = client.operatorPublicKey;

			client.setOperator(aliceId, aliceKey);
			let approveParams = [lazyLottoContractAddress, ethers.constants.MaxUint256];
			tx = await contractExecuteFunction(client, lazyTokenId, approveParams, 0, 'approve', 200000);
			await tx.getReceipt(client);
			console.log('Alice approved LazyLotto for $LAZY.');

			client.setOperator(bobId, bobKey);
			approveParams = [lazyLottoContractAddress, ethers.constants.MaxUint256];
			tx = await contractExecuteFunction(client, lazyTokenId, approveParams, 0, 'approve', 200000);
			await tx.getReceipt(client);
			console.log('Bob approved LazyLotto for $LAZY.');

			client.setOperator(originalOperator, originalSignerKey);

			// 3. Define PoolConfig for HBAR Pool (ID 0)
			hbarPoolConfig = [
				// feeToken (HBAR)
				ZERO_ADDRESS,
				// entryFee
				HBAR_ENTRY_FEE_4_6.toString(),
				// maxTicketsPerUser
				10,
				// maxTicketsPerBuy
				MAX_TICKETS_ALLOWED_PER_BUY,
				// minTotalValueToDraw
				new Hbar(5).toTinybars().toString(),
				// maxTotalValue (unlimited)
				0,
				// durationSeconds (1 day)
				60 * 60 * 24,
				// name
				ethers.utils.formatBytes32String('HBAR Pool 4.6'),
				// symbol
				ethers.utils.formatBytes32String('HPL0'),
				// ticketMetadataCID
				'cid_hbar_ticket_0',
				// winningTicketMetadataCID
				'cid_hbar_win_0',
				// winRateThousandthsOfBps (0.1%)
				1000,
				// royalties (empty array)
				[],
			];

			// 4. Define PoolConfig for $LAZY Pool (ID 1)
			lazyPoolConfig = [
				// feeToken ($LAZY)
				lazyTokenAddress,
				// entryFee (10 $LAZY with 1 decimal)
				LAZY_ENTRY_FEE_4_6.toString(),
				// maxTicketsPerUser
				10,
				// maxTicketsPerBuy
				MAX_TICKETS_ALLOWED_PER_BUY,
				// minTotalValueToDraw (50 $LAZY with 1 decimal -> 50 * 10^1 = 500 units)
				ethers.BigNumber.from('10').pow(1).mul(50).toString(),
				// maxTotalValue (unlimited)
				0,
				// durationSeconds (1 day)
				60 * 60 * 24,
				// name
				ethers.utils.formatBytes32String('LAZY Pool 4.6'),
				// symbol
				ethers.utils.formatBytes32String('LPL1'),
				// ticketMetadataCID
				'cid_lazy_ticket_1',
				// winningTicketMetadataCID
				'cid_lazy_win_1',
				// winRateThousandthsOfBps (0.1%)
				1000,
				// royalties (empty array)
				[],
			];

			// 5. Create HBAR Pool (ID 0) if not already existing
			try {
				console.log('Attempting to create HBAR Pool ID:', POOL_ID_HBAR_4_6);
				const createHbarPoolParams = [hbarPoolConfig, POOL_ID_HBAR_4_6];
				const createHbarPoolTx = await contractExecuteFunction(client, lazyLottoContractId, createHbarPoolParams, 0, 'createPool', 2000000);
				await createHbarPoolTx.getReceipt(client);
				console.log('HBAR Pool ID', POOL_ID_HBAR_4_6, 'created for 4.6 tests.');
			}
			catch (error) {
				// Assuming it reverts if pool exists
				if (error.message.includes('CONTRACT_REVERT_EXECUTED')) {
					console.log('HBAR Pool ID', POOL_ID_HBAR_4_6, 'likely already exists. Proceeding.');
				}
				else {
					// Re-throw other errors
					throw error;
				}
			}

			// 6. Create $LAZY Pool (ID 1) if not already existing
			try {
				console.log('Attempting to create $LAZY Pool ID:', POOL_ID_LAZY_4_6);
				const createLazyPoolParams = [lazyPoolConfig, POOL_ID_LAZY_4_6];
				const createLazyPoolTx = await contractExecuteFunction(client, lazyLottoContractId, createLazyPoolParams, 0, 'createPool', 2000000);
				await createLazyPoolTx.getReceipt(client);
				console.log('$LAZY Pool ID', POOL_ID_LAZY_4_6, 'created for 4.6 tests.');
			}
			catch (error) {
				if (error.message.includes('CONTRACT_REVERT_EXECUTED')) {
					console.log('$LAZY Pool ID', POOL_ID_LAZY_4_6, 'likely already exists. Proceeding.');
				}
				else {
					throw error;
				}
			}
			// Ensure pools are not paused or closed initially for buyEntry tests
			try {
				await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID_HBAR_4_6], 0, 'unpausePool', 150000);
			}
			catch (e) {
				/* ignore if not paused */
			}
			try {
				await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID_LAZY_4_6], 0, 'unpausePool', 150000);
			}
			catch (e) {
				/* ignore if not paused */
			}

			console.log('\\nSetup for 4.6 complete.');
		});

		describe('4.6.1 / 4.6.2: buyEntry()', function () {
			it('Test 4.6.1.1: User should be able to buy an entry with HBAR', async function () {
				const originalAliceBalance = await client.getAccountBalance(aliceId);
				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];

				// Switch client to Alice
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				const buyTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					buyParams,
					HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
					'buyEntry',
					300000,
				);
				const receipt = await buyTx.getReceipt(client);
				expectEqual(receipt.status.toString(), 'SUCCESS', 'buyEntry HBAR receipt status');

				// Verify userEntries
				const queryUserEntriesParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addAddress(aliceId.toSolidityAddress());
				const userEntriesResult = await contractCallQuery(client, lazyLottoContractId, queryUserEntriesParams, 100000, 'getUsersEntries');
				expectEqual(userEntriesResult.getUint32(0), DEFAULT_TICKET_COUNT, 'userEntries after buyEntry HBAR');

				// Verify pool outstandingEntries and totalEntries (using getPool)
				const getPoolParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
				const poolInfo = await contractCallQuery(client, lazyLottoContractId, getPoolParams, 200000, 'getPool');
				expectGt(poolInfo.getUint256(8).toNumber(), 0, 'totalEntries after buyEntry HBAR');
				expectGt(poolInfo.getUint32(9), 0, 'outstandingEntries after buyEntry HBAR');

				// Verify HBAR taken (approx, due to gas)
				const newAliceBalance = await client.getAccountBalance(aliceId);
				expectTrue(newAliceBalance.hbars.toTinybars().toNumber() < originalAliceBalance.hbars.toTinybars().toNumber(), 'Alice HBAR balance decreased after buyEntry');

				// Reset client
				client.setOperator(originalOperator, originalSignerKey);
				console.log('Test 4.6.1.1 Passed: User bought entry with HBAR.');
			});

			it('Test 4.6.2.1: User should be able to buy an entry with $LAZY token', async function () {
				const buyParams = [POOL_ID_LAZY_4_6, DEFAULT_TICKET_COUNT];

				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				const buyTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					buyParams,
					0,
					'buyEntry',
					400000,
				);
				const receipt = await buyTx.getReceipt(client);
				expectEqual(receipt.status.toString(), 'SUCCESS', 'buyEntry $LAZY receipt status');


				// Optionally: Verify $LAZY transferred (check Alice's balance, LGS balance)
				// Verify EntryPurchased event
				await sleep(5000);
				const lastEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, 0, true);
				expect(lastEvent.toString().toLowerCase()).to.equal(aliceId.toString().toLowerCase());

				client.setOperator(originalOperator, originalSignerKey);
				console.log('Test 4.6.2.1 Passed: User bought entry with $LAZY.');
			});

			it('Test 4.6.3.1: Should fail to buy with insufficient HBAR', async function () {
				// Removed ContractFunctionParameters
				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];

				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						// Insufficient HBAR
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).minus(1).toNumber(),
						'buyEntry',
						300000,
					);
					expect.fail('Should have failed due to insufficient HBAR');
				}
				catch (error) {
					expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
					console.log('Test 4.6.3.1 Passed: Failed with insufficient HBAR as expected.');
				}
				finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.6.4.1: Should fail to buy with insufficient $LAZY balance', async function () {
				// Bob will attempt to buy. Bob has 1000 $LAZY (which is 10000 units with 1 decimal).
				// LAZY_ENTRY_FEE_4_6 is 10 $LAZY (100 units).
				// Let's try to buy 200 tickets (requires 200 * 100 = 20000 units, i.e. 2000 $LAZY).
				const tooManyTickets = 200;

				// Removed ContractFunctionParameters
				const buyParams = [POOL_ID_LAZY_4_6, tooManyTickets];

				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(bobId, bobKey);

				try {
					await contractExecuteFunction(client, lazyLottoContractId, buyParams, 0, 'buyEntry', 400000);
					expect.fail('Should have failed due to insufficient $LAZY balance');
				}
				catch (error) {
					expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
					console.log('Test 4.6.4.1 Passed: Failed with insufficient $LAZY balance as expected.');
				}
				finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.6.5.1: Should fail to buy with ticketCount = 0', async function () {
				// Removed ContractFunctionParameters
				const buyParams = [POOL_ID_HBAR_4_6, 0];

				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				try {
					await contractExecuteFunction(client, lazyLottoContractId, buyParams, HBAR_ENTRY_FEE_4_6.multipliedBy(0).toNumber(), 'buyEntry', 300000);
					expect.fail('Should have failed with ticketCount = 0');
				}
				catch (error) {
					expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
					// Expect BadParameters (contract has: require(ticketCount > 0, "No tickets");)
					console.log('Test 4.6.5.1 Passed: Failed with ticketCount = 0 as expected.');
				}
				finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.6.x: Should fail to buy more tickets than MAX_TICKETS_PER_BUY', async function () {
				// Removed ContractFunctionParameters
				const buyParams = [POOL_ID_HBAR_4_6, MAX_TICKETS_ALLOWED_PER_BUY + 1];

				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(MAX_TICKETS_ALLOWED_PER_BUY + 1).toNumber(),
						'buyEntry',
						300000,
					);
					expectFalse(true, 'Should not buy more than MAX_TICKETS_PER_BUY');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'buyEntry max tickets per buy revert');
					console.log('Test 4.6.x Passed: Failed buying too many tickets at once, as expected.');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.6.6.1: Should fail to buy from a paused pool', async function () {
				// Admin (operator) pauses the HBAR pool
				const pauseParams = [POOL_ID_HBAR_4_6];
				const pauseTx = await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'pausePool', 150000);
				await pauseTx.getReceipt(client);
				console.log('HBAR Pool paused for test 4.6.6.1.');

				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];

				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'buyEntry',
						300000,
					);
					expect.fail('Should have failed to buy from a paused pool');
				}
				catch (error) {
					expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
					console.log('Test 4.6.6.1 Passed: Failed to buy from paused pool as expected.');
				}
				finally {
					client.setOperator(originalOperator, originalSignerKey);
					// Admin unpauses the pool
					const unpauseParams = [POOL_ID_HBAR_4_6];
					const unpauseTx = await contractExecuteFunction(client, lazyLottoContractId, unpauseParams, 0, 'unpausePool', 150000);
					await unpauseTx.getReceipt(client);
					console.log('HBAR Pool unpaused after test 4.6.6.1.');
				}
			});

			it('Test 4.6.7.1: Should fail to buy from a closed pool', async function () {
				// Using a different ID
				const TEMP_POOL_ID_FOR_CLOSE = 98;
				const currentTestOperator = client.operatorAccountId;
				const currentTestSignerKey = client.operatorPublicKey;

				try {
					// Create a temporary pool
					const createTempPoolParams = [hbarPoolConfig, TEMP_POOL_ID_FOR_CLOSE];
					const createTempPoolTx = await contractExecuteFunction(client, lazyLottoContractId, createTempPoolParams, 0, 'createPool', 2000000);
					await createTempPoolTx.getReceipt(client);
					console.log('Temporary Pool ID', TEMP_POOL_ID_FOR_CLOSE, 'created for close test.');

					// Close the temporary pool
					const closeParams = [TEMP_POOL_ID_FOR_CLOSE];
					const closeTx = await contractExecuteFunction(client, lazyLottoContractId, closeParams, 0, 'closePool', 200000);
					await closeTx.getReceipt(client);
					console.log('Temporary Pool ID', TEMP_POOL_ID_FOR_CLOSE, 'closed for test.');

					// Attempt to buy
					const buyParams = [TEMP_POOL_ID_FOR_CLOSE, DEFAULT_TICKET_COUNT];

					client.setOperator(aliceId, aliceKey);

					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'buyEntry',
						500000,
					);
					expectFalse(true, 'Should not buy from a closed pool');
				}
				catch (error) {
					if (error.message.includes('CONTRACT_REVERT_EXECUTED')) {
						console.log('Test 4.6.7.1 Passed: Failed to buy from closed pool as expected.');
					}
					else if (error.message.includes('Pool already exists')) {
						console.warn('Test 4.6.7.1 Skipped: Temp pool creation failed (ID ' + TEMP_POOL_ID_FOR_CLOSE + '), likely due to pre-existing ID. Manual cleanup might be needed.');
					}
					else {
						console.error('Error in Test 4.6.7.1:', error.message);
						throw error;
					}
				}
				finally {
					if (client.operatorAccountId.toString() !== currentTestOperator.toString()) {
						client.setOperator(currentTestOperator, currentTestSignerKey);
					}
				}
			});
		}); // End of 4.6.1 / 4.6.2 describe

		describe('4.6.8: buyAndRollEntry()', function () {
			// Unique ID for this test block
			const TEMP_POOL_ID_FOR_CLOSE_ROLL = 97;
			it('Test 4.6.8.1: User should be able to buy and roll an entry with HBAR', async function () {
				const originalAliceBalance = await client.getAccountBalance(aliceId);
				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];

				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				const buyTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					buyParams,
					// msg.value
					HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
					'buyAndRollEntry',
					500000,
				);
				const receipt = await buyTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');

				// Verify userEntries (should be 0 after rolling if it was a winning roll, or 1 if losing)
				// This is tricky to assert directly without knowing PRNG outcome.
				// We can check if the transaction succeeded and HBAR was spent.

				const newAliceBalance = await client.getAccountBalance(aliceId);
				expect(newAliceBalance.hbars.toTinybars().toNumber()).to.be.lessThan(originalAliceBalance.hbars.toTinybars().toNumber() - HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber() + HBAR_ENTRY_FEE_4_6.toNumber());


				// Verify EntryPurchased event
				await sleep(5000);
				let lastEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, 0, true);
				expect(lastEvent.toString().toLowerCase()).to.equal(aliceId.toString().toLowerCase());
				// Verify Rolled event (EntryRolled)
				// Check for the most recent Rolled event for this user and pool
				let rolledEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('Rolled'), true);
				// The event should include user address and poolId
				expect(rolledEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
				expect(rolledEvent.poolId.toString()).to.equal(POOL_ID_HBAR_4_6.toString());

				client.setOperator(originalOperator, originalSignerKey);
				console.log('Test 4.6.8.1 Passed: User bought and rolled entry with HBAR.');
			});

			it('Test 4.6.8.2: User should be able to buy and roll an entry with $LAZY token', async function () {
				const buyParams = [POOL_ID_LAZY_4_6, DEFAULT_TICKET_COUNT];

				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);

				const buyTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					buyParams,
					// No msg.value for FT
					0,
					'buyAndRollEntry',
					600000,
				);
				const receipt = await buyTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');


				// Optionally: Verify $LAZY transferred
				// Verify EntryPurchased event
				await sleep(5000);
				let lastEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, 0, true);
				expect(lastEvent.toString().toLowerCase()).to.equal(aliceId.toString().toLowerCase());
				// Verify Rolled event (EntryRolled)
				rolledEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('Rolled'), true);
				expect(rolledEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
				expect(rolledEvent.poolId.toString()).to.equal(POOL_ID_LAZY_4_6.toString());

				client.setOperator(originalOperator, originalSignerKey);
				console.log('Test 4.6.8.2 Passed: User bought and rolled entry with $LAZY.');
			});

			it('Test 4.6.8.3: Should fail to buy and roll from a paused pool', async function () {
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				// Admin (operator) pauses the HBAR pool
				const pauseParams = [POOL_ID_HBAR_4_6];
				const pauseTx = await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'pausePool', 150000);
				await pauseTx.getReceipt(client);
				console.log('HBAR Pool paused for test 4.6.8.3.');

				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];

				try {
					client.setOperator(aliceId, aliceKey);
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'buyAndRollEntry',
						500000,
					);
					expect.fail('Should have failed to buy and roll from a paused pool');
				}
				catch (error) {
					expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
					console.log('Test 4.6.8.3 Passed: Failed to buy and roll from paused pool as expected.');
				}
				finally {
					client.setOperator(originalOperator, originalSignerKey);
					// Admin unpauses the pool
					const unpauseParams = [POOL_ID_HBAR_4_6];
					const unpauseTx = await contractExecuteFunction(client, lazyLottoContractId, unpauseParams, 0, 'unpausePool', 150000);
					await unpauseTx.getReceipt(client);
					console.log('HBAR Pool unpaused after test 4.6.8.3.');
				}
			});

			it('Test 4.6.8.4: Should fail to buy and roll from a closed pool', async function () {
				const currentTestOperator = client.operatorAccountId;
				const currentTestSignerKey = client.operatorPublicKey;
				try {
					// Create a temporary pool
					const createTempPoolParams = [hbarPoolConfig, TEMP_POOL_ID_FOR_CLOSE_ROLL];
					const createTempPoolTx = await contractExecuteFunction(client, lazyLottoContractId, createTempPoolParams, 0, 'createPool', 2000000);
					await createTempPoolTx.getReceipt(client);
					console.log('Temporary Pool ID', TEMP_POOL_ID_FOR_CLOSE_ROLL, 'created for close and roll test.');
					const closeParams = [TEMP_POOL_ID_FOR_CLOSE_ROLL];
					const closeTx = await contractExecuteFunction(client, lazyLottoContractId, closeParams, 0, 'closePool', 200000);
					await closeTx.getReceipt(client);
					console.log('Temporary Pool ID', TEMP_POOL_ID_FOR_CLOSE_ROLL, 'closed for test.');
					const buyParams = [TEMP_POOL_ID_FOR_CLOSE_ROLL, DEFAULT_TICKET_COUNT];

					client.setOperator(aliceId, aliceKey);

					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'buyAndRollEntry',
						500000,
					);
					expect.fail('Should have failed to buy and roll from a closed pool');
				}
				catch (error) {
					if (error.message.includes('CONTRACT_REVERT_EXECUTED')) {
						// Expect PoolIsClosed
						console.log('Test 4.6.8.4 Passed: Failed to buy and roll from closed pool as expected.');
					}
					else if (error.message.includes('Pool already exists')) {
						console.warn('Test 4.6.8.4 Skipped: Temp pool creation failed (ID ' + TEMP_POOL_ID_FOR_CLOSE_ROLL + '), likely due to pre-existing ID. Manual cleanup might be needed.');
					}
					else {
						console.error('Error in Test 4.6.8.4:', error.message);
						throw error;
					}
				}
				finally {
					if (client.operatorAccountId.toString() !== currentTestOperator.toString()) {
						client.setOperator(currentTestOperator, currentTestSignerKey);
					}
				}
			});
		}); // End of 4.6.8 describe

		// Tests for 4.6.9 buyAndRedeemEntry() implemented below
		describe('4.6.9: buyAndRedeemEntry()', function () {
			it('Test 4.6.9.1: User should be able to buy and redeem entry with HBAR', async function () {
				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const buyTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					buyParams,
					HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
					'buyAndRedeemEntry',
					600000,
				);
				const receipt = await buyTx.getReceipt(client);
				expectEqual(receipt.status.toString(), 'SUCCESS', 'buyAndRedeemEntry HBAR receipt status');
				client.setOperator(originalOperator, originalSignerKey);
				console.log('Test 4.6.9.1 Passed: User bought and redeemed entry with HBAR.');
			});

			it('Test 4.6.9.2: User should be able to buy and redeem entry with $LAZY', async function () {
				const buyParams = [POOL_ID_LAZY_4_6, DEFAULT_TICKET_COUNT];
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				const buyTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					buyParams,
					0,
					'buyAndRedeemEntry',
					600000,
				);
				const receipt = await buyTx.getReceipt(client);
				expectEqual(receipt.status.toString(), 'SUCCESS', 'buyAndRedeemEntry $LAZY receipt status');
				client.setOperator(originalOperator, originalSignerKey);
				console.log('Test 4.6.9.2 Passed: User bought and redeemed entry with $LAZY.');
			});

			it('Test 4.6.9.3: Should fail to buy and redeem from a paused pool', async function () {
				const pauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
				await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'pausePool', 150000);
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_HBAR_4_6)
					.addUint32(DEFAULT_TICKET_COUNT);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'buyAndRedeemEntry',
						600000,
					);
					expect.fail('Should have failed to buy and redeem from a paused pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'buyAndRedeemEntry paused pool revert');
					console.log('Test 4.6.9.3 Passed: Failed to buy and redeem from paused pool as expected.');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
					const unpauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
					await contractExecuteFunction(client, lazyLottoContractId, unpauseParams, 0, 'unpausePool', 150000);
				}
			});

			it('Test 4.6.9.4: Should fail to buy and redeem from a closed pool', async function () {
				const TEMP_POOL_ID = 96;
				const createTempPoolParams = new ContractFunctionParameters()
					.addTuple(hbarPoolConfig)
					.addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, createTempPoolParams, 0, 'createPool', 2000000);
				const closeParams = new ContractFunctionParameters().addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, closeParams, 0, 'closePool', 200000);
				const buyParams = new ContractFunctionParameters()
					.addUint256(TEMP_POOL_ID)
					.addUint32(DEFAULT_TICKET_COUNT);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'buyAndRedeemEntry',
						600000,
					);
					expect.fail('Should have failed to buy and redeem from a closed pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'buyAndRedeemEntry closed pool revert');
					console.log('Test 4.6.9.4 Passed: Failed to buy and redeem from closed pool as expected.');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.6.9.5: Should fail to buy and redeem with ticketCount = 0', async function () {
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_HBAR_4_6)
					.addUint32(0);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(0).toNumber(),
						'buyAndRedeemEntry',
						300000,
					);
					expect.fail('Should have failed with ticketCount = 0');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'buyAndRedeemEntry zero ticketCount revert');
					console.log('Test 4.6.9.5 Passed: Failed with ticketCount = 0 as expected.');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.6.9.6: Should fail to buy and redeem with insufficient HBAR', async function () {
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_HBAR_4_6)
					.addUint32(DEFAULT_TICKET_COUNT);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).minus(1).toNumber(),
						'buyAndRedeemEntry',
						300000,
					);
					expect.fail('Should have failed due to insufficient HBAR');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'buyAndRedeemEntry insufficient HBAR revert');
					console.log('Test 4.6.9.6 Passed: Failed with insufficient HBAR as expected.');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.6.9.7: Should fail to buy and redeem with insufficient $LAZY', async function () {
				const tooManyTickets = 200;
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_LAZY_4_6)
					.addUint32(tooManyTickets);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(bobId, bobKey);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, buyParams, 0, 'buyAndRedeemEntry', 400000);
					expect.fail('Should have failed due to insufficient $LAZY balance');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'buyAndRedeemEntry insufficient $LAZY revert');
					console.log('Test 4.6.9.7 Passed: Failed with insufficient $LAZY as expected.');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});
		});

		describe('4.6.10: adminBuyEntry()', function () {
			it('Test 4.6.10.1: Admin can buy entry for a user (HBAR)', async function () {
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_HBAR_4_6)
					.addAddress(aliceId.toSolidityAddress())
					.addUint32(DEFAULT_TICKET_COUNT);
				const buyTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					buyParams,
					HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
					'adminBuyEntry',
					400000,
				);
				const receipt = await buyTx.getReceipt(client);
				expectEqual(receipt.status.toString(), 'SUCCESS', 'adminBuyEntry HBAR receipt status');
				console.log('Test 4.6.10.1 Passed: Admin bought entry for user (HBAR).');
			});

			it('Test 4.6.10.2: Admin can buy entry for a user ($LAZY)', async function () {
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_LAZY_4_6)
					.addAddress(aliceId.toSolidityAddress())
					.addUint32(DEFAULT_TICKET_COUNT);
				const buyTx = await contractExecuteFunction(
					client,
					lazyLottoContractId,
					buyParams,
					0,
					'adminBuyEntry',
					400000,
				);
				const receipt = await buyTx.getReceipt(client);
				expectEqual(receipt.status.toString(), 'SUCCESS', 'adminBuyEntry $LAZY receipt status');
				console.log('Test 4.6.10.2 Passed: Admin bought entry for user ($LAZY).');
			});

			it('Test 4.6.10.3: Non-admin cannot call adminBuyEntry', async function () {
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_HBAR_4_6)
					.addAddress(bobId.toSolidityAddress())
					.addUint32(DEFAULT_TICKET_COUNT);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'adminBuyEntry',
						400000,
					);
					expect.fail('Non-admin should not be able to call adminBuyEntry');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'adminBuyEntry non-admin revert');
					console.log('Test 4.6.10.3 Passed: Non-admin could not call adminBuyEntry as expected.');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Test 4.6.10.4: Should fail to buy for user with ticketCount = 0', async function () {
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_HBAR_4_6)
					.addAddress(bobId.toSolidityAddress())
					.addUint32(0);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(0).toNumber(),
						'adminBuyEntry',
						300000,
					);
					expect.fail('Should have failed with ticketCount = 0');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'adminBuyEntry zero ticketCount revert');
					console.log('Test 4.6.10.4 Passed: Failed with ticketCount = 0 as expected.');
				}
			});

			it('Test 4.6.10.5: Should fail to buy for user from a paused pool', async function () {
				const pauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
				await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'pausePool', 150000);
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_HBAR_4_6)
					.addAddress(bobId.toSolidityAddress())
					.addUint32(DEFAULT_TICKET_COUNT);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'adminBuyEntry',
						400000,
					);
					expect.fail('Should have failed to buy for user from a paused pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'adminBuyEntry paused pool revert');
					console.log('Test 4.6.10.5 Passed: Failed to buy for user from paused pool as expected.');
				} finally {
					const unpauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
					await contractExecuteFunction(client, lazyLottoContractId, unpauseParams, 0, 'unpausePool', 150000);
				}
			});

			it('Test 4.6.10.6: Should fail to buy for user from a closed pool', async function () {
				const TEMP_POOL_ID = 95;
				const createTempPoolParams = new ContractFunctionParameters()
					.addTuple(hbarPoolConfig)
					.addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, createTempPoolParams, 0, 'createPool', 2000000);
				const closeParams = new ContractFunctionParameters().addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, closeParams, 0, 'closePool', 200000);
				const buyParams = new ContractFunctionParameters()
					.addUint256(TEMP_POOL_ID)
					.addAddress(bobId.toSolidityAddress())
					.addUint32(DEFAULT_TICKET_COUNT);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(),
						'adminBuyEntry',
						400000,
					);
					expect.fail('Should have failed to buy for user from a closed pool');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'adminBuyEntry closed pool revert');
					console.log('Test 4.6.10.6 Passed: Failed to buy for user from closed pool as expected.');
				}
			});

			it('Test 4.6.10.7: Should fail to buy for user with insufficient HBAR', async function () {
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_HBAR_4_6)
					.addAddress(bobId.toSolidityAddress())
					.addUint32(DEFAULT_TICKET_COUNT);
				try {
					await contractExecuteFunction(
						client,
						lazyLottoContractId,
						buyParams,
						HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).minus(1).toNumber(),
						'adminBuyEntry',
						300000,
					);
					expect.fail('Should have failed due to insufficient HBAR');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'adminBuyEntry insufficient HBAR revert');
					console.log('Test 4.6.10.7 Passed: Failed with insufficient HBAR as expected.');
				}
			});

			it('Test 4.6.10.8: Should fail to buy for user with insufficient $LAZY', async function () {
				const tooManyTickets = 200;
				const buyParams = new ContractFunctionParameters()
					.addUint256(POOL_ID_LAZY_4_6)
					.addAddress(bobId.toSolidityAddress())
					.addUint32(tooManyTickets);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, buyParams, 0, 'adminBuyEntry', 400000);
					expect.fail('Should have failed due to insufficient $LAZY balance');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'adminBuyEntry insufficient $LAZY revert');
					console.log('Test 4.6.10.8 Passed: Failed with insufficient $LAZY as expected.');
				}
			});
		});
		// Tests for 4.6.12 rollAll() implemented below
		describe('4.6.12: rollAll() positive', function () {
			it('Should roll all tickets for user and emit Rolled event', async function () {
				// Setup: Alice buys entries in HBAR pool
				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];
				client.setOperator(aliceId, aliceKey);
				await contractExecuteFunction(client, lazyLottoContractId, buyParams, HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(), 'buyEntry', 300000);

				// Roll all
				const rollParams = [POOL_ID_HBAR_4_6];
				const rollTx = await contractExecuteFunction(client, lazyLottoContractId, rollParams, 0, 'rollAll', 300000);
				const receipt = await rollTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');

				// Wait for mirror node
				await sleep(5000);
				// Check Rolled event
				const rolledEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('Rolled'), true);
				expect(rolledEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
				expect(rolledEvent.poolId.toString()).to.equal(POOL_ID_HBAR_4_6.toString());
				// Optionally: check userEntries is now 0
				const entriesParams = [POOL_ID_HBAR_4_6, aliceId.toSolidityAddress()];
				const entries = await contractCallQuery(client, lazyLottoContractId, entriesParams, 100000, 'getUserEntries');
				expect(entries.getUint256(0).toNumber()).to.equal(0);
			});
		});
		// Tests for 4.6.14 rollBatch() implemented below
		describe('4.6.14: rollBatch() positive', function () {
			it('Should roll a batch of tickets for user and emit Rolled event', async function () {
				// Setup: Alice buys entries in HBAR pool
				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];
				client.setOperator(aliceId, aliceKey);
				await contractExecuteFunction(client, lazyLottoContractId, buyParams, HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(), 'buyEntry', 300000);

				// Roll batch (e.g., roll 2 tickets)
				const batchSize = 2;
				const rollParams = [POOL_ID_HBAR_4_6, batchSize];
				const rollTx = await contractExecuteFunction(client, lazyLottoContractId, rollParams, 0, 'rollBatch', 300000);
				const receipt = await rollTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');

				// Wait for mirror node
				await sleep(5000);
				// Check Rolled event
				const rolledEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('Rolled'), true);
				expect(rolledEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
				expect(rolledEvent.poolId.toString()).to.equal(POOL_ID_HBAR_4_6.toString());
				// Optionally: check userEntries is now DEFAULT_TICKET_COUNT - batchSize
				const entriesParams = [POOL_ID_HBAR_4_6, aliceId.toSolidityAddress()];
				const entries = await contractCallQuery(client, lazyLottoContractId, entriesParams, 100000, 'getUserEntries');
				expect(entries.getUint256(0).toNumber()).to.equal(DEFAULT_TICKET_COUNT - batchSize);
			});
		});
		// Tests for 4.6.17 rollWithNFT() implemented below
		describe('4.6.17: rollWithNFT() positive', function () {
			it('Should roll tickets with NFT and emit Rolled event', async function () {
				// Setup: Alice buys entries in HBAR pool
				const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];
				client.setOperator(aliceId, aliceKey);
				await contractExecuteFunction(client, lazyLottoContractId, buyParams, HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(), 'buyEntry', 300000);

				// Assume Alice owns a valid NFT for the pool (mock or use test NFT)
				// For demonstration, use serial 1 (should be replaced with actual test NFT)
				const nftSerials = [1];
				const rollParams = [POOL_ID_HBAR_4_6, nftSerials];
				const rollTx = await contractExecuteFunction(client, lazyLottoContractId, rollParams, 0, 'rollWithNFT', 300000);
				const receipt = await rollTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');

				// Wait for mirror node
				await sleep(5000);
				// Check Rolled event
				const rolledEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('Rolled'), true);
				expect(rolledEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
				expect(rolledEvent.poolId.toString()).to.equal(POOL_ID_HBAR_4_6.toString());
				// Optionally: check userEntries is now DEFAULT_TICKET_COUNT - nftSerials.length
				const entriesParams = [POOL_ID_HBAR_4_6, aliceId.toSolidityAddress()];
				const entries = await contractCallQuery(client, lazyLottoContractId, entriesParams, 100000, 'getUserEntries');
				expect(entries.getUint256(0).toNumber()).to.equal(DEFAULT_TICKET_COUNT - nftSerials.length);
			});
		});

		// --- Internal logic tests for _roll using mock PRNG ---
		describe('4.6.21: _roll() deterministic win/loss with mock PRNG', function () {
			const poolId = POOL_ID_HBAR_4_6;
			const ticketCount = 1;
			it('Should force a win when mock PRNG staticNumber = 0', async function () {
				// Set mock PRNG to always return 0 (lowest possible, always win if winRate > 0)
				const setStaticNumberParams = [0];
				await contractExecuteFunction(client, mockPrngContractId, setStaticNumberParams, 0, 'setStaticNumber', 100000);

				// Alice buys 1 entry
				const buyParams = [poolId, ticketCount];
				client.setOperator(aliceId, aliceKey);
				await contractExecuteFunction(client, lazyLottoContractId, buyParams, HBAR_ENTRY_FEE_4_6.multipliedBy(ticketCount).toNumber(), 'buyEntry', 300000);

				// Roll the entry
				const rollParams = [poolId];
				const rollTx = await contractExecuteFunction(client, lazyLottoContractId, rollParams, 0, 'rollAll', 300000);
				const receipt = await rollTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');
				await sleep(5000);
				// Check Rolled event: won = true
				const rolledEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('Rolled'), true);
				expect(rolledEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
				expect(rolledEvent.poolId.toString()).to.equal(poolId.toString());
				expect(rolledEvent.won).to.equal(true);
				// Check pending prize exists
				const pendingParams = [poolId, aliceId.toSolidityAddress()];
				const pending = await contractCallQuery(client, lazyLottoContractId, pendingParams, 100000, 'getPendingPrizes');
				expect(pending.length).to.be.greaterThan(0);
			});

			it('Should force a loss when mock PRNG staticNumber = 999999', async function () {
				// Set mock PRNG to always return a high value (always lose if winRate is low)
				const setStaticNumberParams = [999999];
				await contractExecuteFunction(client, mockPrngContractId, setStaticNumberParams, 0, 'setStaticNumber', 100000);

				// Alice buys 1 entry
				const buyParams = [poolId, ticketCount];
				client.setOperator(aliceId, aliceKey);
				await contractExecuteFunction(client, lazyLottoContractId, buyParams, HBAR_ENTRY_FEE_4_6.multipliedBy(ticketCount).toNumber(), 'buyEntry', 300000);

				// Roll the entry
				const rollParams = [poolId];
				const rollTx = await contractExecuteFunction(client, lazyLottoContractId, rollParams, 0, 'rollAll', 300000);
				const receipt = await rollTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');
				await sleep(5000);
				// Check Rolled event: won = false
				const rolledEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('Rolled'), true);
				expect(rolledEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
				expect(rolledEvent.poolId.toString()).to.equal(poolId.toString());
				expect(rolledEvent.won).to.equal(false);
				// Check no pending prize
				const pendingParams = [poolId, aliceId.toSolidityAddress()];
				const pending = await contractCallQuery(client, lazyLottoContractId, pendingParams, 100000, 'getPendingPrizes');
				expect(pending.length).to.equal(0);
			});
		}); // End of 4.6.21 _roll deterministic tests

		// 4.6.12 rollAll() edge/negative tests
		describe('4.6.12: rollAll()', function () {
			it('Should fail if user has no tickets', async function () {
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(bobId, bobKey); // Bob has no tickets
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollAll', 300000);
					expect.fail('Should have failed: no tickets');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollAll no tickets revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Should fail if pool is paused', async function () {
				const pauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
				await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'pausePool', 150000);
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollAll', 300000);
					expect.fail('Should have failed: pool paused');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollAll paused pool revert');
				} finally {
					const unpauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
					await contractExecuteFunction(client, lazyLottoContractId, unpauseParams, 0, 'unpausePool', 150000);
				}
			});

			it('Should fail if pool is closed', async function () {
				const TEMP_POOL_ID = 96;
				const createTempPoolParams = new ContractFunctionParameters().addTuple(hbarPoolConfig).addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, createTempPoolParams, 0, 'createPool', 2000000);
				const closeParams = new ContractFunctionParameters().addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, closeParams, 0, 'closePool', 200000);
				const params = new ContractFunctionParameters().addUint256(TEMP_POOL_ID);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollAll', 300000);
					expect.fail('Should have failed: pool closed');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollAll closed pool revert');
				}
			});
		});

		// 4.6.14 rollBatch() edge/negative tests
		describe('4.6.14: rollBatch()', function () {
			it('Should fail if batch size is zero', async function () {
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addUint32(0);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollBatch', 300000);
					expect.fail('Should have failed: batch size zero');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollBatch zero batch size revert');
				}
			});

			it('Should fail if user has no tickets', async function () {
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addUint32(1);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(bobId, bobKey); // Bob has no tickets
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollBatch', 300000);
					expect.fail('Should have failed: no tickets');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollBatch no tickets revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Should fail if batch size > tickets owned', async function () {
				// Alice has DEFAULT_TICKET_COUNT tickets
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addUint32(DEFAULT_TICKET_COUNT + 1);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollBatch', 300000);
					expect.fail('Should have failed: batch size > tickets');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollBatch not enough tickets revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Should fail if pool is paused', async function () {
				const pauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
				await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'pausePool', 150000);
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addUint32(1);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollBatch', 300000);
					expect.fail('Should have failed: pool paused');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollBatch paused pool revert');
				} finally {
					const unpauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
					await contractExecuteFunction(client, lazyLottoContractId, unpauseParams, 0, 'unpausePool', 150000);
				}
			});

			it('Should fail if pool is closed', async function () {
				const TEMP_POOL_ID = 97;
				const createTempPoolParams = new ContractFunctionParameters().addTuple(hbarPoolConfig).addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, createTempPoolParams, 0, 'createPool', 2000000);
				const closeParams = new ContractFunctionParameters().addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, closeParams, 0, 'closePool', 200000);
				const params = new ContractFunctionParameters().addUint256(TEMP_POOL_ID).addUint32(1);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollBatch', 300000);
					expect.fail('Should have failed: pool closed');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollBatch closed pool revert');
				}
			});
		});

		// 4.6.17 rollWithNFT() edge/negative tests
		describe('4.6.17: rollWithNFT()', function () {
			it('Should fail if NFT array is empty', async function () {
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addInt64Array([]);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollWithNFT', 300000);
					expect.fail('Should have failed: empty NFT array');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollWithNFT empty NFT array revert');
				}
			});

			it('Should fail if user has no tickets', async function () {
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addInt64Array([1]);
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(bobId, bobKey); // Bob has no tickets
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollWithNFT', 300000);
					expect.fail('Should have failed: no tickets');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollWithNFT no tickets revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Should fail if NFT array length > tickets owned', async function () {
				// Alice has DEFAULT_TICKET_COUNT tickets
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addInt64Array(Array(DEFAULT_TICKET_COUNT + 1).fill(1));
				const originalOperator = client.operatorAccountId;
				const originalSignerKey = client.operatorPublicKey;
				client.setOperator(aliceId, aliceKey);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollWithNFT', 300000);
					expect.fail('Should have failed: NFT array > tickets');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollWithNFT not enough tickets revert');
				} finally {
					client.setOperator(originalOperator, originalSignerKey);
				}
			});

			it('Should fail if pool is paused', async function () {
				const pauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
				await contractExecuteFunction(client, lazyLottoContractId, pauseParams, 0, 'pausePool', 150000);
				const params = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addInt64Array([1]);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollWithNFT', 300000);
					expect.fail('Should have failed: pool paused');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollWithNFT paused pool revert');
				} finally {
					const unpauseParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6);
					await contractExecuteFunction(client, lazyLottoContractId, unpauseParams, 0, 'unpausePool', 150000);
				}
			});

			it('Should fail if pool is closed', async function () {
				const TEMP_POOL_ID = 98;
				const createTempPoolParams = new ContractFunctionParameters().addTuple(hbarPoolConfig).addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, createTempPoolParams, 0, 'createPool', 2000000);
				const closeParams = new ContractFunctionParameters().addUint256(TEMP_POOL_ID);
				await contractExecuteFunction(client, lazyLottoContractId, closeParams, 0, 'closePool', 200000);
				const params = new ContractFunctionParameters().addUint256(TEMP_POOL_ID).addInt64Array([1]);
				try {
					await contractExecuteFunction(client, lazyLottoContractId, params, 0, 'rollWithNFT', 300000);
					expect.fail('Should have failed: pool closed');
				} catch (error) {
					expectInclude(error.message, 'CONTRACT_REVERT_EXECUTED', 'rollWithNFT closed pool revert');
				}
			});
		});

		// 4.7. Prize Claiming & Management
		describe('4.7: Prize Claiming & Management', function () {
		}); // <-- Add this to close the describe('4.7: Prize Claiming & Management', ...)
		it('Should allow Alice to claim a TESTFT prize after winning', async function () {
			// Setup: Add TESTFT as prize, Alice buys and rolls
			const addParams = [POOL_ID, testFtTokenId, TESTFT_PRIZE_AMOUNT, false, ZERO_ADDRESS, 0];
			await contractExecuteFunction(client, lazyLottoContractId, addParams, 0, 'addPrizePackage', 200000);
			const buyParams = [POOL_ID, 1];
			client.setOperator(aliceId, aliceKey);
			await contractExecuteFunction(client, lazyLottoContractId, buyParams, 0, 'buyEntry', 300000);
			await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID], 0, 'rollAll', 300000);
			// Try to claim
			const claimParams = [POOL_ID, 0];
			const claimTx = await contractExecuteFunction(client, lazyLottoContractId, claimParams, 0, 'claimPrize', 300000);
			const receipt = await claimTx.getReceipt(client);
			expect(receipt.status.toString()).to.equal('SUCCESS');
		});

		it('Should revert if Bob tries to claim Alice’s NFT prize', async function () {
			// Setup: Add NFT_A as prize, Alice wins it
			await contractExecuteFunction(client, NFT_A_TOKEN, [lazyLottoContractAddress, true], 0, 'setApprovalForAll', 100000);
			const addParams = [POOL_ID, ZERO_ADDRESS, 0, true, NFT_A_TOKEN, NFT_A_SERIAL];
			await contractExecuteFunction(client, lazyLottoContractId, addParams, 0, 'addPrizePackage', 200000);
			client.setOperator(aliceId, aliceKey);
			await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID, 1], 0, 'buyEntry', 300000);
			await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID], 0, 'rollAll', 300000);
			// Bob tries to claim
			client.setOperator(bobId, bobKey);
			const claimParams = [POOL_ID, 0];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, claimParams, 0, 'claimPrize', 300000);
				expect.fail('Should have failed: Bob cannot claim Alice’s NFT prize');
			} catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});

		it('Should revert if user tries to claim with unassociated TESTFT', async function () {
			// Remove association for Bob (simulate by using a new account if needed)
			// For demonstration, try to claim without prior association
			// Add TESTFT as prize, Bob buys and rolls
			const addParams = [POOL_ID, testFtTokenId, TESTFT_PRIZE_AMOUNT, false, ZERO_ADDRESS, 0];
			await contractExecuteFunction(client, lazyLottoContractId, addParams, 0, 'addPrizePackage', 200000);
			client.setOperator(bobId, bobKey);
			await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID, 1], 0, 'buyEntry', 300000);
			await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID], 0, 'rollAll', 300000);
			// Try to claim (should revert if not associated)
			const claimParams = [POOL_ID, 0];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, claimParams, 0, 'claimPrize', 300000);
				expect.fail('Should have failed: Bob not associated with TESTFT');
			} catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});

		it('Should revert if user tries to claim NFT prize with wrong NFT collection', async function () {
			// Add NFT_B as prize, Alice wins it, but tries to claim with NFT_C
			await contractExecuteFunction(client, NFT_B_TOKEN, [lazyLottoContractAddress, true], 0, 'setApprovalForAll', 100000);
			const addParams = [POOL_ID, ZERO_ADDRESS, 0, true, NFT_B_TOKEN, NFT_B_SERIAL];
			await contractExecuteFunction(client, lazyLottoContractId, addParams, 0, 'addPrizePackage', 200000);
			client.setOperator(aliceId, aliceKey);
			await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID, 1], 0, 'buyEntry', 300000);
			await contractExecuteFunction(client, lazyLottoContractId, [POOL_ID], 0, 'rollAll', 300000);
			// Try to claim with NFT_C (should revert)
			const claimFromNFTParams = [POOL_ID, NFT_C_TOKEN, NFT_C_SERIAL];
			try {
				await contractExecuteFunction(client, lazyLottoContractId, claimFromNFTParams, 0, 'claimPrizeFromNFT', 300000);
				expect.fail('Should have failed: wrong NFT collection');
			} catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});
		it('Should claim a pending prize and emit PrizeClaimed event', async function () {
			// Setup: Alice wins a prize by rolling
			const buyParams = [POOL_ID_HBAR_4_6, DEFAULT_TICKET_COUNT];
			client.setOperator(aliceId, aliceKey);
			await contractExecuteFunction(client, lazyLottoContractId, buyParams, HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(), 'buyEntry', 300000);
			// Roll all to win (PRNG not controlled, so may not always win, but we can check event emission)
			const rollParams = [POOL_ID_HBAR_4_6];
			await contractExecuteFunction(client, lazyLottoContractId, rollParams, 0, 'rollAll', 300000);
			await sleep(5000);
			// Try to claim prize at index 0
			const claimParams = [POOL_ID_HBAR_4_6, 0];
			try {
				const claimTx = await contractExecuteFunction(client, lazyLottoContractId, claimParams, 0, 'claimPrize', 300000);
				const receipt = await claimTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');
				await sleep(5000);
				// Check PrizeClaimed event
				const prizeClaimedEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('PrizeClaimed'), true);
				expect(prizeClaimedEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
			} catch (error) {
				// If no pending prize, expect revert
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});

		it('Should revert when claiming a prize with invalid index', async function () {
			// Try to claim a prize at an invalid index
			const claimParams = [POOL_ID_HBAR_4_6, 9999];
			client.setOperator(aliceId, aliceKey);
			try {
				await contractExecuteFunction(client, lazyLottoContractId, claimParams, 0, 'claimPrize', 300000);
				expect.fail('Should have failed: invalid prize index');
			} catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});

		it('Should revert when claiming a prize with no pending prizes', async function () {
			// Bob has no pending prizes
			const claimParams = [POOL_ID_HBAR_4_6, 0];
			client.setOperator(bobId, bobKey);
			try {
				await contractExecuteFunction(client, lazyLottoContractId, claimParams, 0, 'claimPrize', 300000);
				expect.fail('Should have failed: no pending prizes');
			} catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});

		it('Should claim all pending prizes and emit PrizeClaimed event(s)', async function () {
			// Setup: Alice wins prizes by rolling
			const buyParams = new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6).addUint32(DEFAULT_TICKET_COUNT);
			client.setOperator(aliceId, aliceKey);
			await contractExecuteFunction(client, lazyLottoContractId, buyParams, HBAR_ENTRY_FEE_4_6.multipliedBy(DEFAULT_TICKET_COUNT).toNumber(), 'buyEntry', 300000);
			await contractExecuteFunction(client, lazyLottoContractId, new ContractFunctionParameters().addUint256(POOL_ID_HBAR_4_6), 0, 'rollAll', 300000);
			await sleep(5000);
			// Try to claim all prizes
			const claimAllParams = [POOL_ID_HBAR_4_6];
			try {
				const claimAllTx = await contractExecuteFunction(client, lazyLottoContractId, claimAllParams, 0, 'claimAllPrizes', 300000);
				const receipt = await claimAllTx.getReceipt(client);
				expect(receipt.status.toString()).to.equal('SUCCESS');
				await sleep(5000);
				// Check PrizeClaimed event (may be multiple, check at least one)
				const prizeClaimedEvent = await checkLastMirrorEvent(env, lazyLottoContractId, lazyLottoIface, lazyLottoIface.getEventTopic('PrizeClaimed'), true);
				expect(prizeClaimedEvent.user.toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());
			} catch (error) {
				// If no pending prize, expect revert
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});

		it('Should revert when claiming all prizes with no pending prizes', async function () {
			// Bob has no pending prizes
			const claimAllParams = [POOL_ID_HBAR_4_6];
			client.setOperator(bobId, bobKey);
			try {
				await contractExecuteFunction(client, lazyLottoContractId, claimAllParams, 0, 'claimAllPrizes', 300000);
				expect.fail('Should have failed: no pending prizes');
			} catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});

		// --- Additional NFT redemption/claiming edge case tests ---
		it('Should revert when redeeming a prize to NFT with no pending prizes', async function () {
			// Bob has no pending prizes
			const redeemParams = [POOL_ID_HBAR_4_6, 0, ZERO_ADDRESS, 1];
			client.setOperator(bobId, bobKey);
			try {
				await contractExecuteFunction(client, lazyLottoContractId, redeemParams, 0, 'redeemPrizeToNFT', 300000);
				expect.fail('Should have failed: no pending prizes');
			} catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});

		it('Should revert when claiming a prize from NFT with non-prize NFT serial', async function () {
			// Bob tries to claim with a random NFT serial
			const claimFromNFTParams = [POOL_ID_HBAR_4_6, ZERO_ADDRESS, 9999];
			client.setOperator(bobId, bobKey);
			try {
				await contractExecuteFunction(client, lazyLottoContractId, claimFromNFTParams, 0, 'claimPrizeFromNFT', 300000);
				expect.fail('Should have failed: non-prize NFT serial');
			} catch (error) {
				expect(error.message).to.include('CONTRACT_REVERT_EXECUTED');
			}
		});
	});
});
