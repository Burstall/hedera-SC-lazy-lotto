# Hedera Smart Contract Lazy Lotto

A comprehensive decentralized lottery and rewards system built on the Hedera network, featuring two distinct lottery mechanisms: a flexible multi-pool lottery system (LazyLotto) and a trade-based reward system (LazyTradeLotto).

## 🎯 Project Overview

This project implements sophisticated lottery and reward systems that leverage Hedera's native capabilities including HTS (Hedera Token Service), PRNG (Pseudo-Random Number Generation), and smart contract functionality. The system is designed to provide fair, verifiable, and engaging lottery experiences while maintaining security and scalability.

## 🏗️ Architecture

### Core Contracts

#### 1. **LazyLotto** - Multi-Pool Lottery System
A comprehensive lottery platform supporting multiple independent lottery pools with various prize types, ticket systems, and bonus mechanisms.

**Key Features:**
- Multiple independent lottery pools with customizable parameters
- Support for HBAR, HTS tokens, and NFT prizes
- Dual ticket system: memory-based (gas efficient) and NFT-based (tradeable)
- Sophisticated boost system for enhanced win rates
- Prize management system with convertible prize NFTs
- Admin-controlled pool lifecycle management

#### 2. **LazyTradeLotto** - Trade-Based Reward System
A reward mechanism that incentivizes NFT trading activity with lottery-style prizes and a progressive jackpot system.

**Key Features:**
- Trade-triggered lottery rolls for both buyers and sellers
- Progressive jackpot system with automatic growth
- LSH NFT holder benefits (zero burn rate)
- Cryptographic security with signature validation
- Anti-replay protection with trade fingerprinting
- Comprehensive analytics and event tracking

#### 3. **HTSLazyLottoLibrary** - HTS Operations Library
A specialized library handling complex Hedera Token Service operations required by the lottery systems.

**Key Features:**
- NFT collection creation and management
- Batch NFT minting, transfers, and burning
- Token association and validation
- Royalty fee configuration
- Optimized batch operations with gas management

### Supporting Infrastructure

#### External Dependencies
- **LazyGasStation**: Manages automatic HBAR/$LAZY refills and token operations
- **LazyDelegateRegistry**: Handles NFT delegation for bonus calculations
- **PrngSystemContract**: Provides verifiable random number generation
- **LSH NFT Collections**: Gen1, Gen2, and Gen1 Mutant collections for holder benefits

## 🎮 Use Cases

### LazyLotto Use Cases

1. **Traditional Lottery Player**
   - Purchase tickets with various tokens
   - Roll for prizes immediately or accumulate tickets
   - Claim prizes directly or convert to tradeable NFTs

2. **NFT Ticket Trader**
   - Buy tickets as NFTs for secondary market trading
   - Purchase tickets from other users
   - Roll accumulated NFT tickets when ready

3. **Prize Collector**
   - Win various prize types (HBAR, tokens, NFTs)
   - Convert prizes to NFTs for trading
   - Build a portfolio of won prizes

4. **Strategic Player**
   - Monitor time-based bonuses for optimal entry timing
   - Maintain NFT holdings for bonus rates
   - Accumulate $LAZY for balance bonuses

### LazyTradeLotto Use Cases

1. **Active NFT Trader**
   - Complete trades on Lazy Secure Trade platform
   - Claim lottery rewards for both buying and selling
   - Benefit from progressive jackpot growth

2. **LSH NFT Holder**
   - Receive zero burn rate on all lottery winnings
   - Delegate NFTs to provide benefits to others
   - Enjoy enhanced value from trading activity

3. **Casual Trader**
   - Participate in occasional trades
   - Contribute to jackpot growth while eligible for wins
   - Potential for significant jackpot wins

## 🔒 Security Features

### Access Control
- **Multi-admin system** for LazyLotto with last-admin protection
- **Owner-only functions** for LazyTradeLotto configuration
- **Role-based permissions** for all administrative operations

### Financial Security
- **ReentrancyGuard** on all state-changing functions
- **Pausable functionality** for emergency stops
- **Input validation** for all user-provided parameters
- **Balance tracking** for accurate prize accounting

### Cryptographic Security
- **Signature validation** for LazyTradeLotto parameters
- **Anti-replay protection** with transaction history
- **Secure random number generation** via Hedera PRNG
- **Trade fingerprinting** to prevent duplicate claims

## 🛠️ Technical Implementation

### Smart Contract Details

#### Gas Optimization
- **Batch operations** for efficient NFT handling
- **Automatic refilling** via LazyGasStation integration
- **Optimized storage patterns** to minimize gas costs
- **Library separation** to manage contract size limits

#### Token Standards
- **HTS integration** for native Hedera token operations
- **ERC20/ERC721 compatibility** for standard interfaces
- **Custom NFT collections** for tickets and prizes
- **Royalty support** for NFT collections

#### Random Number Generation
- **Hedera PRNG integration** for verifiable randomness
- **Multiple random requests** for different game mechanics
- **Nonce-based randomization** for unique outcomes
- **Deterministic testing support** via mock contracts

### Development Stack
- **Solidity 0.8.12+** for smart contract development
- **Hardhat** for development, testing, and deployment
- **OpenZeppelin** for security patterns and standards
- **Hedera SDK** for Hedera-specific operations

## 📊 System Statistics & Monitoring

### LazyLotto Analytics
- Pool-specific statistics (total entries, prizes awarded)
- User-specific data (entries, pending prizes, win history)
- Prize distribution tracking across all pools
- Boost system effectiveness metrics

### LazyTradeLotto Analytics
- Trade volume and lottery participation rates
- Regular win vs. jackpot win statistics
- LSH NFT holder benefit utilization
- Progressive jackpot growth patterns

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ and npm/yarn
- Hedera testnet or mainnet account
- Required environment variables (see `.env.example`)

### Installation
```bash
git clone https://github.com/Burstall/hedera-SC-lazy-lotto.git
cd hedera-SC-lazy-lotto
npm install
```

### Testing
```bash
# Run all tests
npm test

# Run specific test suites
npm run test-lotto
npm run test-trade-lotto
```

### Deployment
```bash
# Deploy to testnet
npx hardhat run scripts/deploy.js --network testnet

# Deploy to mainnet
npx hardhat run scripts/deploy.js --network mainnet
```

## 📚 Documentation

### Business Logic Documentation
- **[LazyLotto Business Logic](./LazyLotto-BUSINESS_LOGIC.md)** - Comprehensive overview of LazyLotto functionality and use cases
- **[LazyTradeLotto Business Logic](./LazyTradeLotto-BUSINESS_LOGIC.md)** - Detailed explanation of the trade-based reward system

### Development Documentation
- **[LazyLotto Testing Plan](./LazyLotto-TESTING_PLAN.md)** - Systematic testing strategy and implementation guide
- **[LazyLotto TODO](./LazyLotto-TODO.md)** - Project roadmap and completion checklist

### API Documentation
- Contract interfaces and function documentation available in source files
- NatSpec comments for all public functions
- Event definitions and parameter explanations

## 🔧 Configuration

### LazyLotto Configuration
- **Pool Creation**: Win rates, entry fees, prize types
- **Bonus System**: Time bonuses, NFT bonuses, balance bonuses
- **Admin Management**: Multi-admin setup and permissions

### LazyTradeLotto Configuration
- **Jackpot Settings**: Initial amount, growth rate, maximum size
- **Burn Percentage**: Rate for non-NFT holders
- **System Wallet**: Signature validation address

## 🌐 Network Compatibility

### Hedera Network Support
- **Testnet**: Full functionality for development and testing
- **Mainnet**: Production deployment ready
- **Local Node**: Development environment support

### Token Standards
- **HTS Tokens**: Native Hedera token support
- **HBAR**: Native currency integration
- **NFT Collections**: Custom and existing collections

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow existing code style and patterns
- Add comprehensive tests for new features
- Update documentation for any changes
- Ensure all tests pass before submitting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Hedera Network** for providing robust infrastructure and tools
- **OpenZeppelin** for security patterns and implementations
- **Lazy Superheroes Community** for use case validation and feedback

## 📞 Support

For questions, issues, or contributions:
- Open an issue on GitHub
- Contact the development team
- Join the community discussions

---

**Built with ❤️ for the Hedera ecosystem**