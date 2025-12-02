/**
 * LazyLotto Create Pool Script
 *
 * Creates a new lottery pool with specified parameters.
 * Requires ADMIN role on the contract.
 *
 * Usage: node scripts/interactions/LazyLotto/admin/createPool.js
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const { homebrewPopulateAccountNum, getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
let tokenDets = null;

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
	return await homebrewPopulateAccountNum(env, evmAddress);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function createPool() {
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
		console.log('║           LazyLotto Create Pool (Admin)                  ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		// Check admin role
		console.log('🔍 Verifying admin role...');
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();

		let encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [userEvmAddress]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const hasAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', result);

		if (!hasAdmin[0]) {
			console.error('❌ You do not have ADMIN role on this contract');
			process.exit(1);
		}

		console.log('✅ Admin role verified\n');

		// Gather pool parameters
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL CONFIGURATION');
		console.log('═══════════════════════════════════════════════════════════\n');

		// Win rate
		const winRateStr = await prompt('Enter win rate (as percentage, e.g., 5.25 for 5.25%): ');
		const winRatePercent = parseFloat(winRateStr);

		if (isNaN(winRatePercent) || winRatePercent <= 0 || winRatePercent > 100) {
			console.error('❌ Invalid win rate (must be 0-100)');
			process.exit(1);
		}

		const winRateThousandthsOfBps = Math.floor(winRatePercent * 1_000_000);

		// Entry fee token
		const feeTokenStr = await prompt('Enter fee token (0.0.xxxxx or "HBAR"): ');
		const feeToken = feeTokenStr.toUpperCase() === 'HBAR' ? '0x0000000000000000000000000000000000000000' : convertToEvmAddress(feeTokenStr);

		// Entry fee amount
		const entryFeeStr = await prompt('Enter entry fee amount: ');
		let entryFee = entryFeeStr;

		if (isNaN(Number(entryFee)) || Number(entryFee) <= 0) {
			console.error('❌ Invalid entry fee');
			process.exit(1);
		}

		// need to adjust entry fee by the appropriate decimal places based on token
		if (feeToken === '0x0000000000000000000000000000000000000000') {
			// HBAR: convert to tinybars
			entryFee = Math.floor(Number(new Hbar(Number(entryFee), HbarUnit.Hbar).toTinybars()));
		}
		else {
			// FT: get decimals and convert
			tokenDets = await getTokenDetails(env, feeTokenStr);
			entryFee = Math.floor(Number(entryFee) * (10 ** tokenDets.decimals));
		}

		// Create new pool NFT token or use existing
		const createNewToken = await prompt('Create new pool token? (yes/no): ');

		let tokenName, tokenSymbol, tokenMemo;

		if (createNewToken.toLowerCase() === 'yes' || createNewToken.toLowerCase() === 'y') {
			tokenName = await prompt('Enter token name: ');
			tokenSymbol = await prompt('Enter token symbol: ');
			tokenMemo = await prompt('Enter token memo (optional, press enter to skip): ') || 'LazyLotto Pool Token';

			console.log('\n💡 Note: Pool token creation requires ~20 HBAR fee\n');
		}
		else {
			console.error('❌ Only new token creation is supported. Use existing tokens for advanced scenarios.');
			process.exit(1);
		}

		// Get metadata CIDs
		const ticketCID = await prompt('Enter ticket metadata CID (for unrolled tickets): ');
		const winCID = await prompt('Enter winning ticket metadata CID: ');

		if (!ticketCID || !winCID) {
			console.error('❌ Both ticket CID and win CID are required');
			process.exit(1);
		}

		// Royalties (optional, max 10)
		const addRoyalties = await prompt('Add royalties? (yes/no): ');
		const royalties = [];

		if (addRoyalties.toLowerCase() === 'yes' || addRoyalties.toLowerCase() === 'y') {
			let addingRoyalties = true;

			while (addingRoyalties && royalties.length < 10) {
				console.log(`\n📝 Adding royalty ${royalties.length + 1}/10`);

				const royaltyAccount = await prompt('Enter royalty account (0.0.xxxxx): ');
				const royaltyPercentage = await prompt('Enter royalty percentage (e.g., 5 for 5%): ');
				const fallbackFeeHbar = await prompt('Enter fallback fee in HBAR (e.g., 1.5): ');

				const percentage = parseFloat(royaltyPercentage);
				const fallbackHbar = parseFloat(fallbackFeeHbar);

				if (isNaN(percentage) || percentage < 0 || percentage > 100) {
					console.error('❌ Invalid royalty percentage');
					continue;
				}

				if (isNaN(fallbackHbar) || fallbackHbar < 0) {
					console.error('❌ Invalid fallback fee');
					continue;
				}

				const numerator = Math.floor(percentage * 100);
				const denominator = 10000;
				const fallbackFeeTinybar = Math.floor(new Hbar(fallbackHbar, HbarUnit.Hbar).toTinybars());

				royalties.push({
					numerator: numerator,
					denominator: denominator,
					fallbackfee: fallbackFeeTinybar,
					account: convertToEvmAddress(royaltyAccount),
				});

				console.log(`✅ Added: ${percentage}% to ${royaltyAccount}, fallback: ${fallbackHbar} HBAR`);

				if (royalties.length < 10) {
					const addMore = await prompt('\nAdd another royalty? (yes/no): ');
					addingRoyalties = addMore.toLowerCase() === 'yes' || addMore.toLowerCase() === 'y';
				}
				else {
					console.log('\n⚠️  Maximum of 10 royalties reached');
					addingRoyalties = false;
				}
			}

			// Summarize royalties
			console.log('\n═══════════════════════════════════════════════════════════');
			console.log('  ROYALTY SUMMARY');
			console.log('═══════════════════════════════════════════════════════════');

			let totalRoyaltyPercentage = 0;
			royalties.forEach((royalty, index) => {
				const percentage = (royalty.numerator / royalty.denominator) * 100;
				const fallbackHbar = royalty.fallbackfee / 100_000_000;
				totalRoyaltyPercentage += percentage;

				console.log(`  ${index + 1}. ${percentage}% → ${royalty.account.substring(0, 10)}...`);
				console.log(`     Fallback: ${fallbackHbar} HBAR`);
			});

			console.log(`\n  Total Royalty: ${totalRoyaltyPercentage.toFixed(2)}%`);
			console.log('═══════════════════════════════════════════════════════════\n');

			if (totalRoyaltyPercentage > 100) {
				console.error('⚠️  WARNING: Total royalty percentage exceeds 100%!');
			}

			const confirmRoyalties = await prompt('Confirm royalties? (yes to continue, no to skip royalties): ');
			if (confirmRoyalties.toLowerCase() !== 'yes' && confirmRoyalties.toLowerCase() !== 'y') {
				royalties.length = 0;
				// Clear royalties array
				console.log('❌ Royalties cleared, continuing without royalties\n');
			}
		}

		// Summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool Token:       ${tokenName} (${tokenSymbol})`);
		console.log(`  Win Rate:         ${formatWinRate(winRateThousandthsOfBps)}`);
		console.log(`  Entry Fee:        ${feeToken === '0x0000000000000000000000000000000000000000' ? new Hbar(Number(entryFee), HbarUnit.Tinybar).toString() : entryFee / (10 ** tokenDets.decimals) + ' ' + tokenDets.symbol}`);
		console.log(`  Ticket CID:       ${ticketCID}`);
		console.log(`  Win CID:          ${winCID}`);
		console.log(`  Royalties:        ${royalties.length > 0 ? 'Yes' : 'No'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas
		console.log('⛽ Estimating gas...');

		const functionName = 'createPool';
		const functionArgs = [
			tokenName,
			tokenSymbol,
			tokenMemo,
			royalties,
			ticketCID,
			winCID,
			winRateThousandthsOfBps,
			entryFee,
			feeToken,
		];
		// 20 HBAR for token creation
		const payableAmount = Number(new Hbar(20).toTinybars());

		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, functionName, functionArgs, 800000, payableAmount);
		const gasEstimate = gasInfo.gasLimit;
		console.log(`   Gas: ~${gasEstimate}\n`);

		console.log('💰 Pool creation fee: 20 HBAR (for NFT token creation)\n');

		// Confirm
		const confirm = await prompt('Proceed with pool creation? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Pool creation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Creating pool...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			functionName,
			functionArgs,
			new Hbar(Number(payableAmount), HbarUnit.Tinybar),
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Pool created successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		// Get the poolId from the contract function result
		// Note: results is already decoded by contractExecuteFunction
		let newPoolId;
		try {
			// The createPool function returns the poolId
			newPoolId = Number(results[0]);
			console.log(`🎰 New Pool ID: #${newPoolId}\n`);
		}
		catch (decodeError) {
			console.log('⚠️  Could not decode pool ID from transaction result');
			console.log('    Use the queries/masterInfo.js script to view all pools\n');

			console.log(decodeError);

			console.log('💡 Next steps:');
			console.log('   - Use addPrizePackage.js to add prizes to the pool');
			console.log('   - Users can buy entries once prizes are added\n');
			return;
		}

		// Wait a moment for mirror node to sync
		console.log('⏳ Waiting for mirror node to sync...');
		await new Promise(resolve => setTimeout(resolve, 3000));

		// Get pool details
		encodedCommand = lazyLottoIface.encodeFunctionData('getPoolDetails', [newPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolDetails', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  NEW POOL DETAILS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool ID:          #${newPoolId}`);
		console.log(`  Win Rate:         ${formatWinRate(poolDetails.winRateThousandthsOfBps)}`);
		console.log(`  Entry Fee:        ${entryFee} ${await convertToHederaId(poolDetails.feeToken)}`);
		console.log(`  Pool Token:       ${await convertToHederaId(poolDetails.poolTokenId)}`);
		console.log('  State:            ACTIVE');
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('💡 Next steps:');
		console.log('   - Use addPrizePackage.js to add prizes to the pool');
		console.log('   - Users can buy entries once prizes are added\n');

	}
	catch (error) {
		console.error('\n❌ Error creating pool:', error.message);
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
createPool();
