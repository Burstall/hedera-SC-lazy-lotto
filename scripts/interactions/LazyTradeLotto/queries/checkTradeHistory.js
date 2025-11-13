/**
 * LazyTradeLotto - Check Trade Roll History
 *
 * Checks if a specific trade has already been rolled by a user.
 * Each trade can be rolled once by the buyer and once by the seller.
 * This prevents replay attacks and duplicate rolls.
 *
 * Usage: node queries/checkTradeHistory.js <contractId> <token> <serial> <nonce> <buyer>
 * Example: node queries/checkTradeHistory.js 0.0.123456 0x1234...abcd 42 1000 true
 */

const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');

const contractName = 'LazyTradeLotto';
const env = process.env.ENVIRONMENT ?? null;

let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
	process.exit(1);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 5 || getArgFlag('h')) {
		console.log('Usage: checkTradeHistory.js <contractId> <token> <serial> <nonce> <buyer>');
		console.log('       contractId: LazyTradeLotto contract address (e.g., 0.0.123456)');
		console.log('       token: NFT contract address from trade (e.g., 0x1234...abcd or 0.0.789)');
		console.log('       serial: NFT serial/token ID (e.g., 42)');
		console.log('       nonce: Unique trade identifier (e.g., 1000)');
		console.log('       buyer: true if checking buyer, false if checking seller');
		console.log('\nChecks if this trade has already been rolled for the specified participant.');
		return;
	}

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());

	// Import ABI
	const ltlJSON = JSON.parse(fs.readFileSync(`./abi/${contractName}.json`));
	const ltlIface = new ethers.Interface(ltlJSON);

	const contractId = ContractId.fromString(args[0]);
	let tokenAddress = args[1];
	const serial = args[2];
	const nonce = args[3];
	const buyer = args[4].toLowerCase() === 'true';

	// Convert Token ID to EVM address if needed
	if (tokenAddress.startsWith('0.0.')) {
		const tokenId = TokenId.fromString(tokenAddress);
		tokenAddress = tokenId.toSolidityAddress();
	}

	console.log('-Using Contract:', contractId.toString());
	console.log('\nTrade Parameters:');
	console.log('  Token:', tokenAddress);
	console.log('  Serial:', serial);
	console.log('  Nonce:', nonce);
	console.log('  Participant:', buyer ? 'Buyer' : 'Seller');

	// Calculate the history hash (same as contract does)
	const hash = ethers.keccak256(
		ethers.solidityPacked(
			['address', 'uint256', 'uint256', 'bool'],
			[tokenAddress, serial, nonce, buyer],
		),
	);

	console.log('  History Hash:', hash);

	console.log('\nChecking roll history...\n');

	// Check if this hash exists in history mapping
	const hasRolled = ltlIface.decodeFunctionResult(
		'history',
		await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			ltlIface.encodeFunctionData('history', [hash]),
			operatorId,
			false,
		),
	)[0];

	// Display Results
	console.log('═══════════════════════════════════════════════════════════');
	console.log('           Trade Roll History Check');
	console.log('═══════════════════════════════════════════════════════════\n');

	console.log('🎯 Trade Details:');
	console.log('   NFT Contract:', tokenAddress);
	console.log('   Serial:', serial);
	console.log('   Nonce:', nonce);
	console.log('   Participant:', buyer ? '🛒 Buyer' : '🏷️ Seller');

	console.log('\n📊 Roll Status:', hasRolled ? '✅ ALREADY ROLLED' : '⏳ NOT YET ROLLED');

	if (hasRolled) {
		console.log('\n❌ This trade has already been rolled by this participant.');
		console.log('   Further attempts will revert with AlreadyRolled() error.');
		console.log('   Each trade can only be rolled once per participant.');
	}
	else {
		console.log('\n✅ This trade has not been rolled yet by this participant.');
		console.log('   This participant can roll the lottery for this trade.');
		console.log('   (Requires valid signature from systemWallet)');
	}

	console.log('\n💡 Note: Each trade has two potential rolls:');
	console.log('   • One for the buyer');
	console.log('   • One for the seller');
	console.log('   Use this tool separately to check each participant.');

	console.log('\n═══════════════════════════════════════════════════════════\n');
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
