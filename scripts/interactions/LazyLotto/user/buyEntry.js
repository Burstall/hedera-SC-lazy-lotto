/**
 * LazyLotto Buy Entry Script
 *
 * Purchase memory entries (tickets) for a lottery pool.
 * Memory entries can be rolled later using rollTickets.js
 *
 * Usage: node scripts/interactions/LazyLotto/user/buyEntry.js [poolId] [quantity]
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const { getTokenDetails, homebrewPopulateAccountEvmAddress, checkMirrorBalance, checkMirrorAllowance } = require('../../../../utils/hederaMirrorHelpers');
const { setFTAllowance } = require('../../../../utils/hederaHelpers');
const { sleep } = require('@directus/sdk');

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

// Helper: Convert Hedera ID to EVM address
async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	return await homebrewPopulateAccountNum(env, evmAddress);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function buyEntry() {
	let client;

	try {
		// Get pool ID
		let poolIdStr = process.argv[2];
		let quantityStr = process.argv[3];

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
		console.log('║              LazyLotto Buy Entry                          ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);
		const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		console.log('🔍 Fetching pool details...\n');

		// Get pool details
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		// eslint-disable-next-line no-unused-vars
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken] =
			lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);

		// Validate pool state
		if (paused) {
			console.error('❌ Pool is paused. Cannot buy entries.');
			process.exit(1);
		}

		if (closed) {
			console.error('❌ Pool is closed. Cannot buy entries.');
			process.exit(1);
		}

		// Display pool info
		const feeTokenId = await convertToHederaId(feeToken);
		const feePerEntry = entryFee;

		// Get token details for formatting
		let tokenDets = null;
		if (feeTokenId !== 'HBAR') {
			tokenDets = await getTokenDetails(env, feeTokenId);
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Win Rate:         ${formatWinRate(Number(winRate))}`);
		console.log(`  Entry Fee:        ${feeTokenId === 'HBAR' ? new Hbar(Number(feePerEntry), HbarUnit.Tinybar).toString() : `${Number(feePerEntry) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log(`  Pool Token:       ${await convertToHederaId(poolTokenId)}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Get and display current entries
		const userEvmAddress = await homebrewPopulateAccountEvmAddress(env, operatorId.toString());
		encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const currentEntries = lazyLottoIface.decodeFunctionResult('getUsersEntries', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CURRENT STATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Your entries in pool #${poolId}: ${currentEntries[0]}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Now prompt for quantity
		if (!quantityStr) {
			quantityStr = await prompt('Enter quantity to purchase: ');
		}

		const quantity = parseInt(quantityStr);

		if (isNaN(quantity) || quantity <= 0) {
			console.error('❌ Invalid quantity (must be positive)');
			process.exit(1);
		}

		const totalFee = BigInt(feePerEntry) * BigInt(quantity);

		console.log('\n═══════════════════════════════════════════════════════════');
		console.log('  PURCHASE SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Quantity:         ${quantity} entries`);
		console.log(`  Total Cost:       ${feeTokenId === 'HBAR' ? new Hbar(Number(totalFee), HbarUnit.Tinybar).toString() : `${Number(totalFee) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log('═══════════════════════════════════════════════════════════\n');
		// Check if FT payment required
		if (feeTokenId !== 'HBAR') {
			const balance = await checkMirrorBalance(env, operatorId.toString(), feeTokenId);

			console.log(`💰 Your ${tokenDets.symbol} balance: ${Number(balance) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}\n`);

			if (BigInt(balance) < totalFee) {
				console.error(`❌ Insufficient ${tokenDets.symbol} balance`);
				console.error(`   Required: ${Number(totalFee) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`);
				console.error(`   Available: ${Number(balance) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`);
				process.exit(1);
			}

			// Get storage contract and check allowance
			encodedCommand = lazyLottoIface.encodeFunctionData('storageContract');
			result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
			const storageAddress = lazyLottoIface.decodeFunctionResult('storageContract', result);
			const storageId = await convertToHederaId(storageAddress[0]);

			// Check for LAZY token (uses LazyGasStation) or other FTs (uses Storage)
			const lazyTokenIdStr = process.env.LAZY_TOKEN_ID;
			const isLazy = lazyTokenIdStr && feeTokenId === lazyTokenIdStr;
			const spenderContractId = isLazy ? process.env.LAZY_GAS_STATION_CONTRACT_ID : storageId;
			const spenderName = isLazy ? 'LazyGasStation' : 'Storage';

			console.log(`🔍 Checking ${tokenDets.symbol} allowance to ${spenderName} contract...`);
			const currentAllowance = await checkMirrorAllowance(
				env,
				operatorId.toString(),
				feeTokenId,
				spenderContractId,
			);

			if (BigInt(currentAllowance) < totalFee) {
				console.log('\n⚠️  Insufficient allowance');
				console.log(`   Current: ${Number(currentAllowance) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`);
				console.log(`   Required: ${Number(totalFee) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`);
				console.log(`   Spender: ${spenderContractId}\n`);

				const setAllowance = await prompt('Set token allowance? (yes/no): ');
				if (setAllowance.toLowerCase() !== 'yes' && setAllowance.toLowerCase() !== 'y') {
					console.log('\n❌ Purchase cancelled - insufficient allowance');
					process.exit(0);
				}

				console.log(`\n🔗 Setting ${tokenDets.symbol} allowance to ${spenderName} contract...`);
				const feeTokenIdObj = TokenId.fromString(feeTokenId);
				const spenderContractIdObj = ContractId.fromString(spenderContractId);

				const allowanceResult = await setFTAllowance(
					client,
					feeTokenIdObj,
					operatorId,
					spenderContractIdObj,
					totalFee,
				);

				if (allowanceResult !== 'SUCCESS') {
					console.error('❌ Failed to set token allowance');
					process.exit(1);
				}

				console.log('✅ Allowance set successfully');
				console.log('⏳ Waiting 5 seconds for mirror node to sync...');
				await sleep(5000);
			}
			else {
				console.log(`✅ Sufficient allowance: ${Number(currentAllowance) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}\n`);
			}
		}

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'buyEntry', [poolId, quantity], 500000,
			feeTokenId === 'HBAR' ? Number(totalFee) : 0);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm purchase
		const confirm = await prompt('Proceed with purchase? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Purchase cancelled');
			process.exit(0);
		}

		// Execute purchase
		console.log('\n🔄 Purchasing entries...');

		// 20% buffer for gas
		const gasLimit = Math.floor(gasEstimate * 1.2);
		const payableAmount = feeTokenId === 'HBAR' ? totalFee : 0; const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'buyEntry',
			[poolId, quantity],
			new Hbar(payableAmount, HbarUnit.Tinybar),
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Entries purchased successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}`);
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await new Promise(resolve => setTimeout(resolve, 5000));

		// Get updated entry count
		encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const entries = lazyLottoIface.decodeFunctionResult('getUsersEntries', result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED STATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Your entries in pool #${poolId}: ${entries[0]}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('💡 Next steps:');
		console.log('   - Use rollTickets.js to play your entries');
		console.log('   - Use userState.js to view your tickets and prizes\n');

	}
	catch (error) {
		console.error('\n❌ Error buying entries:', error.message);
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
buyEntry();
