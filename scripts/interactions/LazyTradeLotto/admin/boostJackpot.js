/**
 * LazyTradeLotto - Boost Jackpot Pool (Admin)
 *
 * Adds funds to the jackpot pool to increase player excitement.
 * Only the contract owner can boost the jackpot.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js <contractId> <amount>
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js <contractId> <amount> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 *
 * Example: node admin/boostJackpot.js 0.0.123456 1000
 */

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
const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

const contractName = 'LazyTradeLotto';
const LAZY_TOKEN_ID = process.env.LAZY_TOKEN_ID;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const env = process.env.ENVIRONMENT ?? null;
let client;

let operatorKey, operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
	process.exit(1);
}

async function main() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	if (!env) {
		console.log('ERROR: Must specify ENVIRONMENT in .env file');
		process.exit(1);
	}

	console.log('\n-Using ENVIRONMENT:', env);

	// Normalize environment name to accept TEST/TESTNET, MAIN/MAINNET, PREVIEW/PREVIEWNET
	const envUpper = env.toUpperCase();

	// Initialize client
	if (envUpper === 'TEST' || envUpper === 'TESTNET') {
		client = Client.forTestnet();
	}
	else if (envUpper === 'MAIN' || envUpper === 'MAINNET') {
		client = Client.forMainnet();
	}
	else if (envUpper === 'PREVIEW' || envUpper === 'PREVIEWNET') {
		client = Client.forPreviewnet();
	}
	else if (envUpper === 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
	}
	else {
		console.log('ERROR: Must specify either MAIN/MAINNET, TEST/TESTNET, PREVIEW/PREVIEWNET, or LOCAL as ENVIRONMENT');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
	if (args.length < 2 || getArgFlag('h')) {
		console.log('Usage: boostJackpot.js <contractId> <amount>');
		console.log('       contractId: LazyTradeLotto contract address (e.g., 0.0.123456)');
		console.log('       amount: Amount to boost jackpot by (in $LAZY tokens)');
		console.log('\nOnly contract owner can boost the jackpot.');
		console.log('\nMulti-sig: Add --multisig flag for multi-signature mode');
		console.log('           Use --multisig-help for multi-sig options');
		return;
	}

	// Import ABI
	const ltlJSON = JSON.parse(fs.readFileSync(`./abi/${contractName}.json`));
	const ltlIface = new ethers.Interface(ltlJSON);

	const contractId = ContractId.fromString(args[0]);
	const boostAmount = Number(args[1]);

	if (boostAmount <= 0) {
		console.log('ERROR: Boost amount must be greater than 0');
		return;
	}

	console.log('-Using Operator:', operatorId.toString());
	console.log('-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	// Get $LAZY token decimals for proper formatting
	let lazyTokenDecimals = LAZY_DECIMAL;
	if (LAZY_TOKEN_ID) {
		const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);
		const lazyTokenDetails = await getTokenDetails(env, lazyToken);
		if (lazyTokenDetails && lazyTokenDetails.decimals !== undefined) {
			lazyTokenDecimals = lazyTokenDetails.decimals;
		}
	}

	// Get current jackpot amount using mirror node
	const lottoStatsCommand = ltlIface.encodeFunctionData('getLottoStats');
	const lottoStatsResponse = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		lottoStatsCommand,
		operatorId,
		false,
	);
	const lottoStats = ltlIface.decodeFunctionResult('getLottoStats', lottoStatsResponse);

	const currentJackpot = Number(lottoStats[0]) / (10 ** lazyTokenDecimals);
	const maxJackpot = Number(lottoStats[7]) / (10 ** lazyTokenDecimals);

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('             Boost Jackpot Pool');
	console.log('═══════════════════════════════════════════════════════════\n');

	console.log('💰 Current Jackpot:', currentJackpot.toLocaleString(), '$LAZY');
	console.log('🎰 Maximum Cap:', maxJackpot.toLocaleString(), '$LAZY');
	console.log('📈 Boost Amount:', boostAmount.toLocaleString(), '$LAZY');
	console.log('✨ New Jackpot:', (currentJackpot + boostAmount).toLocaleString(), '$LAZY');

	if ((currentJackpot + boostAmount) > maxJackpot) {
		console.log('\n⚠️  WARNING: New jackpot will exceed maximum cap!');
		console.log(`   The jackpot will be capped at ${maxJackpot.toLocaleString()} $LAZY`);
	}

	console.log('\n═══════════════════════════════════════════════════════════\n');

	const proceed = readlineSync.keyInYNStrict(
		`Boost jackpot by ${boostAmount.toLocaleString()} $LAZY?`,
	);

	if (!proceed) {
		console.log('Operation cancelled by user.');
		return;
	}

	// Convert amount to smallest units
	const boostAmountAdjusted = BigInt(boostAmount) * BigInt(10 ** lazyTokenDecimals);

	console.log('\nBoosting jackpot...');

	// Gas limit for boostJackpot transaction
	const gasLimit = 300_000;

	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'boostJackpot',
		params: [boostAmountAdjusted],
		gas: gasLimit,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('❌ Error boosting jackpot:', result.error);
		return;
	}

	console.log('\n✅ Jackpot boosted successfully!');
	const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
	console.log('📋 Transaction ID:', txId);
	console.log(`💰 New jackpot: ~${(currentJackpot + boostAmount).toLocaleString()} $LAZY`);
	console.log('\n💡 Tip: Use queries/getLottoInfo.js to verify the new jackpot amount.\n');
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
