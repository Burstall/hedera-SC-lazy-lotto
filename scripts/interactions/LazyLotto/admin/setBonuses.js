/**
 * LazyLotto Set Bonuses Script
 *
 * Configure win rate boost bonuses:
 * - Time-based bonuses (start/end/bps)
 * - NFT holder bonuses (token/bps)
 * - LAZY balance bonuses (threshold/bps)
 *
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/setBonuses.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/setBonuses.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/setBonuses.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
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

const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

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

async function setBonuses() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
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
		console.log('║           LazyLotto Set Bonuses (Admin)                   ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Menu
		console.log('Select bonus type to configure:');
		console.log('1. Time Bonus (start time, end time, BPS)');
		console.log('2. NFT Holder Bonus (token, BPS)');
		console.log('3. LAZY Balance Bonus (threshold, BPS)');

		const choice = await prompt('\nEnter choice (1-3): ');

		let functionName, params;

		switch (choice) {
		case '1': {
			// Time bonus
			console.log('\n⏰ Configure Time Bonus\n');
			console.log('Enter 0 for start/end to disable bonus\n');

			const startStr = await prompt('Enter start timestamp (seconds): ');
			const endStr = await prompt('Enter end timestamp (seconds): ');
			const bpsStr = await prompt('Enter bonus BPS (0-10000, e.g., 100 = 1%): ');

			const start = BigInt(startStr);
			const end = BigInt(endStr);
			const bps = parseInt(bpsStr);

			if (bps < 0 || bps > 10000) {
				console.error('❌ BPS must be between 0 and 10000');
				process.exit(1);
			}

			functionName = 'setTimeBonus';
			params = [start, end, bps];

			console.log('\nConfiguration:');
			console.log(`  Start: ${start === 0n ? 'Disabled' : new Date(Number(start) * 1000).toISOString()}`);
			console.log(`  End: ${end === 0n ? 'Disabled' : new Date(Number(end) * 1000).toISOString()}`);
			console.log(`  Bonus: ${bps / 100}%\n`);
			break;
		}

		case '2': {
			// NFT bonus
			console.log('\n🎨 Configure NFT Holder Bonus\n');
			console.log('Enter 0x0 for token to disable bonus\n');

			const tokenInput = await prompt('Enter NFT token ID (0.0.xxxxx) or EVM address: ');
			const bpsStr = await prompt('Enter bonus BPS (0-10000, e.g., 100 = 1%): ');

			let tokenAddress;
			if (tokenInput.startsWith('0x')) {
				tokenAddress = tokenInput;
			}
			else {
				try {
					const tokenId = TokenId.fromString(tokenInput);
					tokenAddress = tokenId.toSolidityAddress();
				}
				catch {
					console.error('❌ Invalid token ID format');
					process.exit(1);
				}
			}

			const bps = parseInt(bpsStr);

			if (bps < 0 || bps > 10000) {
				console.error('❌ BPS must be between 0 and 10000');
				process.exit(1);
			}

			functionName = 'setNFTBonus';
			params = [tokenAddress, bps];

			console.log('\nConfiguration:');
			console.log(`  Token: ${tokenInput}`);
			console.log(`  Bonus: ${bps / 100}%\n`);
			break;
		}

		case '3': {
			// LAZY balance bonus
			console.log('\n💎 Configure LAZY Balance Bonus\n');
			console.log('Enter 0 for threshold to disable bonus\n');

			const thresholdStr = await prompt('Enter LAZY balance threshold (tokens): ');
			const bpsStr = await prompt('Enter bonus BPS (0-10000, e.g., 100 = 1%): ');

			let threshold;
			try {
				// LAZY has 8 decimals
				threshold = ethers.parseUnits(thresholdStr, 8);
			}
			catch {
				console.error('❌ Invalid threshold format');
				process.exit(1);
			}

			const bps = parseInt(bpsStr);

			if (bps < 0 || bps > 10000) {
				console.error('❌ BPS must be between 0 and 10000');
				process.exit(1);
			}

			functionName = 'setLazyBalanceBonus';
			params = [threshold, bps];

			console.log('\nConfiguration:');
			console.log(`  Threshold: ${ethers.formatUnits(threshold, 8)} LAZY`);
			console.log(`  Bonus: ${bps / 100}%\n`);
			break;
		}

		default:
			console.error('❌ Invalid choice');
			process.exit(1);
		}

		// Confirm
		const confirm = await prompt('Apply bonus configuration? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Setting bonus...');

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: functionName,
			params: params,
			gas: 150000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ Bonus configured successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error setting bonus:', error.message);
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
setBonuses();
