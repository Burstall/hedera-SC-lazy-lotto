const { PrivateKey, TokenId, AccountId, Client, ContractId } = require('@hashgraph/sdk');
const ethers = require('ethers');
const { Stake, generateStakingRewardProof } = require('../../utils/LazyNFTStakingHelper');
const { contractExecuteQuery } = require('../../utils/solidityHelpers');
const fs = require('fs');
require('dotenv').config();

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const signingWallet = PrivateKey.generateECDSA();
console.log('Type:', signingWallet.type);
console.log('Public key:', signingWallet.publicKey.toEvmAddress());
console.log('Private key: (Hedera Format)', signingWallet.toString());
console.log('Private key (EVM format):', '0x' + signingWallet.toStringRaw());
const contractName = 'LazyNFTStaking';

const StkNFTA_TokenId = TokenId.fromString('0.0.1234');
const StkNFTB_TokenId = TokenId.fromString('0.0.1235');
const StkNFTC_TokenId = TokenId.fromString('0.0.1236');

const wallet = new ethers.Wallet(`0x${signingWallet.toStringRaw()}`);
console.log('Ethers Address:', wallet.address);
console.log('Ethers Private key:', wallet.privateKey);

async function main() {
	const boostRate = 3;

	// create an array of Stake objects
	const stakes = [];

	stakes.push(new Stake(StkNFTA_TokenId.toSolidityAddress(), [1, 2], [1, 1]));
	stakes.push(new Stake(StkNFTB_TokenId.toSolidityAddress(), [3, 4], [2, 2]));
	stakes.push(new Stake(StkNFTC_TokenId.toSolidityAddress(), [5], [100]));

	// to create the signature we need to pack the variables and hash them in the same order and manner as the contract
	let rewardProof = await generateStakingRewardProof(operatorId, boostRate, signingWallet, stakes);

	console.log('Reward proof:', rewardProof);

	rewardProof.boostRate = 0;

	console.log('doped Reward proof:', rewardProof);

	rewardProof = await generateStakingRewardProof(operatorId, 0, signingWallet, stakes);

	console.log('Refreshed Reward proof:', rewardProof);

	const lnsContractId = ContractId.fromString('0.0.343284');

	// now deploy main contract
	const lazyNFTStakerJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	// import ABI
	const lazyNFTStakingIface = ethers.Interface.from(lazyNFTStakerJson.abi);

	const client = Client.forPreviewnet();
	client.setOperator(operatorId, operatorKey);

	const result = await contractExecuteQuery(
		lnsContractId,
		lazyNFTStakingIface,
		client,
		null,
		'testSignature',
		[stakes, rewardProof],
	);

	console.log('Result:', result);
}

main().catch((error) => console.error(error));