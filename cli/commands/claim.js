/**
 * Claim Command
 *
 * Claim all pending prizes.
 *
 * Usage: lazy-lotto claim [--json]
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
const path = require('path');

const { LazyLottoABI } = require('../../index');

const utilsPath = path.join(__dirname, '../../utils');
const { readOnlyEVMFromMirrorNode, contractExecuteFunction } = require(`${utilsPath}/solidityHelpers`);
const { homebrewPopulateAccountNum, EntityType, checkMirrorBalance, checkMirrorHbarAllowance } = require(`${utilsPath}/hederaMirrorHelpers`);
const { estimateGas } = require(`${utilsPath}/gasHelpers`);
const { associateTokensToAccount, setHbarAllowance } = require(`${utilsPath}/hederaHelpers`);

module.exports = async function claim(args) {
	const outputJson = args.includes('--json');

	const env = process.env.ENVIRONMENT ?? 'testnet';
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
	const storageContractId = process.env.LAZY_LOTTO_STORAGE
		? ContractId.fromString(process.env.LAZY_LOTTO_STORAGE)
		: null;

	// Initialize client
	let client;
	const envUpper = env.toUpperCase();
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
		console.error(`Unknown environment: ${env}`);
		process.exit(1);
	}
	client.setOperator(operatorId, operatorKey);

	const lazyLottoIface = new ethers.Interface(LazyLottoABI);

	try {
		// Get pending prizes
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();

		// Get count first
		let encoded = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userEvmAddress]);
		let data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const prizeCount = Number(lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', data)[0]);

		if (prizeCount === 0) {
			const result = {
				success: false,
				error: 'No pending prizes to claim',
			};
			if (outputJson) {
				console.log(JSON.stringify(result, null, 2));
			}
			else {
				console.log('You have no pending prizes to claim.');
			}
			process.exit(0);
		}

		// Get all pending prizes
		encoded = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userEvmAddress, 0, prizeCount]);
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', data)[0];

		if (!outputJson) {
			console.log(`\nYou have ${prizeCount} pending prize(s)`);
		}

		// Check and associate required tokens
		const tokensToAssociate = new Set();
		let hasNFTs = false;

		for (const pendingPrize of pendingPrizes) {
			const prize = pendingPrize.prize;

			// Check FT token
			if (prize.amount > 0 && prize.token !== '0x0000000000000000000000000000000000000000') {
				const ftTokenId = await homebrewPopulateAccountNum(env, prize.token, EntityType.TOKEN);
				const ftBalance = await checkMirrorBalance(env, operatorId.toString(), ftTokenId);
				if (ftBalance === null) {
					tokensToAssociate.add(ftTokenId);
				}
			}

			// Check NFT tokens
			const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
			if (nftTokens.length > 0) {
				hasNFTs = true;
				for (const nftToken of nftTokens) {
					const nftTokenId = await homebrewPopulateAccountNum(env, nftToken, EntityType.TOKEN);
					const nftBalance = await checkMirrorBalance(env, operatorId.toString(), nftTokenId);
					if (nftBalance === null) {
						tokensToAssociate.add(nftTokenId);
					}
				}
			}
		}

		// Associate tokens if needed
		if (tokensToAssociate.size > 0) {
			if (!outputJson) {
				console.log(`Associating ${tokensToAssociate.size} token(s)...`);
			}
			const tokenIds = Array.from(tokensToAssociate).map(id => TokenId.fromString(id));
			const assocResult = await associateTokensToAccount(
				client,
				operatorId,
				operatorKey,
				tokenIds,
			);

			if (assocResult !== 'SUCCESS') {
				console.error('Failed to associate tokens');
				process.exit(1);
			}
			await new Promise(resolve => setTimeout(resolve, 5000));
		}

		// Check HBAR allowance for NFT transfers
		if (hasNFTs && storageContractId) {
			const hbarAllowance = await checkMirrorHbarAllowance(env, operatorId.toString(), storageContractId.toString());
			const requiredHbar = 1;

			if (!hbarAllowance || hbarAllowance < requiredHbar) {
				if (!outputJson) {
					console.log('Setting HBAR allowance for NFT transfers...');
				}
				const allowResult = await setHbarAllowance(
					client,
					operatorId,
					storageContractId,
					new Hbar(requiredHbar, HbarUnit.Hbar),
				);

				if (allowResult !== 'SUCCESS') {
					console.error('Failed to set HBAR allowance');
					process.exit(1);
				}
			}
		}

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'claimAllPrizes', [], 1000000);
		const gasLimit = Math.floor(gasInfo.gasLimit * 1.2);

		if (!outputJson) {
			console.log(`\nClaiming ${prizeCount} prize(s)...`);
		}

		// Execute claim
		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'claimAllPrizes',
			[],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('Transaction failed');
			process.exit(1);
		}

		// Format prizes for output
		const prizesSummary = [];
		for (const pendingPrize of pendingPrizes) {
			const prize = pendingPrize.prize;
			const items = [];

			if (prize.amount > 0) {
				if (prize.token === '0x0000000000000000000000000000000000000000') {
					items.push(new Hbar(Number(prize.amount), HbarUnit.Tinybar).toString());
				}
				else {
					const tokenId = await homebrewPopulateAccountNum(env, prize.token, EntityType.TOKEN);
					items.push(`${prize.amount} ${tokenId}`);
				}
			}

			const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
			if (nftTokens.length > 0) {
				items.push(`${prize.nftSerials.length} NFT(s)`);
			}

			prizesSummary.push({
				poolId: Number(pendingPrize.poolId),
				contents: items.join(' + ') || 'Empty',
			});
		}

		const result = {
			success: true,
			transaction: {
				id: record.transactionId.toString(),
			},
			claimed: {
				count: prizeCount,
				prizes: prizesSummary,
			},
			metadata: {
				contract: contractId.toString(),
				environment: env,
				timestamp: new Date().toISOString(),
			},
		};

		if (outputJson) {
			console.log(JSON.stringify(result, null, 2));
		}
		else {
			console.log(`\nPrizes claimed successfully!`);
			console.log(`Transaction: ${record.transactionId.toString()}`);
			console.log(`\nClaimed ${prizeCount} prize(s):`);
			for (const prize of prizesSummary) {
				console.log(`  Pool #${prize.poolId}: ${prize.contents}`);
			}
		}
	}
	catch (error) {
		const result = {
			success: false,
			error: error.message,
		};
		if (outputJson) {
			console.log(JSON.stringify(result, null, 2));
		}
		else {
			console.error(`Error: ${error.message}`);
		}
		process.exit(1);
	}
	finally {
		client.close();
	}
};
