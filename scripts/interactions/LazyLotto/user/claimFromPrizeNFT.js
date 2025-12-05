/**
 * LazyLotto Claim Prize from NFT Script
 *
 * Claim prizes that have been converted to NFT format.
 * The NFT will be wiped and prizes will be transferred.
 *
 * Usage: node scripts/interactions/LazyLotto/user/claimFromPrizeNFT.js [serial1,serial2,...]
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
const { associateTokensToAccount, setHbarAllowance } = require('../../../../utils/hederaHelpers');
require('dotenv').config();

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
const storageContractId = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);

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

	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

async function claimFromPrizeNFT() {
	let client;

	try {
		// Get serials parameter
		let serialsStr = process.argv[2];

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
		console.log('║           LazyLotto Claim from Prize NFTs                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 User: ${operatorId.toString()}\n`);

		// Load contract ABI
		const contractJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
		);
		const lazyLottoIface = new ethers.Interface(contractJson.abi);

		// Import helpers
		const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');
		const { getSerialsOwned } = require('../../../../utils/hederaMirrorHelpers');

		// Get pool token address from user (prize NFTs are pool-specific)
		console.log('🔍 Prize NFTs are pool-specific. You need to specify which pool token.\n');

		const poolTokenInput = await prompt('Enter pool token ID (0.0.xxxxx): ');

		// Convert to EVM address
		function convertToEvmAddress(hederaId) {
			if (hederaId.startsWith('0x')) return hederaId;
			const parts = hederaId.split('.');
			const num = parts[parts.length - 1];
			return '0x' + BigInt(num).toString(16).padStart(40, '0');
		}

		const prizeNFTAddress = convertToEvmAddress(poolTokenInput);
		const prizeNFTId = poolTokenInput;
		console.log(`Prize NFT Collection: ${prizeNFTId}\n`);

		// Get user's prize NFTs
		const ownedSerials = await getSerialsOwned(env, operatorId.toString(), prizeNFTId);

		if (!ownedSerials || ownedSerials.length === 0) {
			console.log('⚠️  No prize NFTs found in your account');
			process.exit(0);
		}

		console.log(`Found ${ownedSerials.length} prize NFT(s): ${ownedSerials.join(', ')}\n`);

		// Get serials if not provided
		if (!serialsStr) {
			serialsStr = await prompt('Enter NFT serials to claim (comma-separated): ');
		}

		// Parse serials
		const serials = serialsStr.split(',').map(s => {
			const serial = parseInt(s.trim());
			if (isNaN(serial) || serial <= 0) {
				throw new Error(`Invalid serial: ${s.trim()}`);
			}

			if (!ownedSerials.includes(serial)) {
				throw new Error(`You don't own serial #${serial}`);
			}

			return serial;
		});

		if (serials.length === 0) {
			console.error('❌ No valid serials provided');
			process.exit(1);
		}

		console.log(`\nClaiming ${serials.length} prize NFT(s)...\n`);

		// Get pending prizes to show what will be claimed
		console.log('🔍 Fetching prize details...');

		// Get pending prizes count first
		const userAddress = operatorId.toSolidityAddress();
		const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userAddress]);
		const countResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			countQuery,
			operatorId,
			false,
		);
		const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult)[0];

		// Get all pending prizes
		const encodedPrizeQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userAddress, 0, Number(prizeCount)]);
		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedPrizeQuery,
			operatorId,
			false,
		);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', result);

		// Filter for NFT format prizes
		const nftPrizes = pendingPrizes.filter(p => p.formatType === 1);

		console.log(`\nYou have ${nftPrizes.length} NFT-format prize(s)\n`);

		// Check and associate required tokens for NFT prizes
		console.log('🔍 Checking token associations...');
		const tokensToAssociate = new Set();
		let hasNFTs = false;
		const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');

		for (const pendingPrize of nftPrizes) {
			const prize = pendingPrize.prize;

			// Check FT token
			if (prize.amount > 0 && prize.token !== '0x0000000000000000000000000000000000000000') {
				const ftTokenId = await convertToHederaId(prize.token);
				const ftBalance = await checkMirrorBalance(env, operatorId, ftTokenId);
				if (ftBalance === null) {
					tokensToAssociate.add(ftTokenId);
				}
			}

			// Check NFT tokens
			const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
			if (nftTokens.length > 0) {
				hasNFTs = true;
				for (const nftToken of nftTokens) {
					const nftTokenId = await convertToHederaId(nftToken);
					const nftBalance = await checkMirrorBalance(env, operatorId, nftTokenId);
					if (nftBalance === null) {
						tokensToAssociate.add(nftTokenId);
					}
				}
			}
		}

		// Associate tokens if needed
		if (tokensToAssociate.size > 0) {
			console.log(`\n🔗 Associating ${tokensToAssociate.size} token(s)...`);
			const tokenIds = Array.from(tokensToAssociate).map(id => TokenId.fromString(id));
			const result = await associateTokensToAccount(
				client,
				operatorId,
				operatorKey,
				tokenIds,
			);

			if (result !== 'SUCCESS') {
				console.error('❌ Failed to associate tokens');
				process.exit(1);
			}
			console.log(`✅ Tokens associated successfully`);
			console.log('⏳ Waiting 5 seconds for mirror node to sync...');
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
		else {
			console.log(`✅ All required tokens already associated`);
		}

		// Check HBAR allowance if any prize contains NFTs
		if (hasNFTs) {
			console.log('\n🔍 Checking HBAR allowance for NFT transfers...');
			const { checkMirrorHbarAllowance } = require('../../../../utils/hederaMirrorHelpers');
			const hbarAllowance = await checkMirrorHbarAllowance(env, operatorId, storageContractId);
			const requiredHbar = 1; // 1 HBAR should be sufficient

			if (!hbarAllowance || hbarAllowance < requiredHbar) {
				console.log(`🔗 Setting HBAR allowance (${requiredHbar} HBAR) to storage contract...`);
				const result = await setHbarAllowance(
					client,
					operatorId,
					storageContractId,
					new Hbar(requiredHbar, HbarUnit.Hbar),
				);

				if (result !== 'SUCCESS') {
					console.error('❌ Failed to set HBAR allowance');
					process.exit(1);
				}
				console.log(`✅ HBAR allowance set successfully`);
			}
			else {
				console.log(`✅ HBAR allowance already set (${hbarAllowance} HBAR)`);
			}
		}

		console.log('');

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'claimPrizeFromNFT', [serials], 500000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		console.log('⚠️  Prize NFTs will be wiped (destroyed) after claiming.');
		const confirm = await prompt(`Claim prizes from ${serials.length} NFT(s)? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Claiming prizes from NFTs...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'claimPrizeFromNFT',
			[serials],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Prizes claimed successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🎁 Prizes have been transferred to your account.');
		console.log('🔥 Prize NFTs have been wiped (destroyed).\n');

	}
	catch (error) {
		console.error('\n❌ Error claiming from prize NFTs:', error.message);
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
claimFromPrizeNFT();
