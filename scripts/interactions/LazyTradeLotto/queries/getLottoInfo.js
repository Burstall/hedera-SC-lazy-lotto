/**
 * LazyTradeLotto - Get Complete Lottery Information
 *
 * Displays comprehensive information about the LazyTradeLotto contract:
 * - LSH NFT tokens (Gen1, Gen2, Mutant)
 * - Connected contracts (PRNG, LazyGasStation, LazyDelegateRegistry)
 * - Configuration (systemWallet, burnPercentage, pause status)
 * - Lottery statistics (jackpot, wins, payouts, etc.)
 *
 * Usage: node queries/getLottoInfo.js <contractId>
 * Example: node queries/getLottoInfo.js 0.0.123456
 */

const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

const contractName = 'LazyTradeLotto';
const LAZY_TOKEN_ID = process.env.LAZY_TOKEN_ID;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const env = process.env.ENVIRONMENT ?? null;

let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
	process.exit(1);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0 || getArgFlag('h')) {
		console.log('Usage: getLottoInfo.js <contractId>');
		console.log('       contractId: LazyTradeLotto contract address (e.g., 0.0.123456)');
		console.log('\nDisplays comprehensive lottery contract information.');
		return;
	}

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());

	// Import ABI
	const ltlJSON = JSON.parse(fs.readFileSync(`./abi/${contractName}.json`));
	const ltlIface = new ethers.Interface(ltlJSON);

	const contractId = ContractId.fromString(args[0]);
	console.log('-Using Contract:', contractId.toString(), '\n');

	// Get $LAZY token decimals for proper formatting
	let lazyTokenDecimals = LAZY_DECIMAL;
	if (LAZY_TOKEN_ID) {
		const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);
		const lazyTokenDetails = await getTokenDetails(env, lazyToken);
		if (lazyTokenDetails && lazyTokenDetails.decimals !== undefined) {
			lazyTokenDecimals = lazyTokenDetails.decimals;
		}
	}

	// Fetch all contract data
	console.log('Fetching contract data...\n');

	// LSH Tokens
	const lshGen1 = ltlIface.decodeFunctionResult(
		'LSH_GEN1',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('LSH_GEN1'),
			operatorId,
			false,
		),
	)[0];

	const lshGen2 = ltlIface.decodeFunctionResult(
		'LSH_GEN2',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('LSH_GEN2'),
			operatorId,
			false,
		),
	)[0];

	const lshMutant = ltlIface.decodeFunctionResult(
		'LSH_GEN1_MUTANT',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('LSH_GEN1_MUTANT'),
			operatorId,
			false,
		),
	)[0];

	// Connected Contracts
	const prngContract = ltlIface.decodeFunctionResult(
		'prngSystemContract',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('prngSystemContract'),
			operatorId,
			false,
		),
	)[0];

	const lgsContract = ltlIface.decodeFunctionResult(
		'lazyGasStation',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('lazyGasStation'),
			operatorId,
			false,
		),
	)[0];

	const ldrContract = ltlIface.decodeFunctionResult(
		'lazyDelegateRegistry',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('lazyDelegateRegistry'),
			operatorId,
			false,
		),
	)[0];

	// Configuration
	const systemWallet = ltlIface.decodeFunctionResult(
		'systemWallet',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('systemWallet'),
			operatorId,
			false,
		),
	)[0];

	const burnPercentage = ltlIface.decodeFunctionResult(
		'burnPercentage',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('burnPercentage'),
			operatorId,
			false,
		),
	)[0];

	const isPaused = ltlIface.decodeFunctionResult(
		'isPaused',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('isPaused'),
			operatorId,
			false,
		),
	)[0];

	// Lottery Statistics
	const lottoStats = ltlIface.decodeFunctionResult(
		'getLottoStats',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('getLottoStats'),
			operatorId,
			false,
		),
	);

	// Display Results
	console.log('═══════════════════════════════════════════════════════════');
	console.log('         LazyTradeLotto Contract Information');
	console.log('═══════════════════════════════════════════════════════════\n');

	console.log('📜 Contract Address:', contractId.toString());
	console.log('⚙️  Status:', isPaused ? '🔴 PAUSED' : '🟢 ACTIVE');
	console.log('🔥 Burn Percentage:', Number(burnPercentage) + '%');
	console.log('✍️  System Wallet:', systemWallet);

	console.log('\n───────────────────────────────────────────────────────────');
	console.log('  LSH NFT Collections (0% Burn for Holders)');
	console.log('───────────────────────────────────────────────────────────\n');

	console.log('🎨 LSH Gen1:', TokenId.fromSolidityAddress(lshGen1).toString());
	console.log('🎨 LSH Gen2:', TokenId.fromSolidityAddress(lshGen2).toString());
	console.log('🎨 LSH Gen1 Mutant:', TokenId.fromSolidityAddress(lshMutant).toString());

	console.log('\n───────────────────────────────────────────────────────────');
	console.log('  Connected Contracts');
	console.log('───────────────────────────────────────────────────────────\n');

	console.log('🎲 PRNG System:', ContractId.fromSolidityAddress(prngContract).toString());
	console.log('⛽ Lazy Gas Station:', ContractId.fromSolidityAddress(lgsContract).toString());
	console.log('📋 Lazy Delegate Registry:', ContractId.fromSolidityAddress(ldrContract).toString());

	console.log('\n───────────────────────────────────────────────────────────');
	console.log('  Jackpot & Statistics');
	console.log('───────────────────────────────────────────────────────────\n');

	const jackpotPool = Number(lottoStats[0]) / (10 ** lazyTokenDecimals);
	const jackpotsWon = Number(lottoStats[1]);
	const jackpotPaid = Number(lottoStats[2]) / (10 ** lazyTokenDecimals);
	const totalRolls = Number(lottoStats[3]);
	const totalWins = Number(lottoStats[4]);
	const totalPaid = Number(lottoStats[5]) / (10 ** lazyTokenDecimals);
	const lossIncrement = Number(lottoStats[6]) / (10 ** lazyTokenDecimals);
	const maxJackpotThreshold = Number(lottoStats[7]) / (10 ** lazyTokenDecimals);

	console.log('💰 Current Jackpot:', jackpotPool.toLocaleString(), '$LAZY');
	console.log('🎰 Max Jackpot Cap:', maxJackpotThreshold.toLocaleString(), '$LAZY');
	console.log('📈 Per-Roll Increment:', lossIncrement.toLocaleString(), '$LAZY');

	console.log('\n🏆 Jackpot History:');
	console.log('   Wins:', jackpotsWon);
	console.log('   Total Paid:', jackpotPaid.toLocaleString(), '$LAZY');

	console.log('\n🎯 Regular Wins:');
	console.log('   Total Rolls:', totalRolls.toLocaleString());
	console.log('   Total Wins:', totalWins.toLocaleString());
	console.log('   Win Rate:', totalRolls > 0 ? ((totalWins / totalRolls) * 100).toFixed(2) + '%' : 'N/A');
	console.log('   Total Paid:', totalPaid.toLocaleString(), '$LAZY');

	console.log('\n💵 Combined Payouts:', (totalPaid + jackpotPaid).toLocaleString(), '$LAZY');

	console.log('\n═══════════════════════════════════════════════════════════\n');
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
