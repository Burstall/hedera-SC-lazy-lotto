/**
 * LazyLotto Add Prize Package Script
 *
 * Adds prizes to a lottery pool. Supports:
 * - Single prize package (FT + NFTs)
 * - Multiple fungible prizes (batch)
 *
 * Requires ADMIN or PRIZE_MANAGER role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/addPrizePackage.js [poolId]
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

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

// Helper: Convert address formats
function convertToEvmAddress(hederaId) {
	if (hederaId.startsWith('0x')) return hederaId;
	const parts = hederaId.split('.');
	const num = parts[parts.length - 1];
	return '0x' + BigInt(num).toString(16).padStart(40, '0');
}

async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	return await homebrewPopulateAccountNum(env, evmAddress);
}

// Helper: Format HBAR
function formatHbar(tinybars) {
	return (Number(tinybars) / 100_000_000).toFixed(8) + ' ℏ';
}

async function addPrizePackage() {
	let client;

	try {
		// Get pool ID
		let poolIdStr = process.argv[2];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Normalize environment name to accept TEST/TESTNET, MAIN/MAINNET, PREVIEW/PREVIEWNET
		const envUpper = env.toUpperCase();

		// Initialize client
		if (envUpper === 'MAINNET' || envUpper === 'MAIN') {
			client = Client.forMainnet();
		}
		else if (envUpper === 'TESTNET' || envUpper === 'TEST') {
			client = Client.forTestnet();
		}
		else if (envUpper === 'PREVIEWNET' || envUpper === 'PREVIEW') {
			client = Client.forPreviewnet();
		}
		else {
			throw new Error(`Unknown environment: ${env}. Use TESTNET, MAINNET, or PREVIEWNET`);
		}

		client.setOperator(operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Add Prize Package (Admin)              ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

		// Check admin or prize manager role
		console.log('🔍 Verifying permissions...');
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();

		let encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [userEvmAddress]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const hasAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', result);

		encodedCommand = lazyLottoIface.encodeFunctionData('isPrizeManager', [userEvmAddress]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isPrizeManager = lazyLottoIface.decodeFunctionResult('isPrizeManager', result);

		if (!hasAdmin[0] && !isPrizeManager[0]) {
			console.error('❌ You do not have ADMIN or PRIZE_MANAGER role');
			process.exit(1);
		}

		console.log(`✅ Role verified: ${hasAdmin[0] ? 'ADMIN' : 'PRIZE_MANAGER'}\n`);

		// Get pool details
		encodedCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [poolId]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolDetails', result);

		if (poolDetails.closed) {
			console.error('❌ Pool is closed. Cannot add prizes.');
			process.exit(1);
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool Token:       ${await convertToHederaId(poolDetails.poolTokenId)}`);
		console.log(`  Current Prizes:   ${poolDetails.prizes.length}`);
		console.log(`  State:            ${poolDetails.paused ? 'PAUSED' : 'ACTIVE'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Ask for prize type
		const prizeType = await prompt('Add (1) Single prize package or (2) Multiple fungible prizes? (1/2): ');

		if (prizeType === '2') {
			await addMultipleFungiblePrizes(client, lazyLottoIface, poolId);
		}
		else {
			await addSinglePrizePackage(client, lazyLottoIface, poolId);
		}

	}
	catch (error) {
		console.error('\n❌ Error adding prize:', error.message);
		if (error.status) {
			console.error('Status:', error.status.toString());
		}
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

async function addSinglePrizePackage(client, lazyLottoIface, poolId) {
	const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
	const { estimateGas } = require('../../../../utils/gasHelpers');
	const { getSerialsOwned } = require('../../../../utils/hederaMirrorHelpers');

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  SINGLE PRIZE PACKAGE');
	console.log('═══════════════════════════════════════════════════════════\n');

	// Get FT component
	const ftTokenStr = await prompt('Enter FT token (0.0.xxxxx or "HBAR" or "none"): ');
	let ftToken = '0x0000000000000000000000000000000000000000';
	let ftAmount = '0';

	if (ftTokenStr.toLowerCase() !== 'none') {
		if (ftTokenStr.toUpperCase() === 'HBAR') {
			ftToken = '0x0000000000000000000000000000000000000000';
		}
		else {
			ftToken = convertToEvmAddress(ftTokenStr);
		}

		const amountStr = await prompt('Enter FT amount: ');
		ftAmount = amountStr;

		if (isNaN(Number(ftAmount)) || Number(ftAmount) <= 0) {
			console.error('❌ Invalid FT amount');
			process.exit(1);
		}
	}

	// Get NFT components
	const nftTokens = [];
	const nftSerials = [];

	const includeNfts = await prompt('Include NFTs in this prize? (yes/no): ');

	if (includeNfts.toLowerCase() === 'yes' || includeNfts.toLowerCase() === 'y') {
		let addingNfts = true;

		while (addingNfts) {
			const nftTokenStr = await prompt('Enter NFT token ID (0.0.xxxxx): ');
			const nftToken = nftTokenStr;

			const serialsStr = await prompt('Enter serial numbers (comma-separated): ');
			const serialsArray = serialsStr.split(',').map(s => s.trim());

			// Verify ownership
			const ownedSerials = await getSerialsOwned(env, operatorId.toString(), nftToken);

			for (const serial of serialsArray) {
				const serialNum = parseInt(serial);
				if (!ownedSerials.includes(serialNum)) {
					console.error(`❌ You don't own serial #${serialNum} of ${nftToken}`);
					process.exit(1);
				}
			}

			nftTokens.push(convertToEvmAddress(nftToken));
			nftSerials.push(serialsArray.map(s => parseInt(s)));

			const addMore = await prompt('Add another NFT collection to this prize? (yes/no): ');
			addingNfts = addMore.toLowerCase() === 'yes' || addMore.toLowerCase() === 'y';
		}
	}

	// Validate at least one component
	if (ftAmount === '0' && nftTokens.length === 0) {
		console.error('❌ Prize must contain at least FT amount or NFTs');
		process.exit(1);
	}

	// Display summary
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  PRIZE SUMMARY');
	console.log('═══════════════════════════════════════════════════════════');

	if (ftAmount !== '0') {
		const tokenId = await convertToHederaId(ftToken);
		console.log(`  FT:   ${tokenId === 'HBAR' ? formatHbar(ftAmount) : `${ftAmount} ${tokenId}`}`);
	}

	if (nftTokens.length > 0) {
		console.log(`  NFTs: ${nftTokens.length} collection(s)`);
		for (let i = 0; i < nftTokens.length; i++) {
			const tokenId = await convertToHederaId(nftTokens[i]);
			console.log(`        - ${tokenId}: ${nftSerials[i].length} serial(s)`);
		}
	}

	console.log('═══════════════════════════════════════════════════════════\n');

	// Estimate gas
	console.log('⛽ Estimating gas...');
	const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'addPrizePackage', [
		poolId,
		ftToken,
		ftAmount,
		nftTokens,
		nftSerials,
	], 800000, ftToken === '0x0000000000000000000000000000000000000000' ? ftAmount : '0');
	const gasEstimate = gasInfo.gasLimit;
	console.log(`   Gas: ~${gasEstimate}\n`);

	// Calculate HBAR needed
	const payableAmount = ftToken === '0x0000000000000000000000000000000000000000' ? ftAmount : '0';
	if (payableAmount !== '0') {
		console.log(`💰 HBAR required: ${formatHbar(payableAmount)}\n`);
	}

	// Confirm
	const confirm = await prompt('Proceed with adding prize? (yes/no): ');
	if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
		console.log('\n❌ Operation cancelled');
		process.exit(0);
	}

	// Execute
	console.log('\n🔄 Adding prize package...');

	const gasLimit = Math.floor(gasEstimate * 1.2);

	const [receipt, results, record] = await contractExecuteFunction(
		contractId,
		lazyLottoIface,
		client,
		gasLimit,
		'addPrizePackage',
		[poolId, ftToken, ftAmount, nftTokens, nftSerials],
		payableAmount,
	);

	if (receipt.status.toString() !== 'SUCCESS') {
		console.error('\n❌ Transaction failed');
		process.exit(1);
	}

	console.log('\n✅ Prize package added successfully!');
	console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);
}

async function addMultipleFungiblePrizes(client, lazyLottoIface, poolId) {
	const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
	const { estimateGas } = require('../../../../utils/gasHelpers');

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  MULTIPLE FUNGIBLE PRIZES');
	console.log('═══════════════════════════════════════════════════════════\n');

	// Get token
	const tokenStr = await prompt('Enter token (0.0.xxxxx or "HBAR"): ');
	let token;

	if (tokenStr.toUpperCase() === 'HBAR') {
		token = '0x0000000000000000000000000000000000000000';
	}
	else {
		token = convertToEvmAddress(tokenStr);
	}

	// Get amounts
	const amountsStr = await prompt('Enter amounts (comma-separated): ');
	const amounts = amountsStr.split(',').map(s => s.trim());

	if (amounts.length === 0) {
		console.error('❌ Must provide at least one amount');
		process.exit(1);
	}

	// Validate amounts
	for (const amount of amounts) {
		if (isNaN(Number(amount)) || Number(amount) <= 0) {
			console.error(`❌ Invalid amount: ${amount}`);
			process.exit(1);
		}
	}

	const totalAmount = amounts.reduce((sum, amt) => sum + BigInt(amt), BigInt(0));

	// Display summary
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  PRIZES SUMMARY');
	console.log('═══════════════════════════════════════════════════════════');
	const tokenId = await convertToHederaId(token);
	console.log(`  Token:         ${tokenId}`);
	console.log(`  Prize Count:   ${amounts.length}`);
	console.log(`  Total Amount:  ${tokenId === 'HBAR' ? formatHbar(totalAmount) : totalAmount.toString()}`);
	console.log('═══════════════════════════════════════════════════════════\n');

	// Estimate gas
	console.log('⛽ Estimating gas...');
	const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'addMultipleFungiblePrizes', [
		poolId,
		token,
		amounts,
	], 800000, payableAmount);
	const gasEstimate = gasInfo.gasLimit;
	console.log(`   Gas: ~${gasEstimate}\n`);

	// Calculate HBAR needed
	const payableAmount = token === '0x0000000000000000000000000000000000000000' ? totalAmount.toString() : '0';
	if (payableAmount !== '0') {
		console.log(`💰 HBAR required: ${formatHbar(payableAmount)}\n`);
	}

	// Confirm
	const confirm = await prompt('Proceed with adding prizes? (yes/no): ');
	if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
		console.log('\n❌ Operation cancelled');
		process.exit(0);
	}

	// Execute
	console.log('\n🔄 Adding prizes...');

	const gasLimit = Math.floor(gasEstimate * 1.2);

	const [receipt, results, record] = await contractExecuteFunction(
		contractId,
		lazyLottoIface,
		client,
		gasLimit,
		'addMultipleFungiblePrizes',
		[poolId, token, amounts],
		payableAmount,
	);

	if (receipt.status.toString() !== 'SUCCESS') {
		console.error('\n❌ Transaction failed');
		process.exit(1);
	}

	console.log('\n✅ Prizes added successfully!');
	console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);
}

// Run the script
addPrizePackage();
