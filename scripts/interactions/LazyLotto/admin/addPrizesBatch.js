const fs = require('fs').promises;
const readline = require('readline');
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
const { setNFTAllowanceAll, setFTAllowance } = require('../../../../utils/hederaHelpers');
const {
	homebrewPopulateAccountNum,
	EntityType,
	getNFTApprovedForAllAllowances,
	checkMirrorBalance,
	getTokenDetails,
	checkFTAllowances,
} = require('../../../../utils/hederaMirrorHelpers');
const { getArgFlag, getArg, sleep } = require('../../../../utils/nodeHelpers');
const { checkMirrorHbarBalance, getSerialsOwned } = require('../../../../utils/hederaMirrorHelpers');
// Import contract execution helper
const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
require('dotenv').config();

// Helper: Convert Hedera ID to EVM address (matches addPrizePackage.js)
function convertToEvmAddress(hederaId) {
	if (hederaId.startsWith('0x')) return hederaId;
	const parts = hederaId.split('.');
	const num = parts[parts.length - 1];
	return '0x' + BigInt(num).toString(16).padStart(40, '0');
}

async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	return await homebrewPopulateAccountNum(process.env.ENVIRONMENT ?? 'testnet', evmAddress, entityType);
}

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

/**
 * Batch add prize packages to a LazyLotto pool from a JSON file
 *
 * Each prize package is ONE of these types:
 * Type A: HBAR only
 * Type B: FT only
 * Type C: NFT(s) only - one or more collections with serials
 * Type D: HBAR + NFT(s)
 * Type E: FT + NFT(s)
 *
 * JSON Format:
 * {
 *   "poolId": 0,
 *   "packages": [
 *     {"hbar": "10"},
 *     {"ft": {"token": "0.0.12345", "amount": "100"}},
 *     {"nfts": [{"token": "0.0.67890", "serials": [1, 2, 3]}]},
 *     {"hbar": "5", "nfts": [{"token": "0.0.99999", "serials": [1]}]},
 *     {"ft": {"token": "0.0.12345", "amount": "50"}, "nfts": [{"token": "0.0.67890", "serials": [4]}]}
 *   ]
 * }
 *
 * Notes:
 * - HBAR amounts are in HBAR (e.g., "10" = 10 HBAR, automatically converted to tinybars)
 * - FT amounts are human-readable (e.g., "100" = 100 tokens, automatically converted using token decimals)
 * - Script fetches token details from mirror node for automatic conversion
 *
 *
 * Usage:
 *   node addPrizesBatch.js -f prizes.json
 *   node addPrizesBatch.js -f prizes.json -dry  (dry run - validate only)
 */

const main = async () => {
	// Load required environment variables
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
	const storageId = process.env.LAZY_LOTTO_STORAGE;
	const env = process.env.ENVIRONMENT ?? 'testnet';

	// Validate environment
	if (!process.env.ACCOUNT_ID || !process.env.PRIVATE_KEY) {
		console.error('❌ Missing ACCOUNT_ID or PRIVATE_KEY in .env');
		process.exit(1);
	}

	if (!process.env.LAZY_LOTTO_CONTRACT_ID || !storageId) {
		console.error('❌ Missing LAZY_LOTTO_CONTRACT_ID or LAZY_LOTTO_STORAGE in .env');
		process.exit(1);
	}

	// Parse command line arguments
	const filePath = getArg('f') || getArg('-file');
	const dryRun = getArgFlag('dry') || getArgFlag('-dry-run');

	if (!filePath) {
		console.error('❌ Usage: node addPrizesBatch.js -f <file.json> [-dry]');
		console.error('\nJSON Format:');
		console.error(JSON.stringify({
			poolId: 0,
			prizes: [
				{ type: 'HBAR', amount: '10' },
				{ type: 'FT', token: '0.0.12345', amount: '100' },
				{ type: 'NFT', token: '0.0.67890', serials: [1, 2, 3] },
			],
		}, null, 2));
		process.exit(1);
	}

	console.log('\n🎁 Batch Prize Upload Tool');
	console.log('==========================\n');
	console.log(`📄 File: ${filePath}`);
	if (dryRun) {
		console.log('🧪 Mode: DRY RUN (validation only)\n');
	}
	else {
		console.log('🚀 Mode: LIVE (will submit transaction)\n');
	}

	// Read and parse JSON file
	let config;
	try {
		const fileContent = await fs.readFile(filePath, 'utf-8');
		config = JSON.parse(fileContent);
	}
	catch (error) {
		console.error('❌ Error reading file:', error.message);
		process.exit(1);
	}

	// Validate configuration
	if (!config.poolId && config.poolId !== 0) {
		console.error('❌ Missing poolId in JSON');
		process.exit(1);
	}

	if (!Array.isArray(config.packages) || config.packages.length === 0) {
		console.error('❌ Missing or empty packages array in JSON');
		process.exit(1);
	}

	console.log(`🎯 Pool ID: ${config.poolId}`);
	console.log(`📦 Prize Packages: ${config.packages.length}\n`);

	// Normalize environment name
	const envUpper = env.toUpperCase();

	// Initialize client
	let client;
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

	// Process and validate packages
	const processedPackages = [];
	const allNftTokens = new Set();
	const allNftSerials = new Map();
	// Track all serials needed per token
	const ftTokensNeeded = new Map();
	// Track total FT amounts needed per token
	// Cache token details to avoid duplicate queries
	const tokenDetailsCache = new Map();

	// Track validation failures
	let hasValidationErrors = false;
	const validationErrors = [];

	let packageIndex = 1;
	for (const pkg of config.packages) {
		console.log(`\n📦 Package ${packageIndex}/${config.packages.length}:`);

		try {
			const processedPkg = {
				ftToken: '0x0000000000000000000000000000000000000000',
				ftAmount: '0',
				nftTokens: [],
				nftSerials: [],
			};

			// Process HBAR (optional) - stored in ftToken/ftAmount
			if (pkg.hbar) {
				const amount = Math.floor(parseFloat(pkg.hbar) * 100_000_000);
				processedPkg.ftToken = '0x0000000000000000000000000000000000000000';
				processedPkg.ftAmount = amount.toString();

				// Check HBAR balance
				const hbarBalance = await checkMirrorHbarBalance(env, operatorId);
				const hasEnough = hbarBalance !== null && hbarBalance >= amount;
				const status = hasEnough ? '✅' : '⚠️';

				console.log(`   ${status} HBAR: ${pkg.hbar} ℏ (${amount} tinybars)`);
				if (hbarBalance !== null) {
					console.log(`      Balance: ${new Hbar(hbarBalance, HbarUnit.Tinybar).toString()}`);
				}

				if (!hasEnough) {
					hasValidationErrors = true;
					validationErrors.push(`Package ${packageIndex}: Insufficient HBAR balance`);
				}

				// Track for summary
				const currentHbar = ftTokensNeeded.get('HBAR') || 0;
				ftTokensNeeded.set('HBAR', currentHbar + amount);
			}

			// Process FT (optional)
			if (pkg.ft) {
				if (!pkg.ft.token || !pkg.ft.amount) {
					throw new Error('FT missing token or amount');
				}

				// Convert to Hedera ID first for lookup
				const tokenIdHedera = pkg.ft.token.startsWith('0x')
					? await convertToHederaId(pkg.ft.token, EntityType.TOKEN)
					: pkg.ft.token;

				// Get token details to convert human-readable amount to base units
				if (!tokenDetailsCache.has(tokenIdHedera)) {
					const tokenDetails = await getTokenDetails(env, tokenIdHedera);
					tokenDetailsCache.set(tokenIdHedera, tokenDetails);
				}
				const tokenDetails = tokenDetailsCache.get(tokenIdHedera);

				// Convert human-readable amount to base units using decimals
				const humanReadableAmount = parseFloat(pkg.ft.amount);
				const amount = Math.floor(humanReadableAmount * (10 ** tokenDetails.decimals));

				// Check FT balance
				const ftBalance = await checkMirrorBalance(env, operatorId, tokenIdHedera);
				const hasEnough = ftBalance !== null && ftBalance >= amount;
				const status = hasEnough ? '✅' : '⚠️';

				// Store as EVM address for contract call
				processedPkg.ftToken = convertToEvmAddress(tokenIdHedera);
				processedPkg.ftAmount = amount.toString();

				console.log(`   ${status} FT: ${pkg.ft.amount} ${tokenDetails.symbol} (${tokenIdHedera})`);
				console.log(`      Name: ${tokenDetails.name}`);
				console.log(`      Base units: ${amount}`);
				if (ftBalance !== null) {
					const humanBalance = ftBalance / (10 ** tokenDetails.decimals);
					console.log(`      Balance: ${humanBalance} ${tokenDetails.symbol}`);
				}

				if (!hasEnough) {
					hasValidationErrors = true;
					validationErrors.push(`Package ${packageIndex}: Insufficient ${tokenDetails.symbol} balance`);
				}

				// Track for summary
				const currentAmount = ftTokensNeeded.get(tokenIdHedera) || 0;
				ftTokensNeeded.set(tokenIdHedera, currentAmount + amount);
			}

			// Process NFTs (optional, can be array)
			if (pkg.nfts && Array.isArray(pkg.nfts)) {
				for (const nft of pkg.nfts) {
					if (!nft.token || !Array.isArray(nft.serials) || nft.serials.length === 0) {
						throw new Error('NFT missing token or serials array');
					}

					// Convert to Hedera ID for display/tracking
					const tokenIdHedera = nft.token.startsWith('0x')
						? await convertToHederaId(nft.token, EntityType.TOKEN)
						: nft.token;

					// Get token details for name
					if (!tokenDetailsCache.has(tokenIdHedera)) {
						const tokenDetails = await getTokenDetails(env, tokenIdHedera);
						tokenDetailsCache.set(tokenIdHedera, tokenDetails);
					}
					const tokenDetails = tokenDetailsCache.get(tokenIdHedera);

					// Check NFT ownership
					const ownedSerials = await getSerialsOwned(env, operatorId, tokenIdHedera);
					const serials = nft.serials.map(s => parseInt(s));

					// Validate each serial
					let allOwned = true;
					const serialStatuses = serials.map(serial => {
						const owned = ownedSerials && ownedSerials.includes(serial);
						if (!owned) allOwned = false;
						return { serial, owned };
					});

					const status = allOwned ? '✅' : '⚠️';

					// Store as EVM address for contract call
					const tokenEvmAddr = convertToEvmAddress(tokenIdHedera);

					processedPkg.nftTokens.push(tokenEvmAddr);
					processedPkg.nftSerials.push(serials);
					allNftTokens.add(tokenIdHedera);

					console.log(`   ${status} NFT: ${tokenIdHedera}`);
					console.log(`      Name: ${tokenDetails.name || 'Unknown'}`);
					console.log(`      Symbol: ${tokenDetails.symbol || tokenIdHedera}`);
					console.log(`      Serials: ${serials.map((s, i) => {
						const owned = serialStatuses[i].owned;
						return `${s}${owned ? '✅' : '❌'}`;
					}).join(', ')}`);

					if (!allOwned) {
						const missing = serialStatuses.filter(s => !s.owned).map(s => s.serial);
						console.log(`      ⚠️  Missing serials: ${missing.join(', ')}`);
						hasValidationErrors = true;
						validationErrors.push(`Package ${packageIndex}: Missing NFT serials for ${tokenIdHedera}: ${missing.join(', ')}`);
					}

					// Track for summary
					if (!allNftSerials.has(tokenIdHedera)) {
						allNftSerials.set(tokenIdHedera, new Set());
					}
					serials.forEach(s => allNftSerials.get(tokenIdHedera).add(s));
				}
			}

			// Validate package has at least one component
			if (processedPkg.ftAmount === '0' && processedPkg.nftTokens.length === 0) {
				throw new Error('Package must have at least one: hbar, ft, or nfts');
			}

			// Determine package type
			const hasHbar = processedPkg.ftToken === '0x0000000000000000000000000000000000000000' && processedPkg.ftAmount !== '0';
			const hasFt = processedPkg.ftToken !== '0x0000000000000000000000000000000000000000' && processedPkg.ftAmount !== '0';
			const hasNft = processedPkg.nftTokens.length > 0;

			let pkgType = '';
			if (hasHbar && !hasFt && !hasNft) pkgType = 'Type A (HBAR)';
			else if (!hasHbar && hasFt && !hasNft) pkgType = 'Type B (FT)';
			else if (!hasHbar && !hasFt && hasNft) pkgType = 'Type C (NFT)';
			else if (hasHbar && !hasFt && hasNft) pkgType = 'Type D (HBAR+NFT)';
			else if (!hasHbar && hasFt && hasNft) pkgType = 'Type E (FT+NFT)';
			else throw new Error('Invalid package combination');

			console.log(`   ✅ ${pkgType}`);
			processedPackages.push(processedPkg);
		}
		catch (error) {
			console.error(`   ❌ Error: ${error.message}`);
			process.exit(1);
		}

		packageIndex++;
	}

	// Summary
	// Load contract ABIs for LazyLotto and error decoding
	const contractJson = JSON.parse(
		require('fs').readFileSync('./artifacts/contracts/LazyLotto.sol/LazyLotto.json'),
	);
	const iface = new ethers.Interface(contractJson.abi);

	// Load additional interfaces for error decoding
	const lazyGasStationJson = JSON.parse(
		require('fs').readFileSync('./artifacts/contracts/LazyGasStation.sol/LazyGasStation.json'),
	);
	const lazyGasStationIface = new ethers.Interface(lazyGasStationJson.abi);

	const lazyLottoStorageJson = JSON.parse(
		require('fs').readFileSync('./artifacts/contracts/LazyLottoStorage.sol/LazyLottoStorage.json'),
	);
	const lazyLottoStorageIface = new ethers.Interface(lazyLottoStorageJson.abi);

	// Set global error interfaces for contractExecuteFunction to use
	global.errorInterfaces = [iface, lazyGasStationIface, lazyLottoStorageIface];

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  PACKAGE TYPE SUMMARY');
	console.log('═══════════════════════════════════════════════════════════');
	const typeACounts = processedPackages.filter(p => p.ftToken === '0x0000000000000000000000000000000000000000' && p.ftAmount !== '0' && p.nftTokens.length === 0).length;
	const typeBCounts = processedPackages.filter(p => p.ftToken !== '0x0000000000000000000000000000000000000000' && p.ftAmount !== '0' && p.nftTokens.length === 0).length;
	const typeCCounts = processedPackages.filter(p => p.ftAmount === '0' && p.nftTokens.length > 0).length;
	const typeDCounts = processedPackages.filter(p => p.ftToken === '0x0000000000000000000000000000000000000000' && p.ftAmount !== '0' && p.nftTokens.length > 0).length;
	const typeECounts = processedPackages.filter(p => p.ftToken !== '0x0000000000000000000000000000000000000000' && p.ftAmount !== '0' && p.nftTokens.length > 0).length;

	console.log(`  Type A (HBAR only):     ${typeACounts}`);
	console.log(`  Type B (FT only):       ${typeBCounts}`);
	console.log(`  Type C (NFT only):      ${typeCCounts}`);
	console.log(`  Type D (HBAR+NFT):      ${typeDCounts}`);
	console.log(`  Type E (FT+NFT):        ${typeECounts}`);
	console.log(`  Total Packages:         ${processedPackages.length}`);
	console.log('═══════════════════════════════════════════════════════════\n');

	// Aggregate summary of tokens needed
	console.log('═══════════════════════════════════════════════════════════');
	console.log('  TOTAL TOKENS NEEDED');
	console.log('═══════════════════════════════════════════════════════════');

	// FT/HBAR summary
	if (ftTokensNeeded.size > 0) {
		console.log('\n  Fungible Tokens:');
		for (const [tokenId, amount] of ftTokensNeeded.entries()) {
			if (tokenId === 'HBAR') {
				console.log(`    • HBAR: ${new Hbar(amount, HbarUnit.Tinybar).toString()}`);
			}
			else {
				const tokenDetails = tokenDetailsCache.get(tokenId);
				const humanAmount = amount / (10 ** tokenDetails.decimals);
				console.log(`    • ${tokenDetails.symbol}: ${humanAmount}`);
				console.log(`      Token: ${tokenId}`);
				console.log(`      Name: ${tokenDetails.name}`);
			}
		}
	}

	// NFT summary
	if (allNftSerials.size > 0) {
		console.log('\n  NFT Collections:');
		for (const [tokenId, serialsSet] of allNftSerials.entries()) {
			const tokenDetails = tokenDetailsCache.get(tokenId);
			const serials = Array.from(serialsSet).sort((a, b) => a - b);
			console.log(`    • ${tokenDetails.symbol || tokenId}: ${serials.length} NFT(s)`);
			console.log(`      Token: ${tokenId}`);
			console.log(`      Name: ${tokenDetails.name || 'Unknown'}`);
			console.log(`      Serials: ${serials.join(', ')}`);
		}
	}

	console.log('\n═══════════════════════════════════════════════════════════\n');

	// Get LAZY token and storage contract addresses for FT allowances
	console.log('🔍 Fetching contract dependencies...');
	const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

	let encodedCommand = iface.encodeFunctionData('lazyToken');
	let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
	const lazyTokenAddrResult = iface.decodeFunctionResult('lazyToken', result);
	const lazyTokenAddr = lazyTokenAddrResult[0];
	const lazyTokenId = await convertToHederaId(lazyTokenAddr, EntityType.TOKEN);

	encodedCommand = iface.encodeFunctionData('lazyGasStation');
	result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
	const lazyGasStationAddrResult = iface.decodeFunctionResult('lazyGasStation', result);
	const lazyGasStationAddr = lazyGasStationAddrResult[0];
	const lazyGasStationId = await convertToHederaId(lazyGasStationAddr, EntityType.CONTRACT);

	console.log(`✅ LAZY Token: ${lazyTokenId}`);
	console.log(`✅ LazyGasStation: ${lazyGasStationId}`);
	console.log(`✅ Storage: ${storageId}\n`);

	// Handle FT allowances
	if (ftTokensNeeded.size > 0 && !dryRun) {
		console.log('🔐 Setting FT allowances...');

		for (const [tokenId, totalAmount] of ftTokensNeeded.entries()) {
			if (tokenId === 'HBAR') {
				console.log('   ✅ HBAR prizes - no allowance needed\n');
				continue;
			}

			const isLazy = tokenId === lazyTokenId;
			const spenderId = isLazy ? lazyGasStationId : storageId;
			const spenderIdObj = isLazy ? ContractId.fromString(lazyGasStationId) : ContractId.fromString(storageId);

			console.log(`   Token: ${tokenId}`);
			console.log(`   Spender: ${spenderId} (${isLazy ? 'LazyGasStation' : 'Storage'})`);
			console.log(`   Total Amount: ${totalAmount}`);

			// Check existing allowance
			const allowanceInPlace = await checkFTAllowances(env, operatorId);
			let sufficientAllowance = false;

			for (const allowance of allowanceInPlace) {
				if (allowance.tokenId === tokenId && allowance.spenderId === spenderId) {
					if (Number(allowance.amount) >= Number(totalAmount)) {
						sufficientAllowance = true;
						break;
					}
				}
			}

			if (sufficientAllowance) {
				console.log('   ✅ Sufficient allowance already in place\n');
				continue;
			}

			try {
				const allowanceStatus = await setFTAllowance(
					client,
					TokenId.fromString(tokenId),
					operatorId,
					spenderIdObj,
					Number(totalAmount),
					`LazyLotto Batch Prize Pool #${config.poolId}`,
				);

				if (allowanceStatus !== 'SUCCESS') {
					console.error('   ❌ Failed to set allowance:', allowanceStatus);
					process.exit(1);
				}
				console.log('   ✅ Allowance set successfully\n');
			}
			catch (error) {
				console.error('   ❌ Error setting allowance:', error.message);
				process.exit(1);
			}
		}

		// Wait for allowances to propagate
		await sleep(5000);
	}

	// Handle NFT allowances
	const uniqueNftTokens = [...allNftTokens];
	if (uniqueNftTokens.length > 0 && !dryRun) {
		console.log('\n🔐 Setting NFT allowances...');
		console.log(`   Collections: ${uniqueNftTokens.length}`);
		console.log(`   Spender: ${storageId} (Storage)\n`);

		try {
			const allowanceInPlace = await getNFTApprovedForAllAllowances(env, operatorId);
			const storageIdString = ContractId.fromString(storageId).toString();
			const spenderAllowances = allowanceInPlace[storageIdString] || [];

			const nftTokenIdList = uniqueNftTokens
				.filter(tokenId => !spenderAllowances.includes(tokenId))
				.map(tokenId => TokenId.fromString(tokenId));

			if (nftTokenIdList.length === 0) {
				console.log('✅ All NFT allowances already in place. Skipping.\n');
			}
			else {
				const allowanceStatus = await setNFTAllowanceAll(
					client,
					nftTokenIdList,
					operatorId,
					ContractId.fromString(storageId),
					`LazyLotto Batch Prize Pool #${config.poolId}`,
				);

				if (allowanceStatus !== 'SUCCESS') {
					console.error('❌ Failed to set NFT allowances:', allowanceStatus);
					process.exit(1);
				}
				console.log('✅ NFT allowances set successfully\n');
			}
		}
		catch (error) {
			console.error('❌ Error setting NFT allowances:', error.message);
			process.exit(1);
		}
	}

	// Confirmation prompt before submission (only in live mode)
	if (!dryRun) {
		const confirm = await prompt('\n⚠️  Proceed with submitting packages to the contract? (yes/no): ');
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled by user');
			process.exit(0);
		}
	}

	// Build contract parameters - send packages one at a time
	console.log('\n📤 Submitting packages...');
	let successCount = 0;

	for (let i = 0; i < processedPackages.length; i++) {
		const pkg = processedPackages[i];
		console.log(`\n📦 Package ${i + 1}/${processedPackages.length}`);

		if (dryRun) {
			console.log('   🧪 Dry run - skipping submission');
			successCount++;
			continue;
		}

		// Check NFT token associations with storage contract
		let tokenAssociationGas = 0;
		if (pkg.nftTokens.length > 0) {
			console.log('   🔍 Checking NFT token associations...');
			for (let j = 0; j < pkg.nftTokens.length; j++) {
				// Convert EVM address back to Hedera ID for balance check
				const tokenEvmAddr = pkg.nftTokens[j];
				const tokenHedera = await convertToHederaId(tokenEvmAddr, EntityType.TOKEN);
				const balance = await checkMirrorBalance(env, storageId, tokenHedera);
				if (balance === null) {
					// Token not associated - need extra gas for association
					tokenAssociationGas += 1_000_000;
					console.log(`   ⚠️  ${tokenHedera} not associated (+1M gas)`);
				}
				else {
					console.log(`   ✅ ${tokenHedera} already associated`);
				}
			}
			if (tokenAssociationGas > 0) {
				console.log(`   📊 Total association gas: +${tokenAssociationGas.toLocaleString()}`);
			}
		}

		// Estimate gas for this package
		try {
			// Calculate gas with association buffer
			const baseGas = 800000;
			const finalGasLimit = baseGas + tokenAssociationGas;

			console.log(`   ⛽ Gas Estimate: ${finalGasLimit.toLocaleString()}`);
			if (tokenAssociationGas > 0) {
				console.log(`   💡 (Includes +${tokenAssociationGas.toLocaleString()} for ${(tokenAssociationGas / 1_000_000)} token association(s))`);
			}

			// Calculate payable amount (HBAR if ftToken is 0x0000...)
			const payableAmount = pkg.ftToken === '0x0000000000000000000000000000000000000000' ? pkg.ftAmount : '0';

			// Execute using the working pattern from addPrizePackage.js
			const gasLimit = Math.floor(finalGasLimit * 1.2);

			const [receipt, , record] = await contractExecuteFunction(
				contractId,
				iface,
				client,
				gasLimit,
				'addPrizePackage',
				[config.poolId, pkg.ftToken, pkg.ftAmount, pkg.nftTokens, pkg.nftSerials],
				new Hbar(payableAmount, HbarUnit.Tinybar),
			);

			if (receipt.status.toString() !== 'SUCCESS') {
				throw new Error(`Failed: ${receipt.status.toString()}`);
			}

			console.log(`   ✅ Success - TX: ${record.transactionId.toString()}`);
			successCount++;
		}
		catch (error) {
			console.error(`   ❌ Failed: ${error.message}`);
			console.log('   Continuing with remaining packages...');
		}
	}

	if (dryRun) {
		if (hasValidationErrors) {
			console.log('\n❌ Validation Failed - Issues found:');
			for (const error of validationErrors) {
				console.log(`   • ${error}`);
			}
			console.log('\n🧪 Dry run mode - no transactions submitted');
			process.exit(1);
		}
		else {
			console.log('\n✅ Validation Complete - All packages are valid');
			console.log('🧪 Dry run mode - no transactions submitted');
		}
	}
	else {
		console.log(`\n🎁 Added ${successCount}/${processedPackages.length} packages to Pool #${config.poolId}`);
		if (successCount < processedPackages.length) {
			console.log('⚠️  Some packages failed - see errors above');
		}
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('❌ Fatal error:', error);
		process.exit(1);
	});
