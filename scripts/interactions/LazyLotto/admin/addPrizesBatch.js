const fs = require('fs').promises;
const {
	ContractId,
	ContractExecuteTransaction,
	ContractFunctionParameters,
	TokenId,
} = require('@hashgraph/sdk');
const { setNFTAllowanceAll } = require('../../../../utils/hederaHelpers');
const {
	getHederaClient,
	convertToHederaId,
	EntityType,
	getNFTApprovedForAllAllowances,
} = require('../../../../utils/nodeHelpers');
const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');
const { gasEstimation } = require('../../../../utils/gasHelpers');
const { getArgFlag } = require('../../../../utils/solidityHelpers');

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
 * Usage:
 *   node addPrizesBatch.js -f prizes.json
 *   node addPrizesBatch.js -f prizes.json -dry  (dry run - validate only)
 */

const main = async () => {
	// Load required environment variables
	const operatorId = process.env.OPERATOR_ACCOUNT_ID;
	const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
	const contractId = process.env.LAZY_LOTTO_CONTRACT_ID;
	const storageId = process.env.LAZY_LOTTO_STORAGE_CONTRACT_ID;
	const env = process.env.ENVIRONMENT ?? null;

	// Validate environment
	if (!operatorId || !operatorKey) {
		console.error('❌ Missing OPERATOR_ACCOUNT_ID or OPERATOR_PRIVATE_KEY in .env');
		process.exit(1);
	}

	if (!contractId || !storageId) {
		console.error('❌ Missing LAZY_LOTTO_CONTRACT_ID or LAZY_LOTTO_STORAGE_CONTRACT_ID in .env');
		process.exit(1);
	}

	// Parse command line arguments
	const filePath = getArgFlag('-f') || getArgFlag('--file');
	const dryRun = getArgFlag('-dry') === 'true' || getArgFlag('--dry-run') === 'true';

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

	// Initialize client
	const client = await getHederaClient(env, operatorId, operatorKey);

	// Process and validate packages
	const processedPackages = [];
	const allNftTokens = new Set();

	let packageIndex = 1;
	for (const pkg of config.packages) {
		console.log(`\n📦 Package ${packageIndex}/${config.packages.length}:`);

		try {
			const processedPkg = {
				hbar: null,
				ft: null,
				nfts: [],
			};

			// Process HBAR (optional)
			if (pkg.hbar) {
				const amount = BigInt(Math.floor(parseFloat(pkg.hbar) * 100_000_000));
				processedPkg.hbar = amount;
				console.log(`   HBAR: ${pkg.hbar} ℏ (${amount} tinybars)`);
			}

			// Process FT (optional)
			if (pkg.ft) {
				if (!pkg.ft.token || !pkg.ft.amount) {
					throw new Error('FT missing token or amount');
				}
				const tokenId = await convertToHederaId(pkg.ft.token, EntityType.TOKEN);
				const amount = BigInt(pkg.ft.amount);
				processedPkg.ft = { token: tokenId, amount };
				console.log(`   FT: ${tokenId} (${amount})`);
			}

			// Process NFTs (optional, can be array)
			if (pkg.nfts && Array.isArray(pkg.nfts)) {
				for (const nft of pkg.nfts) {
					if (!nft.token || !Array.isArray(nft.serials) || nft.serials.length === 0) {
						throw new Error('NFT missing token or serials array');
					}
					const tokenId = await convertToHederaId(nft.token, EntityType.TOKEN);
					const serials = nft.serials.map(s => BigInt(s));
					processedPkg.nfts.push({ token: tokenId, serials });
					allNftTokens.add(tokenId);
					console.log(`   NFT: ${tokenId} [${serials.join(', ')}]`);
				}
			}

			// Validate package has at least one component
			if (!processedPkg.hbar && !processedPkg.ft && processedPkg.nfts.length === 0) {
				throw new Error('Package must have at least one: hbar, ft, or nfts');
			}

			// Determine package type
			const hasHbar = processedPkg.hbar !== null;
			const hasFt = processedPkg.ft !== null;
			const hasNft = processedPkg.nfts.length > 0;

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
	console.log('\n📊 Summary:');
	const typeACounts = processedPackages.filter(p => p.hbar && !p.ft && p.nfts.length === 0).length;
	const typeBCounts = processedPackages.filter(p => !p.hbar && p.ft && p.nfts.length === 0).length;
	const typeCCounts = processedPackages.filter(p => !p.hbar && !p.ft && p.nfts.length > 0).length;
	const typeDCounts = processedPackages.filter(p => p.hbar && !p.ft && p.nfts.length > 0).length;
	const typeECounts = processedPackages.filter(p => !p.hbar && p.ft && p.nfts.length > 0).length;

	console.log(`   Type A (HBAR only): ${typeACounts}`);
	console.log(`   Type B (FT only): ${typeBCounts}`);
	console.log(`   Type C (NFT only): ${typeCCounts}`);
	console.log(`   Type D (HBAR+NFT): ${typeDCounts}`);
	console.log(`   Type E (FT+NFT): ${typeECounts}`);
	console.log(`   Total Packages: ${processedPackages.length}`);

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

	// Build contract parameters - send packages one at a time
	// Note: This will create multiple transactions. For single transaction,
	// the contract would need a batch add function.
	console.log('\n📤 Submitting packages...');
	let successCount = 0;

	for (let i = 0; i < processedPackages.length; i++) {
		const pkg = processedPackages[i];
		console.log(`\n📦 Package ${i + 1}/${processedPackages.length}`);

		const params = new ContractFunctionParameters();
		params.addUint256(config.poolId);

		// Add HBAR (0 or 1)
		if (pkg.hbar) {
			params.addUint256(1);
			params.addUint256(pkg.hbar);
		}
		else {
			params.addUint256(0);
		}

		// Add FT (0 or 1)
		if (pkg.ft) {
			params.addUint256(1);
			params.addAddress(pkg.ft.token);
			params.addUint256(pkg.ft.amount);
		}
		else {
			params.addUint256(0);
		}

		// Add NFTs (0 or more)
		params.addUint256(pkg.nfts.length);
		for (const nft of pkg.nfts) {
			params.addAddress(nft.token);
			params.addUint256(nft.serials.length);
			for (const serial of nft.serials) {
				params.addInt64(serial);
			}
		}

		if (dryRun) {
			console.log('   🧪 Dry run - skipping submission');
			continue;
		}

		// Check NFT token associations with storage contract
		let tokenAssociationGas = 0;
		if (pkg.nfts.length > 0) {
			console.log('   🔍 Checking NFT token associations...');
			for (const nft of pkg.nfts) {
				const balance = await checkMirrorBalance(env, storageId, nft.token);
				if (balance === null) {
					// Token not associated - need extra gas for association
					tokenAssociationGas += 1_000_000;
					console.log(`   ⚠️  ${nft.token} not associated (+1M gas)`);
				}
				else {
					console.log(`   ✅ ${nft.token} already associated`);
				}
			}
			if (tokenAssociationGas > 0) {
				console.log(`   📊 Total association gas: +${tokenAssociationGas.toLocaleString()}`);
			}
		}

		// Estimate gas for this package
		try {
			const [, gasLimit] = await gasEstimation(
				env,
				contractId,
				'addPrizePackage',
				params,
				operatorId,
			);

			// Add token association gas if needed
			const finalGasLimit = gasLimit + tokenAssociationGas;
			console.log(`   ⛽ Base Gas: ${gasLimit.toLocaleString()}`);
			if (tokenAssociationGas > 0) {
				console.log(`   ⛽ Final Gas: ${finalGasLimit.toLocaleString()} (includes association gas)`);
			}

			// Submit transaction
			const contractExecTx = await new ContractExecuteTransaction()
				.setContractId(contractId)
				.setGas(finalGasLimit)
				.setFunction('addPrizePackage', params)
				.freezeWith(client);

			const contractExecSign = await contractExecTx.sign(operatorKey);
			const contractExecSubmit = await contractExecSign.execute(client);
			const contractExecRx = await contractExecSubmit.getReceipt(client);

			if (contractExecRx.status.toString() !== 'SUCCESS') {
				throw new Error(`Failed: ${contractExecRx.status.toString()}`);
			}

			console.log(`   ✅ Success - TX: ${contractExecSubmit.transactionId.toString()}`);
			successCount++;
		}
		catch (error) {
			console.error(`   ❌ Failed: ${error.message}`);
			console.log('   Continuing with remaining packages...');
		}
	}

	if (dryRun) {
		console.log('\n✅ Validation Complete - All packages are valid');
		console.log('🧪 Dry run mode - no transactions submitted');
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
