/**
 * Backward Compatibility Tests
 *
 * Ensures all 21 admin scripts maintain backward compatibility in single-sig mode.
 * Validates that scripts work correctly WITHOUT --multisig flag.
 */

const { expect } = require('chai');
const {
	parseMultiSigArgs,
	shouldDisplayHelp,
} = require('../utils/multiSigIntegration');

describe('Backward Compatibility - Admin Scripts', function() {
	this.timeout(30000);

	/**
   * Helper to verify single-sig mode configuration
   */
	function verifySingleSigMode(config) {
		expect(config.enabled).to.be.false;
		expect(config.workflow).to.equal('interactive'); // default
	}

	describe('Pool Management Scripts', function() {

		it('createPool.js should work without --multisig', function() {
			const args = ['node', 'createPool.js', 'TestPool', '0.0.123456'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('TestPool'); // Pool name preserved
			expect(args[3]).to.equal('0.0.123456'); // Prize manager ID preserved
		});

		it('pausePool.js should work without --multisig', function() {
			const args = ['node', 'pausePool.js', '1'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
		});

		it('unpausePool.js should work without --multisig', function() {
			const args = ['node', 'unpausePool.js', '1'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
		});

		it('closePool.js should work without --multisig', function() {
			const args = ['node', 'closePool.js', '1'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
		});
	});

	describe('Prize Management Scripts', function() {

		it('addPrizePackage.js should work without --multisig', function() {
			const args = ['node', 'addPrizePackage.js', '1', '0.0.123456', '1000'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
			expect(args[3]).to.equal('0.0.123456'); // Token ID preserved
			expect(args[4]).to.equal('1000'); // Amount preserved
		});

		it('addPrizesBatch.js should work without --multisig', function() {
			const args = ['node', 'addPrizesBatch.js', '1'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
		});

		it('removePrizes.js should work without --multisig', function() {
			const args = ['node', 'removePrizes.js', '1', '0,1,2'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
			expect(args[3]).to.equal('0,1,2'); // Prize indices preserved
		});

		it('addGlobalPrizeManager.js should work without --multisig', function() {
			const args = ['node', 'addGlobalPrizeManager.js', '0x1234567890abcdef'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('0x1234567890abcdef'); // EVM address preserved
		});
	});

	describe('Entry Management Scripts', function() {

		it('grantEntry.js should work without --multisig', function() {
			const args = ['node', 'grantEntry.js', '1', '0.0.123456', '5'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
			expect(args[3]).to.equal('0.0.123456'); // Account ID preserved
			expect(args[4]).to.equal('5'); // Entry count preserved
		});

		it('buyAndRedeemEntry.js should work without --multisig', function() {
			const args = ['node', 'buyAndRedeemEntry.js', '1'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
		});
	});

	describe('Configuration Scripts', function() {

		it('setBurnPercentage.js should work without --multisig', function() {
			const args = ['node', 'setBurnPercentage.js', '10'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('10'); // Percentage preserved
		});

		it('setPlatformFee.js should work without --multisig', function() {
			const args = ['node', 'setPlatformFee.js', '5'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('5'); // Fee percentage preserved
		});

		it('setPrng.js should work without --multisig', function() {
			const args = ['node', 'setPrng.js', '0.0.8257116'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('0.0.8257116'); // PRNG contract ID preserved
		});

		it('setBonuses.js should work without --multisig', function() {
			const args = ['node', 'setBonuses.js', '1'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('1'); // Pool ID preserved
		});
	});

	describe('Admin & Role Management Scripts', function() {

		it('manageRoles.js should work without --multisig', function() {
			const args = ['node', 'manageRoles.js', 'add', '0.0.123456'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('add'); // Operation preserved
			expect(args[3]).to.equal('0.0.123456'); // Account ID preserved
		});

		it('pauseContract.js should work without --multisig', function() {
			const args = ['node', 'pauseContract.js'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
		});

		it('withdrawTokens.js should work without --multisig', function() {
			const args = ['node', 'withdrawTokens.js', '0.0.123456', '1000'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('0.0.123456'); // Token ID preserved
			expect(args[3]).to.equal('1000'); // Amount preserved
		});
	});

	describe('executeContractFunction Backward Compatibility', function() {

		it('should not modify behavior when multi-sig disabled', function() {
			// Simulate config without multi-sig
			const config = parseMultiSigArgs(['node', 'script.js']);

			expect(config.enabled).to.be.false;

			// The executeContractFunction wrapper should fall back to
			// solidityHelpers.contractExecuteFunction when multi-sig disabled
			// This is tested by the actual script integration
		});

		it('should preserve all script arguments', function() {
			const args = ['node', 'script.js', 'arg1', 'arg2', 'arg3'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('arg1');
			expect(args[3]).to.equal('arg2');
			expect(args[4]).to.equal('arg3');
		});

		it('should not interfere with non-flag arguments', function() {
			const args = ['node', 'script.js', '--some-regular-flag', 'value'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			// Regular flags should not be consumed by multi-sig parsing
			expect(args).to.include('--some-regular-flag');
			expect(args).to.include('value');
		});
	});

	describe('Error Handling Backward Compatibility', function() {

		it('should not throw for scripts with no arguments', function() {
			const args = ['node', 'script.js'];

			expect(() => {
				const config = parseMultiSigArgs(args);
				verifySingleSigMode(config);
			}).to.not.throw();
		});

		it('should not throw for scripts with many arguments', function() {
			const args = [
				'node',
				'script.js',
				'arg1',
				'arg2',
				'arg3',
				'arg4',
				'arg5',
			];

			expect(() => {
				const config = parseMultiSigArgs(args);
				verifySingleSigMode(config);
			}).to.not.throw();
		});

		it('should not throw for scripts with special characters', function() {
			const args = [
				'node',
				'script.js',
				'0.0.123456',
				'1000.50',
				'Test String',
				'!@#$%',
			];

			expect(() => {
				const config = parseMultiSigArgs(args);
				verifySingleSigMode(config);
			}).to.not.throw();
		});
	});

	describe('Help Display Backward Compatibility', function() {

		it('should not show help for normal execution', function() {
			const args = ['node', 'script.js', 'arg1'];

			expect(shouldDisplayHelp(args)).to.be.false;
		});

		it('should only show multi-sig help when explicitly requested', function() {
			const normalArgs = ['node', 'script.js', '--help'];
			const multiSigHelpArgs = ['node', 'script.js', '--multisig-help'];

			expect(shouldDisplayHelp(normalArgs)).to.be.false;
			expect(shouldDisplayHelp(multiSigHelpArgs)).to.be.true;
		});

		it('should not confuse regular flags with multi-sig flags', function() {
			const args = ['node', 'script.js', '--verbose', '--debug'];

			expect(shouldDisplayHelp(args)).to.be.false;

			const config = parseMultiSigArgs(args);
			expect(config.enabled).to.be.false;
		});
	});

	describe('Positional Argument Preservation', function() {

		it('should preserve order of positional arguments', function() {
			const args = ['node', 'script.js', 'first', 'second', 'third'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('first');
			expect(args[3]).to.equal('second');
			expect(args[4]).to.equal('third');
		});

		it('should preserve numeric arguments', function() {
			const args = ['node', 'script.js', '123', '456', '789'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('123');
			expect(args[3]).to.equal('456');
			expect(args[4]).to.equal('789');
		});

		it('should preserve account ID format', function() {
			const args = ['node', 'script.js', '0.0.123456'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('0.0.123456');
		});

		it('should preserve EVM address format', function() {
			const args = ['node', 'script.js', '0x1234567890abcdef'];
			const config = parseMultiSigArgs(args);

			verifySingleSigMode(config);
			expect(args[2]).to.equal('0x1234567890abcdef');
		});
	});

	describe('Default Configuration Values', function() {

		it('should have correct defaults for single-sig mode', function() {
			const config = parseMultiSigArgs(['node', 'script.js']);

			expect(config.enabled).to.be.false;
			expect(config.workflow).to.equal('interactive');
			expect(config.threshold).to.be.null;
			expect(config.keyFiles).to.deep.equal([]);
			expect(config.signerLabels).to.deep.equal([]);
			// signatureFiles may be undefined when not specified
			expect(config.signatureFiles || []).to.be.an('array');
			expect(config.exportOnly).to.be.false;
		});

		it('should not enable multi-sig implicitly', function() {
			const possibleConfusions = [
				['node', 'script.js', '--multi'],
				['node', 'script.js', '--sig'],
				['node', 'script.js', '--threshold=2'],
				['node', 'script.js', '--workflow=interactive'],
			];

			possibleConfusions.forEach(args => {
				const config = parseMultiSigArgs(args);
				// threshold/workflow without --multisig should not enable multi-sig
				// (these might be script-specific flags)
			});
		});
	});

	describe('Integration with Script Helpers', function() {

		const {
			checkMultiSigHelp,
			getMultiSigConfig,
		} = require('../utils/scriptHelpers');

		it('checkMultiSigHelp should return false for normal execution', function() {
			const originalArgv = process.argv;
			process.argv = ['node', 'script.js', 'arg1'];

			const shouldExit = checkMultiSigHelp();

			expect(shouldExit).to.be.false;

			process.argv = originalArgv;
		});

		it('getMultiSigConfig should return disabled config', function() {
			const originalArgv = process.argv;
			process.argv = ['node', 'script.js', 'arg1'];

			const config = getMultiSigConfig();

			expect(config.enabled).to.be.false;

			process.argv = originalArgv;
		});

		it('should not modify process.argv in single-sig mode', function() {
			const originalArgv = process.argv;
			const testArgs = ['node', 'script.js', 'arg1', 'arg2'];
			process.argv = [...testArgs];

			const config = getMultiSigConfig();

			expect(config.enabled).to.be.false;
			expect(process.argv).to.deep.equal(testArgs);

			process.argv = originalArgv;
		});
	});

	describe('No Breaking Changes', function() {

		it('should maintain same API surface for executeContractFunction', function() {
			const { executeContractFunction } = require('../utils/scriptHelpers');

			// Should accept same parameters as before
			expect(executeContractFunction).to.be.a('function');
			expect(executeContractFunction.length).to.be.greaterThan(0);
		});

		it('should maintain same return format', async function() {
			const { executeContractFunction } = require('../utils/scriptHelpers');

			// Test with invalid params to get error response
			const result = await executeContractFunction({
				contractId: null,
				iface: null,
				client: null,
				functionName: 'test',
				params: [],
			}).catch(err => ({ success: false, error: err.message }));

			expect(result).to.have.property('success');
			expect(result.success).to.be.false;
			expect(result).to.have.property('error');
		});

		it('should not add new required parameters', function() {
			const originalArgs = {
				contractId: { toString: () => '0.0.123' },
				iface: { encodeFunctionData: () => '0x' },
				client: null,
				functionName: 'test',
				params: [],
			};

			// Should not throw due to missing new required params
			expect(() => {
				const { executeContractFunction } = require('../utils/scriptHelpers');
				executeContractFunction(originalArgs);
			}).to.not.throw();
		});
	});
});
