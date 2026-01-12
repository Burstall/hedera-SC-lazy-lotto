/**
 * LazyLotto Migrate Bonuses Script
 *
 * Batch migration of bonus configurations from LazyLotto Storage to PoolManager.
 * Used when setting up PoolManager with existing bonus configurations.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/migrateBonuses.js [--config <path>]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/migrateBonuses.js [--config <path>] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/migrateBonuses.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 *
 * Config file format (JSON):
 * {
 *   "timeBonuses": [
 *     { "threshold": 86400, "multiplier": 110 },
 *     { "threshold": 2592000, "multiplier": 125 }
 *   ],
 *   "nftBonuses": [
 *     { "address": "0.0.1234", "multiplier": 115 }
 *   ],
 *   "lazyBalanceBonus": { "threshold": 1000000, "multiplier": 105 }
 * }
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

const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);

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

// Helper: Sleep
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Default bonus configuration (example values)
const DEFAULT_CONFIG = {
	timeBonuses: [
		// 1 day: 10% bonus
		{ threshold: 86400, multiplier: 110 },
		// 7 days: 15% bonus
		{ threshold: 604800, multiplier: 115 },
		// 30 days: 25% bonus
		{ threshold: 2592000, multiplier: 125 },
		// 90 days: 50% bonus
		{ threshold: 7776000, multiplier: 150 },
	],
	nftBonuses: [
		// Example: { address: "0.0.1234", multiplier: 115 }
		// Add NFT collection IDs and their bonus multipliers here
	],
	lazyBalanceBonus: {
		// 1M LAZY tokens (adjust for decimals)
		threshold: 1000000,
		// 5% bonus
		multiplier: 105,
	},
};

async function migrateBonuses() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let configPath = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--config' && args[i + 1]) {
				configPath = args[i + 1];
				i++;
			}
		}

		// Normalize environment name
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
		console.log('║         LazyLotto Migrate Bonuses (Admin)                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load configuration
		let config;
		if (configPath) {
			console.log(`📄 Loading config from: ${configPath}\n`);
			try {
				config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
			}
			catch (e) {
				console.error('❌ Failed to load config file:', e.message);
				process.exit(1);
			}
		}
		else {
			console.log('📄 Using default configuration (no --config provided)\n');
			config = DEFAULT_CONFIG;
		}

		// Validate configuration
		if (!config.timeBonuses || !Array.isArray(config.timeBonuses)) {
			console.error('❌ Invalid config: timeBonuses must be an array');
			process.exit(1);
		}

		if (!config.nftBonuses || !Array.isArray(config.nftBonuses)) {
			console.error('❌ Invalid config: nftBonuses must be an array');
			process.exit(1);
		}

		if (!config.lazyBalanceBonus || typeof config.lazyBalanceBonus.threshold !== 'number' || typeof config.lazyBalanceBonus.multiplier !== 'number') {
			console.error('❌ Invalid config: lazyBalanceBonus must have threshold and multiplier');
			process.exit(1);
		}

		// Load PoolManager ABI
		const poolManagerJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json'),
		);
		const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		// Check if operator is admin
		console.log('🔍 Verifying admin permissions...\n');
		const encodedCommand = poolManagerIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isAdmin = poolManagerIface.decodeFunctionResult('isAdmin', result)[0];

		if (!isAdmin) {
			console.error('❌ You are not an admin of the PoolManager contract');
			process.exit(1);
		}

		console.log('✅ Admin status confirmed\n');

		// Display configuration summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  BONUS CONFIGURATION TO MIGRATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Time Bonuses:     ${config.timeBonuses.length} entries`);
		config.timeBonuses.forEach((bonus, i) => {
			const days = Math.floor(bonus.threshold / 86400);
			console.log(`    ${i + 1}. ${days} days → ${bonus.multiplier}% multiplier`);
		});
		console.log();
		console.log(`  NFT Bonuses:      ${config.nftBonuses.length} entries`);
		config.nftBonuses.forEach((bonus, i) => {
			console.log(`    ${i + 1}. ${bonus.address} → ${bonus.multiplier}% multiplier`);
		});
		console.log();
		console.log(`  LAZY Balance:     ${config.lazyBalanceBonus.threshold} threshold → ${config.lazyBalanceBonus.multiplier}% multiplier`);
		console.log('═══════════════════════════════════════════════════════════\n');

		const totalOperations = config.timeBonuses.length + config.nftBonuses.length + 1;
		console.log(`📊 Total operations: ${totalOperations}\n`);

		// Confirm action
		const confirmation = await prompt('Proceed with bonus migration? (yes/no): ');
		if (confirmation.toLowerCase() !== 'yes' && confirmation.toLowerCase() !== 'y') {
			console.log('❌ Operation cancelled by user');
			process.exit(0);
		}

		console.log();
		let successCount = 0;
		let failCount = 0;

		// Migrate time bonuses
		console.log('⏰ Migrating time bonuses...\n');
		for (let i = 0; i < config.timeBonuses.length; i++) {
			const bonus = config.timeBonuses[i];
			try {
				console.log(`  [${i + 1}/${config.timeBonuses.length}] Setting ${Math.floor(bonus.threshold / 86400)} day bonus (${bonus.multiplier}%)...`);

				const gasInfo = await estimateGas(
					env,
					poolManagerId,
					poolManagerIface,
					operatorId,
					'setTimeBonus',
					[bonus.threshold, bonus.multiplier],
					150000,
				);
				const gasEstimate = gasInfo.gasLimit;

				const gasToUse = Math.floor(gasEstimate * 1.2);

				const executionResult = await executeContractFunction({
					contractId: poolManagerId,
					iface: poolManagerIface,
					client: client,
					functionName: 'setTimeBonus',
					params: [bonus.threshold, bonus.multiplier],
					gas: gasToUse,
					payableAmount: 0,
				});

				if (!executionResult.success) {
					throw new Error(executionResult.error || 'Transaction execution failed');
				}

				const { receipt, record } = executionResult;
				const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
				console.log(`  ✅ Success! TX: ${txId}`);
				successCount++;
				// Brief delay between transactions
				await sleep(2000);
			}
			catch (error) {
				console.log(`  ❌ Failed: ${error.message}`);
				failCount++;
			}
		}

		console.log();

		// Migrate NFT bonuses
		if (config.nftBonuses.length > 0) {
			console.log('🖼️  Migrating NFT bonuses...\n');
			for (let i = 0; i < config.nftBonuses.length; i++) {
				const bonus = config.nftBonuses[i];
				try {
					// Convert Hedera ID to Solidity address if needed
					let nftAddress;
					if (bonus.address.includes('.')) {
						const accountId = AccountId.fromString(bonus.address);
						nftAddress = accountId.toSolidityAddress();
					}
					else {
						nftAddress = bonus.address;
					}

					console.log(`  [${i + 1}/${config.nftBonuses.length}] Setting NFT ${bonus.address} bonus (${bonus.multiplier}%)...`);

					const gasInfo = await estimateGas(
						env,
						poolManagerId,
						poolManagerIface,
						operatorId,
						'setNFTBonus',
						[nftAddress, bonus.multiplier],
						150000,
					);
					const gasEstimate = gasInfo.gasLimit;

					const gasToUse = Math.floor(gasEstimate * 1.2);

					const executionResult = await executeContractFunction({
						contractId: poolManagerId,
						iface: poolManagerIface,
						client: client,
						functionName: 'setNFTBonus',
						params: [nftAddress, bonus.multiplier],
						gas: gasToUse,
						payableAmount: 0,
					});

					if (!executionResult.success) {
						throw new Error(executionResult.error || 'Transaction execution failed');
					}

					const { receipt, record } = executionResult;
					const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
					console.log(`  ✅ Success! TX: ${txId}`);
					successCount++;
					await sleep(2000);
				}
				catch (error) {
					console.log(`  ❌ Failed: ${error.message}`);
					failCount++;
				}
			}

			console.log();
		}

		// Migrate LAZY balance bonus
		console.log('💎 Migrating LAZY balance bonus...\n');
		try {
			const bonus = config.lazyBalanceBonus;
			console.log(`  Setting LAZY balance bonus (${bonus.threshold} threshold → ${bonus.multiplier}%)...`);

			const gasInfo = await estimateGas(
				env,
				poolManagerId,
				poolManagerIface,
				operatorId,
				'setLazyBalanceBonus',
				[bonus.threshold, bonus.multiplier],
				150000,
			);
			const gasEstimate = gasInfo.gasLimit;

			const gasToUse = Math.floor(gasEstimate * 1.2);

			const executionResult = await executeContractFunction({
				contractId: poolManagerId,
				iface: poolManagerIface,
				client: client,
				functionName: 'setLazyBalanceBonus',
				params: [bonus.threshold, bonus.multiplier],
				gas: gasToUse,
				payableAmount: 0,
			});

			if (!executionResult.success) {
				throw new Error(executionResult.error || 'Transaction execution failed');
			}

			const { receipt, record } = executionResult;
			const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
			console.log(`  ✅ Success! TX: ${txId}`);
			successCount++;
		}
		catch (error) {
			console.log(`  ❌ Failed: ${error.message}`);
			failCount++;
		}

		console.log();

		// Summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  MIGRATION COMPLETE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total Operations:  ${totalOperations}`);
		console.log(`  Successful:        ${successCount}`);
		console.log(`  Failed:            ${failCount}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (failCount === 0) {
			console.log('✨ All bonuses migrated successfully!\n');
		}
		else {
			console.log('⚠️  Some operations failed. Review the log above for details.\n');
		}

		// Wait for mirror node to sync
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await sleep(5000);

		console.log('💡 You can verify bonus configurations using query scripts.\n');

	}
	catch (error) {
		console.error('\n❌ Error migrating bonuses:', error.message);
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
migrateBonuses();
