/**
 * @lazysuperheroes/lazy-lotto
 *
 * ABIs and utilities for interacting with the LazyLotto and LazyTradeLotto
 * smart contracts on Hedera.
 *
 * Usage:
 *   const { LazyLottoABI, LazyTradeLottoABI } = require('@lazysuperheroes/lazy-lotto');
 *
 *   // With ethers.js
 *   const contract = new ethers.Contract(address, LazyLottoABI, provider);
 */

const fs = require('fs');
const path = require('path');

// Load ABIs from the abi/ directory
function loadABI(filename) {
	const abiPath = path.join(__dirname, 'abi', filename);
	return JSON.parse(fs.readFileSync(abiPath, 'utf8'));
}

// Core LazyLotto ABIs
const LazyLottoABI = loadABI('LazyLotto.json');
const LazyLottoStorageABI = loadABI('LazyLottoStorage.json');
const LazyLottoPoolManagerABI = loadABI('LazyLottoPoolManager.json');

// LazyTradeLotto ABI
const LazyTradeLottoABI = loadABI('LazyTradeLotto.json');

// Supporting contract ABIs
const LazyGasStationABI = loadABI('LazyGasStation.json');
const LazyDelegateRegistryABI = loadABI('LazyDelegateRegistry.json');

// Hedera system ABIs (for reference)
const HederaTokenServiceABI = loadABI('HederaTokenService.json');
const PrngSystemContractABI = loadABI('PrngSystemContract.json');

// Contract addresses helper
const ContractAddresses = {
	// Mainnet addresses (to be filled after mainnet deployment)
	mainnet: {
		lazyLotto: null,
		lazyLottoStorage: null,
		lazyLottoPoolManager: null,
		lazyTradeLotto: null,
		lazyGasStation: null,
		lazyDelegateRegistry: null,
		lazyToken: null,
	},
	// Testnet addresses (to be filled after testnet deployment)
	testnet: {
		lazyLotto: null,
		lazyLottoStorage: null,
		lazyLottoPoolManager: null,
		lazyTradeLotto: null,
		lazyGasStation: null,
		lazyDelegateRegistry: null,
		lazyToken: null,
	},
};

/**
 * Get contract addresses for a specific network
 * @param {string} network - 'mainnet' or 'testnet'
 * @returns {Object} Contract addresses for the network
 */
function getAddresses(network) {
	const normalizedNetwork = network.toLowerCase().replace('net', '');
	if (normalizedNetwork === 'main') return ContractAddresses.mainnet;
	if (normalizedNetwork === 'test') return ContractAddresses.testnet;
	throw new Error(`Unknown network: ${network}. Use 'mainnet' or 'testnet'`);
}

// Export everything
module.exports = {
	// LazyLotto system
	LazyLottoABI,
	LazyLottoStorageABI,
	LazyLottoPoolManagerABI,

	// LazyTradeLotto
	LazyTradeLottoABI,

	// Supporting contracts
	LazyGasStationABI,
	LazyDelegateRegistryABI,

	// Hedera system
	HederaTokenServiceABI,
	PrngSystemContractABI,

	// Addresses helper
	ContractAddresses,
	getAddresses,

	// Re-export individual ABIs for destructuring convenience
	abi: {
		LazyLotto: LazyLottoABI,
		LazyLottoStorage: LazyLottoStorageABI,
		LazyLottoPoolManager: LazyLottoPoolManagerABI,
		LazyTradeLotto: LazyTradeLottoABI,
		LazyGasStation: LazyGasStationABI,
		LazyDelegateRegistry: LazyDelegateRegistryABI,
		HederaTokenService: HederaTokenServiceABI,
		PrngSystemContract: PrngSystemContractABI,
	},
};
