/**
 * LazyLotto Withdraw Tokens Script
 *
 * Withdraw excess HBAR or fungible tokens from storage contract.
 * Includes safety checks to prevent withdrawing tokens allocated for prizes.
 * Requires ADMIN role.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/withdrawTokens.js
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
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
const storageContractId = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE_CONTRACT_ID);

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

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR';
	}

	const { homebrewPopulateAccountNum } = require('../../../utils/hederaMirrorHelpers');
	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

async function withdrawTokens() {
	let client;

	try {
		// Initialize client
		if (env.toUpperCase() === 'MAINNET') {
			client = Client.forMainnet();
		}
		else if (env.toUpperCase() === 'TESTNET') {
			client = Client.forTestnet();
		}
		else if (env.toUpperCase() === 'PREVIEWNET') {
			client = Client.forPreviewnet();
		}
		else {
			throw new Error(`Unknown environment: ${env}`);
		}

		client.setOperator(operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║          LazyLotto Withdraw Tokens (Admin)                ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`💾 Storage: ${storageContractId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../utils/gasHelpers');
		const { homebrewGetBalance, queryTokenBalance } = require('../../../utils/hederaMirrorHelpers');

		// Menu
		console.log('Select token type to withdraw:');
		console.log('1. HBAR');
		console.log('2. Fungible Token');

		const choice = await prompt('\nEnter choice (1-2): ');

		let functionName, params, tokenType;

		if (choice === '1') {
			// HBAR withdrawal
			console.log('\n💰 Withdraw HBAR\n');

			// Get storage contract HBAR balance
			const storageBalance = await homebrewGetBalance(env, storageContractId.toString());
			console.log(`Storage contract balance: ${ethers.formatEther(storageBalance)} ℏ\n`);

			const amountStr = await prompt('Enter amount to withdraw (HBAR): ');

			let amount;
			try {
				amount = ethers.parseEther(amountStr);
			}
			catch {
				console.error('❌ Invalid amount format');
				process.exit(1);
			}

			if (amount > storageBalance) {
				console.error(`❌ Insufficient balance in storage. Available: ${ethers.formatEther(storageBalance)} ℏ`);
				process.exit(1);
			}

			// Get recipient
			const recipientInput = await prompt('Enter recipient account (0.0.xxxxx) or EVM address: ');

			let recipientAddress;
			if (recipientInput.startsWith('0x')) {
				recipientAddress = recipientInput;
			}
			else {
				try {
					const accountId = AccountId.fromString(recipientInput);
					recipientAddress = accountId.toSolidityAddress();
				}
				catch {
					console.error('❌ Invalid account ID format');
					process.exit(1);
				}
			}

			functionName = 'transferHbarFromStorage';
			params = [recipientAddress, amount];
			tokenType = 'HBAR';

			console.log('\nWithdrawal:');
			console.log(`  Amount: ${ethers.formatEther(amount)} ℏ`);
			console.log(`  To: ${recipientInput}\n`);
		}
		else if (choice === '2') {
			// Fungible token withdrawal
			console.log('\n🪙 Withdraw Fungible Token\n');

			const tokenInput = await prompt('Enter token ID (0.0.xxxxx) or EVM address: ');

			let tokenAddress;
			let tokenId;
			if (tokenInput.startsWith('0x')) {
				tokenAddress = tokenInput;
				const hederaId = await convertToHederaId(tokenAddress);
				tokenId = TokenId.fromString(hederaId);
			}
			else {
				try {
					tokenId = TokenId.fromString(tokenInput);
					tokenAddress = tokenId.toSolidityAddress();
				}
				catch {
					console.error('❌ Invalid token ID format');
					process.exit(1);
				}
			}

			// Get token info from storage contract
			const storageBalance = await queryTokenBalance(env, storageContractId.toString(), tokenId.toString());
			console.log(`Storage contract balance: ${storageBalance.toString()} units`);

			// Check ftTokensForPrizes
			const encodedQuery = lazyLottoIface.encodeFunctionData('ftTokensForPrizes', [tokenAddress]);
			const allocatedForPrizes = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				encodedQuery,
				lazyLottoIface,
				'ftTokensForPrizes',
				false,
			);

			console.log(`Allocated for prizes: ${allocatedForPrizes.toString()} units`);

			const available = storageBalance - allocatedForPrizes;
			console.log(`Available to withdraw: ${available.toString()} units\n`);

			if (available <= 0n) {
				console.error('❌ No excess tokens available to withdraw');
				process.exit(1);
			}

			const amountStr = await prompt(`Enter amount to withdraw (max ${available.toString()}): `);

			let amount;
			try {
				amount = BigInt(amountStr);
			}
			catch {
				console.error('❌ Invalid amount format');
				process.exit(1);
			}

			if (amount > available) {
				console.error(`❌ Amount exceeds available balance. Max: ${available.toString()}`);
				process.exit(1);
			}

			// Get recipient
			const recipientInput = await prompt('Enter recipient account (0.0.xxxxx) or EVM address: ');

			let recipientAddress;
			if (recipientInput.startsWith('0x')) {
				recipientAddress = recipientInput;
			}
			else {
				try {
					const accountId = AccountId.fromString(recipientInput);
					recipientAddress = accountId.toSolidityAddress();
				}
				catch {
					console.error('❌ Invalid account ID format');
					process.exit(1);
				}
			}

			functionName = 'transferFungible';
			params = [tokenAddress, recipientAddress, amount];
			tokenType = tokenId.toString();

			console.log('\nWithdrawal:');
			console.log(`  Token: ${tokenType}`);
			console.log(`  Amount: ${amount.toString()} units`);
			console.log(`  To: ${recipientInput}\n`);
		}
		else {
			console.error('❌ Invalid choice');
			process.exit(1);
		}

		// Estimate gas
		const encodedCommand = lazyLottoIface.encodeFunctionData(functionName, params);
		const gasEstimate = await estimateGas(env, contractId, encodedCommand, operatorId);
		console.log(`⛽ Estimated gas: ~${gasEstimate} gas\n`);

		// Confirm
		console.log('⚠️  Ensure this will not affect prize fulfillment!');
		const confirm = await prompt('Proceed with withdrawal? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Withdrawing tokens...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [success, txReceipt] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			functionName,
			params,
		);

		if (!success) {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Tokens withdrawn successfully!');
		console.log(`📋 Transaction: ${txReceipt.transactionId.toString()}\n`);

	}
	catch (error) {
		console.error('\n❌ Error withdrawing tokens:', error.message);
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

// Run the script
withdrawTokens();
