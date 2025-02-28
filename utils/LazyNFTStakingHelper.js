// eslint-disable-next-line no-unused-vars
const { PrivateKey } = require('@hashgraph/sdk');
const ethers = require('ethers');

class Stake {
	/**
	 * @param {string} collection the token address in EVM format
	 * @param {int[]} serials the serials of the tokens
	 * @param {int[]} rewards the reward rates of the tokens
	 * @constructor
	 * @public
	 */
	constructor(collection, serials, rewards) {
		this.collection = '0x' + collection;
		this.serials = serials;
		this.rewards = rewards;
	}
}

class RewardProof {
	/**
	 * @param {int} boostRate the boost rate to apply on top of the tokens
	 * @param {int} validityTimestamp the timestamp after which the proof is no longer valid
	 * @param {bytes} signature the signature of the proof
	 * @constructor
	 * @public
	 */
	constructor(boostRate, validityTimestamp, signature) {
		this.boostRate = boostRate;
		this.validityTimestamp = validityTimestamp;
		this.signature = signature;
	}
}

/**
 * Generates a staking reward proof
 * @param {string} _sender the address of the sender
 * @param {int} _boostRate the boost rate to apply on top of the tokens
 * @param {PrivateKey} signingWalletPK the private key of the signing wallet
 * @param {Stake[]} stakes the stakes to be included in the proof
 * @returns {Promise<RewardProof>} the reward proof
 * @public
 * @async
 */
async function generateStakingRewardProof(_sender, _boostRate, signingWalletPK, stakes) {
	const currentTimestamp = Math.floor(Date.now() / 1000);
	const senderAsEVM = '0x' + _sender.toSolidityAddress();
	const signer = new ethers.Wallet(`0x${signingWalletPK.toStringRaw()}`);

	// first encode the stakes as bytes32 to handle the struct array
	const bytes32EncodedStakes = [];
	for (let i = 0; i < stakes.length; i++) {
		const stake = stakes[i];
		const encodedStake = ethers.solidityPackedKeccak256(
			['address', 'uint256[]', 'uint256[]'],
			[stake.collection, stake.serials, stake.rewards],
		);
		bytes32EncodedStakes.push(encodedStake);
	}

	// then hash the whole thing
	const hash = ethers.solidityPackedKeccak256(
		['address', 'uint256', 'bytes32[]', 'uint256'],
		[senderAsEVM, _boostRate, bytes32EncodedStakes, currentTimestamp],
	);

	const signature = await signer.signMessage(ethers.getBytes(hash));

	return new RewardProof(_boostRate, currentTimestamp, signature);
}

module.exports = {
	Stake,
	RewardProof,
	generateStakingRewardProof,
};