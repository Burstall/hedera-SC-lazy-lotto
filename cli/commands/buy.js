/**
 * Buy Command
 *
 * Purchase lottery entries for a pool.
 *
 * Usage: lazy-lotto buy <poolId> <count> [--json]
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
const { homebrewPopulateAccountNum, EntityType, homebrewPopulateAccountEvmAddress, getTokenDetails, checkMirrorBalance, checkMirrorAllowance } = require(`${utilsPath}/hederaMirrorHelpers`);
const { estimateGas } = require(`${utilsPath}/gasHelpers`);
const { setFTAllowance } = require(`${utilsPath}/hederaHelpers`);

module.exports = async function buy(args) {
	const outputJson = args.includes('--json');
	const poolIdArg = args.find(a => !a.startsWith('-') && !isNaN(parseInt(a)));
	const countArg = args.filter(a => !a.startsWith('-') && !isNaN(parseInt(a)))[1];

	if (!poolIdArg || !countArg) {
		console.error('Usage: lazy-lotto buy <poolId> <count> [--json]');
		process.exit(1);
	}

	const poolId = parseInt(poolIdArg);
	const quantity = parseInt(countArg);

	if (isNaN(poolId) || poolId < 0) {
		console.error('Invalid pool ID. Must be a non-negative integer.');
		process.exit(1);
	}

	if (isNaN(quantity) || quantity <= 0) {
		console.error('Invalid quantity. Must be a positive integer.');
		process.exit(1);
	}

	const env = process.env.ENVIRONMENT ?? 'testnet';
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);

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
		// Get pool details
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
		const [, , winRate, entryFee, , , , paused, closed, feeToken] = poolInfo;

		if (paused) {
			console.error('Pool is paused. Cannot buy entries.');
			process.exit(1);
		}

		if (closed) {
			console.error('Pool is closed. Cannot buy entries.');
			process.exit(1);
		}

		// Process fee token
		const feeTokenAddr = feeToken;
		let feeTokenId = 'HBAR';
		let feeDecimals = 8;
		let feeSymbol = 'HBAR';
		let tokenDets = null;

		if (feeTokenAddr !== '0x0000000000000000000000000000000000000000') {
			feeTokenId = await homebrewPopulateAccountNum(env, feeTokenAddr, EntityType.TOKEN);
			tokenDets = await getTokenDetails(env, feeTokenId);
			feeDecimals = tokenDets.decimals;
			feeSymbol = tokenDets.symbol;
		}

		const totalFee = BigInt(entryFee) * BigInt(quantity);
		const totalFeeFormatted = feeTokenId === 'HBAR'
			? new Hbar(Number(totalFee), HbarUnit.Tinybar).toString()
			: `${Number(totalFee) / (10 ** feeDecimals)} ${feeSymbol}`;

		// Check balance and allowance for FT payment
		if (feeTokenId !== 'HBAR') {
			const balance = await checkMirrorBalance(env, operatorId.toString(), feeTokenId);

			if (BigInt(balance) < totalFee) {
				const result = {
					success: false,
					error: 'Insufficient balance',
					required: Number(totalFee) / (10 ** feeDecimals),
					available: Number(balance) / (10 ** feeDecimals),
					token: feeSymbol,
				};
				if (outputJson) {
					console.log(JSON.stringify(result, null, 2));
				}
				else {
					console.error(`Insufficient ${feeSymbol} balance.`);
					console.error(`Required: ${result.required} ${feeSymbol}`);
					console.error(`Available: ${result.available} ${feeSymbol}`);
				}
				process.exit(1);
			}

			// Get storage contract for allowance
			encoded = lazyLottoIface.encodeFunctionData('storageContract');
			data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
			const storageAddress = lazyLottoIface.decodeFunctionResult('storageContract', data)[0];
			const storageId = await homebrewPopulateAccountNum(env, storageAddress, EntityType.CONTRACT);

			// Check for LAZY token (uses LazyGasStation) vs other FTs
			const lazyTokenIdStr = process.env.LAZY_TOKEN_ID;
			const isLazy = lazyTokenIdStr && feeTokenId === lazyTokenIdStr;
			const spenderContractId = isLazy ? process.env.LAZY_GAS_STATION_CONTRACT_ID : storageId;

			const currentAllowance = await checkMirrorAllowance(env, operatorId.toString(), feeTokenId, spenderContractId);

			if (BigInt(currentAllowance) < totalFee) {
				if (!outputJson) {
					console.log(`Setting ${feeSymbol} allowance...`);
				}

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
					console.error('Failed to set token allowance');
					process.exit(1);
				}

				// Wait for mirror node sync
				await new Promise(resolve => setTimeout(resolve, 5000));
			}
		}

		// Estimate gas
		const gasInfo = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'buyEntry',
			[poolId, quantity],
			500000,
			feeTokenId === 'HBAR' ? Number(totalFee) : 0,
		);
		const gasLimit = Math.floor(gasInfo.gasLimit * 1.2);

		if (!outputJson) {
			console.log(`\nBuying ${quantity} entries in pool #${poolId}...`);
			console.log(`Total cost: ${totalFeeFormatted}`);
		}

		// Execute purchase
		const payableAmount = feeTokenId === 'HBAR' ? totalFee : 0;
		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'buyEntry',
			[poolId, quantity],
			new Hbar(payableAmount, HbarUnit.Tinybar),
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('Transaction failed');
			process.exit(1);
		}

		// Wait for mirror node
		await new Promise(resolve => setTimeout(resolve, 5000));

		// Get updated entry count
		const userEvmAddress = await homebrewPopulateAccountEvmAddress(env, operatorId.toString());
		encoded = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userEvmAddress]);
		data = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const newEntries = Number(lazyLottoIface.decodeFunctionResult('getUsersEntries', data)[0]);

		const result = {
			success: true,
			transaction: {
				id: record.transactionId.toString(),
				poolId,
				quantity,
				totalCost: totalFeeFormatted,
				feeToken: feeTokenId,
			},
			state: {
				totalEntries: newEntries,
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
			console.log(`\nEntries purchased successfully!`);
			console.log(`Transaction: ${record.transactionId.toString()}`);
			console.log(`\nYou now have ${newEntries} entries in pool #${poolId}`);
			console.log(`Use "lazy-lotto roll ${poolId}" to play your entries.`);
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
