/**
 * LazyLotto View Pool Info Script (Extended)
 *
 * Shows extended pool information including ownership and proceeds (PoolManager data).
 * Use this for community pools to see ownership and financial details.
 * For basic pool info, use queries/poolInfo.js instead.
 *
 * Usage: node scripts/interactions/LazyLotto/user/view-pool-info.js --pool <poolId>
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

const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? 'testnet';
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
const lazyTokenId = process.env.LAZY_TOKEN_ID;

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
async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

async function viewPoolInfo() {
	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let poolId = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--pool' && args[i + 1]) {
				poolId = parseInt(args[i + 1]);
				i++;
			}
		}

		if (!poolId && poolId !== 0) {
			const input = await prompt('Enter pool ID: ');
			poolId = parseInt(input);
		}

		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Normalize environment name
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
		console.log('║         LazyLotto Pool Info (Extended)                    ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABIs
		const poolManagerJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json'),
		);
		const poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

		console.log('🔍 Fetching pool ownership...\n');

		// Get pool owner
		let encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [poolId]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const ownerAddress = poolManagerIface.decodeFunctionResult('getPoolOwner', result)[0];

		const poolOwner = await convertToHederaId(ownerAddress);
		const isGlobalPool = ownerAddress === '0x0000000000000000000000000000000000000000';

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  OWNERSHIP');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Type:             ${isGlobalPool ? 'Global (Admin-owned)' : 'Community (User-owned)'}`);
		console.log(`  Owner:            ${isGlobalPool ? 'N/A (Global pool)' : poolOwner}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Get proceeds for HBAR
		console.log('🔍 Fetching HBAR proceeds...\n');
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			poolId,
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const [hbarTotal, hbarWithdrawn] = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);
		const hbarAvailable = BigInt(hbarTotal) - BigInt(hbarWithdrawn);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  HBAR PROCEEDS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total Collected:  ${new Hbar(Number(hbarTotal), HbarUnit.Tinybar).toString()}`);
		console.log(`  Withdrawn:        ${new Hbar(Number(hbarWithdrawn), HbarUnit.Tinybar).toString()}`);
		console.log(`  Available:        ${new Hbar(Number(hbarAvailable), HbarUnit.Tinybar).toString()}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Get proceeds for LAZY (if applicable)
		if (lazyTokenId) {
			console.log('🔍 Fetching LAZY proceeds...\n');
			const lazyTokenAddress = await convertToHederaId(lazyTokenId, EntityType.TOKEN);

			// Need to convert to solidity address
			const lazyTokenSolidity = '0x' + Buffer.from(lazyTokenAddress.split('.').map(n => parseInt(n))).toString('hex').padStart(40, '0');

			encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [poolId, lazyTokenSolidity]);
			result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
			const [lazyTotal, lazyWithdrawn] = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);
			const lazyAvailable = BigInt(lazyTotal) - BigInt(lazyWithdrawn);

			console.log('═══════════════════════════════════════════════════════════');
			console.log('  LAZY PROCEEDS');
			console.log('═══════════════════════════════════════════════════════════');
			console.log(`  Total Collected:  ${lazyTotal} LAZY`);
			console.log(`  Withdrawn:        ${lazyWithdrawn} LAZY`);
			console.log(`  Available:        ${lazyAvailable} LAZY`);
			console.log('═══════════════════════════════════════════════════════════\n');
		}

		console.log('💡 For detailed pool configuration (win rate, prizes, etc.), use:');
		console.log(`   node scripts/interactions/LazyLotto/queries/poolInfo.js ${poolId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error fetching pool info:', error.message);
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
viewPoolInfo();
