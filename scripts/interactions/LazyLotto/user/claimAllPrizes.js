/**
 * LazyLotto Claim All Prizes Script
 *
 * Claims all pending prizes at once.
 * Convenience function that internally calls claimPrize for each pending prize.
 *
 * Usage: node scripts/interactions/LazyLotto/user/claimAllPrizes.js
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

async function claimAllPrizes() {
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
		console.log('║            LazyLotto Claim All Prizes                     ║');
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

		console.log('🔍 Fetching your pending prizes...\n');

		// Get pending prizes
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();
		// Get pending prizes count first
		const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userEvmAddress]);
		const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false);
		const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult)[0];

		// Get all pending prizes
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userEvmAddress, 0, Number(prizeCount)]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', result);

		if (pendingPrizes[0].length === 0) {
			console.log('❌ You have no pending prizes to claim\n');
			process.exit(0);
		}

		console.log(`✅ You have ${pendingPrizes[0].length} pending prize(s)\n`);

		// Display prizes
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  YOUR PENDING PRIZES');
		console.log('═══════════════════════════════════════════════════════════');

		for (let i = 0; i < pendingPrizes[0].length; i++) {
			const pendingPrize = pendingPrizes[0][i];
			const prize = pendingPrize.prize;

			console.log(`  Prize #${i}:`);
			console.log(`    Pool:     #${pendingPrize.poolId}`);
			console.log(`    Format:   ${pendingPrize.asNFT ? 'Prize NFT' : 'Memory'}`);

			const prizeItems = [];
			if (prize.amount > 0) {
				const tokenId = await convertToHederaId(prize.token);
				prizeItems.push(tokenId === 'HBAR' ? formatHbar(prize.amount) : `${prize.amount} ${tokenId}`);
			}
			if (prize.nftTokens.length > 0) {
				const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
				if (nftTokens.length > 0) {
					prizeItems.push(`${prize.nftSerials.length} NFT(s)`);
				}
			}

			console.log(`    Contents: ${prizeItems.join(' + ')}`);
			console.log();
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Check and associate required tokens for all prizes
		console.log('🔍 Checking token associations...');
		const tokensToAssociate = new Set();
		let hasNFTs = false;
		const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');

		for (const pendingPrize of pendingPrizes[0]) {
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
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'claimAllPrizes', [], 1000000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm claim
		const confirm = await prompt(`Claim all ${pendingPrizes[0].length} prize(s)? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Claim cancelled');
			process.exit(0);
		}

		// Execute claim
		console.log('\n🔄 Claiming all prizes...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'claimAllPrizes',
			[],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ All prizes claimed successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🎉 All prizes have been transferred to your account!\n');

	}
	catch (error) {
		console.error('\n❌ Error claiming prizes:', error.message);
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
claimAllPrizes();
