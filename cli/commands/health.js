/**
 * Health Check Command
 *
 * Quick system status check for all LazyLotto ecosystem contracts.
 *
 * Usage: lazy-lotto health [--json]
 */

const {
	AccountId,
	ContractId,
	TokenId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const path = require('path');

const { LazyLottoABI, LazyTradeLottoABI, LazyDelegateRegistryABI } = require('../../index');

// Resolve utils from package root
const utilsPath = path.join(__dirname, '../../utils');
const { readOnlyEVMFromMirrorNode } = require(`${utilsPath}/solidityHelpers`);
const { getBaseURL, getAccountBalance } = require(`${utilsPath}/hederaMirrorHelpers`);
const axios = require('axios');

module.exports = async function health(args) {
	const outputJson = args.includes('--json');
	const env = process.env.ENVIRONMENT ?? 'testnet';
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

	// Contract IDs from env (all optional)
	const lazyLottoId = process.env.LAZY_LOTTO_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID) : null;
	const lazyTradeLottoId = process.env.LAZY_TRADE_LOTTO_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_TRADE_LOTTO_CONTRACT_ID) : null;
	const lazyGasStationId = process.env.LAZY_GAS_STATION_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID) : null;
	const lazyDelegateRegistryId = process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) : null;
	const lazyTokenId = process.env.LAZY_TOKEN_ID ? TokenId.fromString(process.env.LAZY_TOKEN_ID) : null;
	const lazyDecimals = parseInt(process.env.LAZY_DECIMALS ?? '8');

	const timestamp = new Date().toISOString();

	// Create ethers interfaces
	const lazyLottoIface = new ethers.Interface(LazyLottoABI);
	const lazyTradeLottoIface = new ethers.Interface(LazyTradeLottoABI);
	const lazyDelegateRegistryIface = new ethers.Interface(LazyDelegateRegistryABI);

	// Check functions
	async function contractExists(contractId) {
		try {
			const baseUrl = getBaseURL(env);
			const response = await axios.get(`${baseUrl}/api/v1/contracts/${contractId.toString()}`);
			return response.status === 200;
		}
		catch {
			return false;
		}
	}

	async function checkLazyLotto() {
		if (!lazyLottoId) return { configured: false, status: 'not_configured', details: {} };

		try {
			if (!await contractExists(lazyLottoId)) {
				return { configured: true, contractId: lazyLottoId.toString(), status: 'not_found', details: {} };
			}

			let encoded = lazyLottoIface.encodeFunctionData('paused');
			let data = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encoded, operatorId, false);
			const isPaused = lazyLottoIface.decodeFunctionResult('paused', data)[0];

			encoded = lazyLottoIface.encodeFunctionData('totalPools');
			data = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encoded, operatorId, false);
			const totalPools = Number(lazyLottoIface.decodeFunctionResult('totalPools', data)[0]);

			return {
				configured: true,
				contractId: lazyLottoId.toString(),
				status: isPaused ? 'paused' : 'operational',
				details: { paused: isPaused, totalPools },
			};
		}
		catch (error) {
			return { configured: true, contractId: lazyLottoId.toString(), status: 'error', error: error.message };
		}
	}

	async function checkLazyTradeLotto() {
		if (!lazyTradeLottoId) return { configured: false, status: 'not_configured', details: {} };

		try {
			if (!await contractExists(lazyTradeLottoId)) {
				return { configured: true, contractId: lazyTradeLottoId.toString(), status: 'not_found', details: {} };
			}

			let encoded = lazyTradeLottoIface.encodeFunctionData('paused');
			let data = await readOnlyEVMFromMirrorNode(env, lazyTradeLottoId, encoded, operatorId, false);
			const isPaused = lazyTradeLottoIface.decodeFunctionResult('paused', data)[0];

			encoded = lazyTradeLottoIface.encodeFunctionData('jackpot');
			data = await readOnlyEVMFromMirrorNode(env, lazyTradeLottoId, encoded, operatorId, false);
			const jackpot = lazyTradeLottoIface.decodeFunctionResult('jackpot', data)[0];
			const jackpotFormatted = Number(jackpot) / (10 ** lazyDecimals);

			return {
				configured: true,
				contractId: lazyTradeLottoId.toString(),
				status: isPaused ? 'paused' : 'operational',
				details: { paused: isPaused, jackpot: jackpotFormatted },
			};
		}
		catch (error) {
			return { configured: true, contractId: lazyTradeLottoId.toString(), status: 'error', error: error.message };
		}
	}

	async function checkLazyGasStation() {
		if (!lazyGasStationId) return { configured: false, status: 'not_configured', details: {} };

		try {
			if (!await contractExists(lazyGasStationId)) {
				return { configured: true, contractId: lazyGasStationId.toString(), status: 'not_found', details: {} };
			}

			const balance = await getAccountBalance(env, lazyGasStationId.toString());
			if (balance) {
				const hbarBalance = balance.balance || 0;
				let lazyBalance = 0;
				if (lazyTokenId && balance.tokens) {
					const lazyTokenEntry = balance.tokens.find(t => t.token_id === lazyTokenId.toString());
					if (lazyTokenEntry) lazyBalance = lazyTokenEntry.balance;
				}

				const lowHbar = hbarBalance < 10_00000000;
				const lowLazy = lazyBalance < 1000 * (10 ** lazyDecimals);

				return {
					configured: true,
					contractId: lazyGasStationId.toString(),
					status: (lowHbar || lowLazy) ? 'low_balance' : 'operational',
					details: {
						hbarBalance: new Hbar(hbarBalance, HbarUnit.Tinybar).toString(),
						lazyBalance: lazyBalance / (10 ** lazyDecimals),
					},
				};
			}
			return { configured: true, contractId: lazyGasStationId.toString(), status: 'error', error: 'Could not fetch balance' };
		}
		catch (error) {
			return { configured: true, contractId: lazyGasStationId.toString(), status: 'error', error: error.message };
		}
	}

	// Run checks
	const [lazyLotto, lazyTradeLotto, lazyGasStation] = await Promise.all([
		checkLazyLotto(),
		checkLazyTradeLotto(),
		checkLazyGasStation(),
	]);

	const result = {
		success: true,
		timestamp,
		environment: env.toUpperCase(),
		contracts: { lazyLotto, lazyTradeLotto, lazyGasStation },
	};

	if (outputJson) {
		console.log(JSON.stringify(result, null, 2));
	}
	else {
		console.log('\nLazyLotto System Health Check');
		console.log('='.repeat(50));
		console.log(`Environment: ${env.toUpperCase()}`);
		console.log(`Timestamp:   ${timestamp}\n`);

		const formatStatus = (s) => {
			switch (s) {
			case 'operational': return '🟢 Operational';
			case 'paused': return '⏸️  Paused';
			case 'low_balance': return '⚠️  Low Balance';
			case 'not_configured': return '⚪ Not Configured';
			case 'not_found': return '🔴 Not Found';
			default: return '🔴 Error';
			}
		};

		console.log(`LazyLotto:        ${formatStatus(lazyLotto.status)}`);
		if (lazyLotto.details?.totalPools !== undefined) {
			console.log(`  Pools: ${lazyLotto.details.totalPools}`);
		}

		console.log(`LazyTradeLotto:   ${formatStatus(lazyTradeLotto.status)}`);
		if (lazyTradeLotto.details?.jackpot !== undefined) {
			console.log(`  Jackpot: ${lazyTradeLotto.details.jackpot.toLocaleString()} LAZY`);
		}

		console.log(`LazyGasStation:   ${formatStatus(lazyGasStation.status)}`);
		if (lazyGasStation.details?.hbarBalance) {
			console.log(`  HBAR: ${lazyGasStation.details.hbarBalance}`);
			console.log(`  LAZY: ${lazyGasStation.details.lazyBalance?.toLocaleString() ?? 0}`);
		}

		console.log();
	}
};
