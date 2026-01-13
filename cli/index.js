#!/usr/bin/env node

/**
 * LazyLotto CLI
 *
 * Command-line interface for interacting with LazyLotto contracts on Hedera.
 *
 * Usage:
 *   lazy-lotto <command> [options]
 *
 * Commands:
 *   buy <poolId> <count>    Buy lottery entries
 *   roll <poolId>           Roll pending entries
 *   claim <poolId>          Claim won prizes
 *   pools                   List all pools
 *   pool <poolId>           Get pool details
 *   user [address]          Get user state
 *   health                  System health check
 *   info                    Contract configuration
 *
 * Options:
 *   --json                  Output as JSON
 *   --help, -h              Show help
 *   --version, -v           Show version
 *
 * Environment Variables (in .env or exported):
 *   ACCOUNT_ID              Your Hedera account ID (0.0.xxxxx)
 *   PRIVATE_KEY             Your ED25519 private key
 *   ENVIRONMENT             Network: TEST, MAIN, or PREVIEW
 *   LAZY_LOTTO_CONTRACT_ID  LazyLotto contract address
 */

const path = require('path');
const fs = require('fs');

// Load .env from current working directory
require('dotenv').config();

const VERSION = require('../package.json').version;

const COMMANDS = {
	buy: {
		description: 'Buy lottery entries',
		usage: 'lazy-lotto buy <poolId> <count>',
		handler: './commands/buy.js',
	},
	roll: {
		description: 'Roll pending entries',
		usage: 'lazy-lotto roll <poolId>',
		handler: './commands/roll.js',
	},
	claim: {
		description: 'Claim won prizes',
		usage: 'lazy-lotto claim <poolId>',
		handler: './commands/claim.js',
	},
	pools: {
		description: 'List all pools',
		usage: 'lazy-lotto pools',
		handler: './commands/pools.js',
	},
	pool: {
		description: 'Get pool details',
		usage: 'lazy-lotto pool <poolId>',
		handler: './commands/pool.js',
	},
	user: {
		description: 'Get user state',
		usage: 'lazy-lotto user [address]',
		handler: './commands/user.js',
	},
	health: {
		description: 'System health check',
		usage: 'lazy-lotto health',
		handler: './commands/health.js',
	},
	info: {
		description: 'Contract configuration',
		usage: 'lazy-lotto info',
		handler: './commands/info.js',
	},
};

function showHelp() {
	console.log(`
LazyLotto CLI v${VERSION}

Usage: lazy-lotto <command> [options]

Commands:
  buy <poolId> <count>    Buy lottery entries
  roll <poolId>           Roll pending entries
  claim <poolId>          Claim won prizes
  pools                   List all pools
  pool <poolId>           Get pool details
  user [address]          Get user state
  health                  System health check
  info                    Contract configuration

Options:
  --json                  Output as JSON (for scripting)
  --help, -h              Show this help message
  --version, -v           Show version

Environment Variables:
  ACCOUNT_ID              Your Hedera account ID (0.0.xxxxx)
  PRIVATE_KEY             Your ED25519 private key
  ENVIRONMENT             Network: TEST, MAIN, or PREVIEW
  LAZY_LOTTO_CONTRACT_ID  LazyLotto contract address

Examples:
  lazy-lotto pools                    # List available pools
  lazy-lotto buy 0 5                  # Buy 5 entries in pool 0
  lazy-lotto roll 0                   # Roll entries in pool 0
  lazy-lotto claim 0                  # Claim prizes from pool 0
  lazy-lotto user                     # Check your state
  lazy-lotto health --json            # Health check as JSON

Documentation:
  https://github.com/Burstall/hedera-SC-lazy-lotto
`);
}

function showVersion() {
	console.log(`lazy-lotto v${VERSION}`);
}

async function main() {
	const args = process.argv.slice(2);

	// Handle global flags
	if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
		showHelp();
		process.exit(0);
	}

	if (args.includes('--version') || args.includes('-v')) {
		showVersion();
		process.exit(0);
	}

	// Get command
	const command = args[0].toLowerCase();

	if (!COMMANDS[command]) {
		console.error(`Unknown command: ${command}`);
		console.error(`Run 'lazy-lotto --help' for usage information.`);
		process.exit(1);
	}

	// Check required environment variables
	const requiredEnvVars = ['ACCOUNT_ID', 'PRIVATE_KEY', 'ENVIRONMENT'];
	const missingVars = requiredEnvVars.filter(v => !process.env[v]);

	if (missingVars.length > 0) {
		console.error('Missing required environment variables:');
		missingVars.forEach(v => console.error(`  - ${v}`));
		console.error('\nCreate a .env file or export these variables.');
		process.exit(1);
	}

	// For commands that need contract IDs
	const contractCommands = ['buy', 'roll', 'claim', 'pools', 'pool', 'user', 'info'];
	if (contractCommands.includes(command) && !process.env.LAZY_LOTTO_CONTRACT_ID) {
		console.error('Missing LAZY_LOTTO_CONTRACT_ID environment variable.');
		console.error('Set this to your LazyLotto contract address (0.0.xxxxx)');
		process.exit(1);
	}

	// Load and run the command handler
	try {
		const handlerPath = path.join(__dirname, COMMANDS[command].handler);
		const handler = require(handlerPath);
		await handler(args.slice(1));
	}
	catch (error) {
		if (error.code === 'MODULE_NOT_FOUND') {
			console.error(`Command '${command}' is not yet implemented.`);
		}
		else {
			console.error(`Error: ${error.message}`);
			if (process.env.DEBUG) {
				console.error(error.stack);
			}
		}
		process.exit(1);
	}
}

main();
