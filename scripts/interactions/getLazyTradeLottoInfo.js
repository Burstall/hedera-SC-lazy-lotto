const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'LazyTradeLotto';
const LAZY_TOKEN_ID = process.env.LAZY_TOKEN_ID;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	// configure the client object
	if (
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length === 0 || getArgFlag('h')) {
		console.log('Usage: getLazyTradeLottoInfo.js 0.0.LTL');
		console.log('       LTL is the LazyTradeLotto contract address');
		return;
	}

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());

	// import ABI
	const ltlJSON = JSON.parse(
		fs.readFileSync(
			`./abi/${contractName}.json`,
		),
	);

	const ltlIface = new ethers.Interface(ltlJSON);

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using Contract:', contractId.toString());

	// Get the lazy token decimal if available
	let lazyTokenDecimals = LAZY_DECIMAL;
	if (LAZY_TOKEN_ID) {
		const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);
		const lazyTokenDetails = await getTokenDetails(env, lazyToken);
		if (lazyTokenDetails && lazyTokenDetails.decimals !== undefined) {
			lazyTokenDecimals = lazyTokenDetails.decimals;
		}
	}

	// Get LSH tokens
	const lshGen1Command = ltlIface.encodeFunctionData('LSH_GEN1');
	const lshGen1Response = await readOnlyEVMFromMirrorNode(
		env, contractId, lshGen1Command, operatorId, false,
	);
	const lshGen1 = ltlIface.decodeFunctionResult('LSH_GEN1', lshGen1Response)[0];

	const lshGen2Command = ltlIface.encodeFunctionData('LSH_GEN2');
	const lshGen2Response = await readOnlyEVMFromMirrorNode(
		env, contractId, lshGen2Command, operatorId, false,
	);
	const lshGen2 = ltlIface.decodeFunctionResult('LSH_GEN2', lshGen2Response)[0];

	const lshMutantCommand = ltlIface.encodeFunctionData('LSH_GEN1_MUTANT');
	const lshMutantResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, lshMutantCommand, operatorId, false,
	);
	const lshMutant = ltlIface.decodeFunctionResult('LSH_GEN1_MUTANT', lshMutantResponse)[0];

	// Get connected contracts
	const prngCommand = ltlIface.encodeFunctionData('prngSystemContract');
	const prngResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, prngCommand, operatorId, false,
	);
	const prngContract = ltlIface.decodeFunctionResult('prngSystemContract', prngResponse)[0];

	const lgsCommand = ltlIface.encodeFunctionData('lazyGasStation');
	const lgsResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, lgsCommand, operatorId, false,
	);
	const lgsContract = ltlIface.decodeFunctionResult('lazyGasStation', lgsResponse)[0];

	const ldrCommand = ltlIface.encodeFunctionData('lazyDelegateRegistry');
	const ldrResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, ldrCommand, operatorId, false,
	);
	const ldrContract = ltlIface.decodeFunctionResult('lazyDelegateRegistry', ldrResponse)[0];

	// Get system wallet
	const systemWalletCommand = ltlIface.encodeFunctionData('systemWallet');
	const systemWalletResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, systemWalletCommand, operatorId, false,
	);
	const systemWallet = ltlIface.decodeFunctionResult('systemWallet', systemWalletResponse)[0];

	// Get burn percentage
	const burnPercentageCommand = ltlIface.encodeFunctionData('burnPercentage');
	const burnPercentageResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, burnPercentageCommand, operatorId, false,
	);
	const burnPercentage = ltlIface.decodeFunctionResult('burnPercentage', burnPercentageResponse)[0];

	// Get lotto stats
	const lottoStatsCommand = ltlIface.encodeFunctionData('getLottoStats');
	const lottoStatsResponse = await readOnlyEVMFromMirrorNode(
		env, contractId, lottoStatsCommand, operatorId, false,
	);
	const lottoStats = ltlIface.decodeFunctionResult('getLottoStats', lottoStatsResponse);

	console.log('\n----- LazyTradeLotto Contract Info -----');
	console.log('\nLSH Tokens:');
	console.log('  LSH_GEN1: ', TokenId.fromSolidityAddress(lshGen1).toString());
	console.log('  LSH_GEN2: ', TokenId.fromSolidityAddress(lshGen2).toString());
	console.log('  LSH_GEN1_MUTANT: ', TokenId.fromSolidityAddress(lshMutant).toString());

	console.log('\nConnected Contracts:');
	console.log('  PRNG System Contract: ', ContractId.fromSolidityAddress(prngContract).toString());
	console.log('  Lazy Gas Station: ', ContractId.fromSolidityAddress(lgsContract).toString());
	console.log('  Lazy Delegate Registry: ', ContractId.fromSolidityAddress(ldrContract).toString());

	console.log('\nConfiguration:');
	console.log('  System Wallet: ', AccountId.fromEvmAddress(0, 0, systemWallet).toString());
	console.log('  Burn Percentage: ', Number(burnPercentage), '%');

	console.log('\nLotto Stats:');
	console.log('  Jackpot Pool: ', Number(lottoStats[0]) / (10 ** lazyTokenDecimals), ' $LAZY');
	console.log('  Jackpots Won: ', Number(lottoStats[1]));
	console.log('  Jackpot Paid: ', Number(lottoStats[2]) / (10 ** lazyTokenDecimals), ' $LAZY');
	console.log('  Total Rolls: ', Number(lottoStats[3]));
	console.log('  Total Wins: ', Number(lottoStats[4]));
	console.log('  Total Paid: ', Number(lottoStats[5]) / (10 ** lazyTokenDecimals), ' $LAZY');
	console.log('  Jackpot Loss Increment: ', Number(lottoStats[6]) / (10 ** lazyTokenDecimals), ' $LAZY');
	console.log('  Maximum Jackpot Threshold: ', Number(lottoStats[7]) / (10 ** lazyTokenDecimals), ' $LAZY');
};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});