const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../utils/nodeHelpers');
const { getBaseURL } = require('../../../utils/hederaMirrorHelpers');
const axios = require('axios');

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'LazyDelegateRegistry';
const delegateRegistryId = process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID;
const env = process.env.ENVIRONMENT ?? null;
let client;

/**
 * Helper to get token name from mirror node
 * @param {TokenId|string} tokenId Token ID to lookup
 * @returns {Promise<string>} Token name
 */
async function getTokenName(tokenId) {
	try {
		const baseUrl = getBaseURL(env);
		const url = `${baseUrl}/api/v1/tokens/${tokenId.toString()}`;
		const response = await axios.get(url);
		return response.data.name;
	}
	catch (error) {
		console.error(`Error getting token name: ${error.message}`);
		return 'Unknown token';
	}
}

/**
 * Main function
 */
const main = async () => {
	// Check for required environment variables
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

	// Make sure we have a delegate registry contract ID
	if (!delegateRegistryId) {
		console.log('ERROR: LAZY_DELEGATE_REGISTRY_CONTRACT_ID not specified in .env file');
		process.exit(1);
	}

	// Set up the client based on environment
	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('Using *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('Using *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('Using *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('Using *LOCAL*');
	}
	else {
		console.log('ERROR: Must specify either MAIN, TEST, PREVIEW, or LOCAL as ENVIRONMENT in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Get command line arguments
	const args = process.argv.slice(2);
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: node checkDelegations.js <address>');
		console.log('       <address> is the account ID to check delegations for (e.g., 0.0.123456)');
		return;
	}

	// Parse the provided address
	let targetAddress;
	try {
		targetAddress = AccountId.fromString(args[0]);
		console.log(`\n-Checking delegations for account: ${targetAddress.toString()}`);
	}
	catch (error) {
		console.log(`Error parsing address: ${error.message}`);
		console.log('Please provide a valid Hedera account ID (e.g., 0.0.123456)');
		return;
	}

	// Get Delegate Registry contract interface
	const contractId = ContractId.fromString(delegateRegistryId);
	console.log(`\n-Using Delegate Registry contract: ${contractId.toString()}`);

	const ldrJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const ldrIface = new ethers.Interface(ldrJSON.abi);

	// 1. Check if any wallets have been delegated to this address
	console.log(`\n--- Checking for wallet delegations to ${targetAddress.toString()} ---`);
	const walletsDelegatedCommand = ldrIface.encodeFunctionData('getWalletsDelegatedTo', [
		targetAddress.toSolidityAddress(),
	]);

	const walletsDelegatedResult = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		walletsDelegatedCommand,
		operatorId,
		false,
	);

	const walletsDelegated = ldrIface.decodeFunctionResult(
		'getWalletsDelegatedTo',
		walletsDelegatedResult,
	);

	if (walletsDelegated[0].length === 0) {
		console.log('No wallets have been delegated to this address.');
	}
	else {
		console.log('Wallets delegated to this address:');
		walletsDelegated[0].forEach(wallet => {
			const accountId = AccountId.fromEvmAddress(0, 0, wallet);
			console.log(`- ${accountId.toString()}`);
		});
	}

	// 2. Check for NFT delegations to this address
	console.log(`\n--- Checking for NFT delegations to ${targetAddress.toString()} ---`);
	const nftsDelegatedCommand = ldrIface.encodeFunctionData('getNFTsDelegatedTo', [
		targetAddress.toSolidityAddress(),
	]);

	const nftsDelegatedResult = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		nftsDelegatedCommand,
		operatorId,
		false,
	);

	const nftsDelegated = ldrIface.decodeFunctionResult(
		'getNFTsDelegatedTo',
		nftsDelegatedResult,
	);

	const tokens = nftsDelegated[0];
	const serials = nftsDelegated[1];

	if (tokens.length === 0) {
		console.log('No NFTs have been delegated to this address.');
	}
	else {
		console.log('NFTs delegated to this address:');
		for (let i = 0; i < tokens.length; i++) {
			const tokenId = AccountId.fromEvmAddress(0, 0, tokens[i]);
			const tokenName = await getTokenName(env, tokenId);

			console.log(`\nToken: ${tokenId.toString()} (${tokenName})`);
			console.log('Serials:');

			if (serials[i].length === 0) {
				console.log('  No serials found');
			}
			else {
				// Display serials in groups of 10 for readability
				const serialGroups = [];
				for (let j = 0; j < serials[i].length; j += 10) {
					serialGroups.push(serials[i].slice(j, j + 10).map(s => s.toString()).join(', '));
				}
				serialGroups.forEach((group, index) => {
					console.log(`  ${index * 10 + 1}-${Math.min((index + 1) * 10, serials[i].length)}: ${group}`);
				});

				// Check if the user wants to validate the delegations
				if (serials[i].length > 0) {
					const checkValidity = readlineSync.keyInYNStrict('Do you want to check if these delegations are still valid?');
					if (checkValidity) {
						console.log('\nChecking delegation validity...');
						const validityCommand = ldrIface.encodeFunctionData('checkNFTDelegationIsValidBatch', [
							[tokens[i]],
							[serials[i]],
						]);

						try {
							const validityResult = await readOnlyEVMFromMirrorNode(
								env,
								contractId,
								validityCommand,
								operatorId,
								false,
							);

							const validityData = ldrIface.decodeFunctionResult(
								'checkNFTDelegationIsValidBatch',
								validityResult,
							);

							const validities = validityData[0][0];

							let validCount = 0;
							let invalidCount = 0;

							console.log('\nValidity results:');
							for (let j = 0; j < validities.length; j++) {
								if (validities[j]) {
									validCount++;
								}
								else {
									invalidCount++;
									console.log(`  Serial ${serials[i][j].toString()} is no longer valid`);
								}
							}

							console.log(`\nSummary: ${validCount} valid, ${invalidCount} invalid delegations`);
						}
						catch (error) {
							console.log(`Error checking validity: ${error}`);
						}
					}
				}
			}
		}
	}

	// 3. Allow querying for a specific token
	const checkSpecificToken = readlineSync.keyInYNStrict('Do you want to check delegations for a specific token?');
	if (checkSpecificToken) {
		const tokenIdStr = readlineSync.question('Enter token ID (e.g., 0.0.123456): ');

		try {
			const tokenId = TokenId.fromString(tokenIdStr);
			console.log(`\nChecking delegations for token ${tokenId.toString()}...`);

			const serialsCommand = ldrIface.encodeFunctionData('getSerialsDelegatedTo', [
				targetAddress.toSolidityAddress(),
				tokenId.toSolidityAddress(),
			]);

			const serialsResult = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				serialsCommand,
				operatorId,
				false,
			);

			const serialsDelegated = ldrIface.decodeFunctionResult(
				'getSerialsDelegatedTo',
				serialsResult,
			);

			if (serialsDelegated[0].length === 0) {
				console.log('No serials of this token are delegated to this address.');
			}
			else {
				const tokenName = await getTokenName(env, tokenId);
				console.log(`\nToken: ${tokenId.toString()} (${tokenName})`);
				console.log('Delegated serials:');

				// Display serials in groups of 10 for readability
				const serialGroups = [];
				for (let j = 0; j < serialsDelegated[0].length; j += 10) {
					serialGroups.push(serialsDelegated[0].slice(j, j + 10).map(s => s.toString()).join(', '));
				}
				serialGroups.forEach((group, index) => {
					console.log(`  ${index * 10 + 1}-${Math.min((index + 1) * 10, serialsDelegated[0].length)}: ${group}`);
				});
			}
		}
		catch (error) {
			console.log(`Error: ${error.message}`);
		}
	}
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});