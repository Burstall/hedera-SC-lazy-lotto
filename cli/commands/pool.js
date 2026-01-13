/**
 * Pool Command
 *
 * Get detailed information about a specific pool.
 *
 * Usage: lazy-lotto pool <poolId> [--json]
 */

const {
	AccountId,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const path = require('path');

const { LazyLottoABI } = require('../../index');

const utilsPath = path.join(__dirname, '../../utils');
const { readOnlyEVMFromMirrorNode } = require(`${utilsPath}/solidityHelpers`);
const { homebrewPopulateAccountNum, EntityType, getTokenDetails } = require(`${utilsPath}/hederaMirrorHelpers`);

module.exports = async function pool(args) {
	const outputJson = args.includes('--json');
	const poolIdArg = args.find(a => !a.startsWith('-'));

	if (!poolIdArg) {
		console.error('Usage: lazy-lotto pool <poolId> [--json]');
		process.exit(1);
	}

	const poolId = parseInt(poolIdArg);
	if (isNaN(poolId) || poolId < 0) {
		console.error('Invalid pool ID. Must be a non-negative integer.');
		process.exit(1);
	}

	const env = process.env.ENVIRONMENT ?? 'testnet';
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

	const lazyLottoIface = new ethers.Interface(LazyLottoABI);

	// Get pool basic info
	let encoded = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
	let data;

	try {
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
	}
	catch (error) {
		console.error(`Pool ${poolId} not found or error fetching: ${error.message}`);
		process.exit(1);
	}

	const poolInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', data);
	const [, , winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken] = poolInfo;

	// Determine status
	let status = 'active';
	if (closed) status = 'closed';
	else if (paused) status = 'paused';

	// Process fee token
	const feeTokenAddr = feeToken;
	let feeTokenId = 'HBAR';
	let feeDisplay = '';
	let feeDecimals = 8;

	if (feeTokenAddr !== '0x0000000000000000000000000000000000000000') {
		feeTokenId = await homebrewPopulateAccountNum(env, feeTokenAddr, EntityType.TOKEN);
		try {
			const tokenDets = await getTokenDetails(env, feeTokenId);
			feeDecimals = tokenDets.decimals;
			feeDisplay = `${Number(entryFee) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`;
		}
		catch {
			feeDisplay = `${entryFee} (raw)`;
		}
	}
	else {
		feeDisplay = new Hbar(Number(entryFee), HbarUnit.Tinybar).toString();
	}

	// Process pool token
	const poolTokenAddr = poolTokenId;
	let poolToken = null;
	if (poolTokenAddr !== '0x0000000000000000000000000000000000000000') {
		poolToken = await homebrewPopulateAccountNum(env, poolTokenAddr, EntityType.TOKEN);
	}

	// Fetch prizes
	const prizes = [];
	const prizeCountNum = Number(prizeCount);

	for (let i = 0; i < prizeCountNum; i++) {
		encoded = lazyLottoIface.encodeFunctionData('getPrizePackage', [poolId, i]);
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const prizePackage = lazyLottoIface.decodeFunctionResult('getPrizePackage', data);
		const prize = prizePackage[0];

		const prizeTokenAddr = prize.token;
		let prizeToken = 'HBAR';
		let prizeAmount = '';

		if (prizeTokenAddr !== '0x0000000000000000000000000000000000000000') {
			prizeToken = await homebrewPopulateAccountNum(env, prizeTokenAddr, EntityType.TOKEN);
			try {
				const tokenDets = await getTokenDetails(env, prizeToken);
				prizeAmount = `${Number(prize.amount) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`;
			}
			catch {
				prizeAmount = `${prize.amount} (raw)`;
			}
		}
		else if (Number(prize.amount) > 0) {
			prizeAmount = new Hbar(Number(prize.amount), HbarUnit.Tinybar).toString();
		}

		const nftCount = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000').length;

		prizes.push({
			index: i,
			token: prizeToken,
			amount: prizeAmount || '0',
			amountRaw: Number(prize.amount),
			nftCollections: nftCount,
		});
	}

	const result = {
		success: true,
		pool: {
			id: poolId,
			status,
			winRate: (Number(winRate) / 1_000_000 * 100).toFixed(4) + '%',
			winRateRaw: Number(winRate),
			entryFee: feeDisplay,
			entryFeeToken: feeTokenId,
			entryFeeRaw: Number(entryFee),
			poolToken,
			outstandingEntries: Number(outstandingEntries),
			prizeCount: prizeCountNum,
			prizes,
		},
		metadata: {
			contract: contractId.toString(),
			environment: env,
		},
	};

	if (outputJson) {
		console.log(JSON.stringify(result, null, 2));
	}
	else {
		console.log(`\nPool #${poolId} Details`);
		console.log('='.repeat(50));

		const statusIcon = status === 'active' ? '🟢 Active' : status === 'paused' ? '⏸️  Paused' : '🔒 Closed';
		console.log(`Status:            ${statusIcon}`);
		console.log(`Win Rate:          ${result.pool.winRate}`);
		console.log(`Entry Fee:         ${feeDisplay}`);
		console.log(`Outstanding:       ${result.pool.outstandingEntries} entries`);
		if (poolToken) {
			console.log(`Pool NFT Token:    ${poolToken}`);
		}

		console.log(`\nPrizes (${prizeCountNum}):`);
		console.log('-'.repeat(50));

		if (prizes.length === 0) {
			console.log('  No prizes configured');
		}
		else {
			prizes.forEach((prize, idx) => {
				let prizeDesc = [];
				if (prize.amountRaw > 0) prizeDesc.push(prize.amount);
				if (prize.nftCollections > 0) prizeDesc.push(`${prize.nftCollections} NFT collection(s)`);
				console.log(`  ${idx + 1}. ${prizeDesc.join(' + ') || 'Empty'}`);
			});
		}

		console.log('\nUse "lazy-lotto buy ' + poolId + ' <count>" to buy entries.\n');
	}
};
