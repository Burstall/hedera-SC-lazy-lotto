/**
 * Pools Command
 *
 * List all available lottery pools.
 *
 * Usage: lazy-lotto pools [--json]
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

module.exports = async function pools(args) {
	const outputJson = args.includes('--json');
	const env = process.env.ENVIRONMENT ?? 'testnet';
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

	const lazyLottoIface = new ethers.Interface(LazyLottoABI);

	// Get total pools
	let encoded = lazyLottoIface.encodeFunctionData('totalPools');
	let data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
	const totalPools = Number(lazyLottoIface.decodeFunctionResult('totalPools', data)[0]);

	if (totalPools === 0) {
		if (outputJson) {
			console.log(JSON.stringify({ success: true, pools: [], total: 0 }));
		}
		else {
			console.log('\nNo pools available.\n');
		}
		return;
	}

	// Fetch pool info
	const poolsList = [];

	for (let i = 0; i < totalPools; i++) {
		encoded = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [i]);
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const poolInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', data);

		const [, , winRate, entryFee, prizeCount, outstandingEntries, , paused, closed, feeToken] = poolInfo;

		let status = 'active';
		if (closed) status = 'closed';
		else if (paused) status = 'paused';

		const feeTokenAddr = feeToken;
		let feeTokenId = 'HBAR';
		let feeDisplay = '';

		if (feeTokenAddr !== '0x0000000000000000000000000000000000000000') {
			feeTokenId = await homebrewPopulateAccountNum(env, feeTokenAddr, EntityType.TOKEN);
			try {
				const tokenDets = await getTokenDetails(env, feeTokenId);
				feeDisplay = `${Number(entryFee) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`;
			}
			catch {
				feeDisplay = `${entryFee} (raw)`;
			}
		}
		else {
			feeDisplay = new Hbar(Number(entryFee), HbarUnit.Tinybar).toString();
		}

		poolsList.push({
			id: i,
			status,
			winRate: (Number(winRate) / 1_000_000 * 100).toFixed(4) + '%',
			winRateRaw: Number(winRate),
			entryFee: feeDisplay,
			entryFeeToken: feeTokenId,
			prizeCount: Number(prizeCount),
			outstandingEntries: Number(outstandingEntries),
		});
	}

	if (outputJson) {
		console.log(JSON.stringify({
			success: true,
			contract: contractId.toString(),
			environment: env,
			total: totalPools,
			pools: poolsList,
		}, null, 2));
	}
	else {
		console.log('\nLazyLotto Pools');
		console.log('='.repeat(70));
		console.log(`Contract: ${contractId.toString()}`);
		console.log(`Total Pools: ${totalPools}\n`);

		console.log('ID  | Status  | Win Rate | Entry Fee          | Prizes | Entries');
		console.log('-'.repeat(70));

		for (const pool of poolsList) {
			const statusIcon = pool.status === 'active' ? '🟢' : pool.status === 'paused' ? '⏸️ ' : '🔒';
			console.log(
				`${pool.id.toString().padEnd(3)} | ${statusIcon.padEnd(6)} | ${pool.winRate.padEnd(8)} | ${pool.entryFee.padEnd(18)} | ${pool.prizeCount.toString().padEnd(6)} | ${pool.outstandingEntries}`,
			);
		}

		console.log('\nUse "lazy-lotto pool <id>" for detailed pool info.\n');
	}
};
