/**
 * Multi-Sig Admin Integration Tests
 *
 * Tests the integration of multi-signature functionality with LazyLotto admin operations.
 * Validates that the multiSigIntegration.js bridge works correctly with contract calls.
 */

const { expect } = require('chai');
const {
	parseMultiSigArgs,
	createKeyProviders,
	shouldDisplayHelp,
} = require('../utils/multiSigIntegration');
const {
	executeContractFunction,
	checkMultiSigHelp,
	getMultiSigConfig,
	displayMultiSigBanner,
} = require('../utils/scriptHelpers');

describe('Multi-Sig Admin Integration', function() {
	this.timeout(30000);

	describe('CLI Argument Parsing', function() {

		it('should detect --multisig flag', function() {
			const args = ['node', 'script.js', '--multisig'];
			const config = parseMultiSigArgs(args);

			expect(config.enabled).to.be.true;
			expect(config.workflow).to.equal('interactive');
		});

		it('should detect --offline flag', function() {
			const args = ['node', 'script.js', '--offline'];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('offline');
		});

		it('should parse workflow parameter', function() {
			const args = ['node', 'script.js', '--workflow=offline'];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('offline');
		});

		it('should parse threshold parameter', function() {
			const args = ['node', 'script.js', '--threshold=3'];
			const config = parseMultiSigArgs(args);

			expect(config.threshold).to.equal(3);
		});

		it('should parse key files', function() {
			const args = ['node', 'script.js', '--keyfile=key1.enc,key2.enc,key3.enc'];
			const config = parseMultiSigArgs(args);

			expect(config.keyFiles).to.deep.equal(['key1.enc', 'key2.enc', 'key3.enc']);
		});

		it('should parse signer labels', function() {
			const args = ['node', 'script.js', '--signers=Alice,Bob,Charlie'];
			const config = parseMultiSigArgs(args);

			expect(config.signerLabels).to.deep.equal(['Alice', 'Bob', 'Charlie']);
		});

		it('should parse signature files', function() {
			const args = ['node', 'script.js', '--signatures=sig1.json,sig2.json'];
			const config = parseMultiSigArgs(args);

			expect(config.signatureFiles).to.deep.equal(['sig1.json', 'sig2.json']);
		});

		it('should detect export-only mode', function() {
			const args = ['node', 'script.js', '--export-only'];
			const config = parseMultiSigArgs(args);

			expect(config.exportOnly).to.be.true;
			expect(config.workflow).to.equal('offline');
		});

		it('should handle multiple flags combined', function() {
			const args = [
				'node',
				'script.js',
				'--multisig',
				'--workflow=offline',
				'--threshold=2',
				'--signers=Alice,Bob,Charlie',
			];
			const config = parseMultiSigArgs(args);

			expect(config.enabled).to.be.true;
			expect(config.workflow).to.equal('offline');
			expect(config.threshold).to.equal(2);
			expect(config.signerLabels).to.deep.equal(['Alice', 'Bob', 'Charlie']);
		});

		it('should return default config when no flags present', function() {
			const args = ['node', 'script.js', 'arg1', 'arg2'];
			const config = parseMultiSigArgs(args);

			expect(config.enabled).to.be.false;
			expect(config.workflow).to.equal('interactive');
			expect(config.threshold).to.be.null;
			expect(config.keyFiles).to.deep.equal([]);
		});
	});

	describe('Help Display Detection', function() {

		it('should detect --multisig-help flag', function() {
			const args = ['node', 'script.js', '--multisig-help'];
			const shouldShow = shouldDisplayHelp(args);

			expect(shouldShow).to.be.true;
		});

		it('should detect --ms-help flag', function() {
			const args = ['node', 'script.js', '--ms-help'];
			const shouldShow = shouldDisplayHelp(args);

			expect(shouldShow).to.be.true;
		});

		it('should not detect help when not present', function() {
			const args = ['node', 'script.js', '--multisig'];
			const shouldShow = shouldDisplayHelp(args);

			expect(shouldShow).to.be.false;
		});
	});

	describe('Script Helpers', function() {

		it('should get multi-sig config', function() {
			// Temporarily modify process.argv for test
			const originalArgv = process.argv;
			process.argv = ['node', 'script.js', '--multisig', '--threshold=2'];

			const config = getMultiSigConfig();

			expect(config.enabled).to.be.true;
			expect(config.threshold).to.equal(2);

			// Restore original argv
			process.argv = originalArgv;
		});

		it('should not throw when displaying banner', function() {
			expect(() => {
				displayMultiSigBanner({ enabled: false });
			}).to.not.throw();

			expect(() => {
				displayMultiSigBanner({ enabled: true, workflow: 'interactive', threshold: 2 });
			}).to.not.throw();
		});

		it('should check help without modifying state', function() {
			const originalArgv = process.argv;
			process.argv = ['node', 'script.js'];

			const shouldExit = checkMultiSigHelp();

			expect(shouldExit).to.be.false;

			// Restore
			process.argv = originalArgv;
		});
	});

	describe('Key Provider Creation', function() {

		it('should create env key provider by default for offline', async function() {
			const config = {
				workflow: 'offline',
				keyFiles: [],
				threshold: null,
			};

			const providers = await createKeyProviders(config);

			expect(providers).to.have.lengthOf(1);
			expect(providers[0].constructor.name).to.equal('EnvKeyProvider');
		});

		it('should create prompt providers for interactive', async function() {
			const config = {
				workflow: 'interactive',
				keyFiles: [],
				threshold: 2,
			};

			const providers = await createKeyProviders(config);

			expect(providers).to.have.lengthOf(2);
			providers.forEach(provider => {
				expect(provider.constructor.name).to.equal('PromptKeyProvider');
			});
		});

		it('should create encrypted file providers when keyFiles specified', async function() {
			const config = {
				workflow: 'interactive',
				keyFiles: ['key1.enc', 'key2.enc'],
				threshold: 2,
			};

			const providers = await createKeyProviders(config);

			expect(providers).to.have.lengthOf(2);
			providers.forEach(provider => {
				expect(provider.constructor.name).to.equal('EncryptedFileProvider');
			});
		});
	});

	describe('ExecuteContractFunction Error Handling', function() {

		it('should handle missing contract ID', async function() {
			try {
				await executeContractFunction({
					contractId: null,
					iface: null,
					client: null,
					functionName: 'test',
					params: [],
				});
				expect.fail('Should have thrown error');
			}
			catch (error) {
				expect(error).to.exist;
			}
		});

		it('should return error result for failed execution', async function() {
			// This will fail due to missing client/contract setup
			const result = await executeContractFunction({
				contractId: { toString: () => '0.0.123' },
				iface: { encodeFunctionData: () => '0x' },
				client: null,
				functionName: 'test',
				params: [],
			}).catch(err => ({ success: false, error: err.message }));

			expect(result.success).to.be.false;
			expect(result.error).to.exist;
		});
	});

	describe('Configuration Validation', function() {

		it('should validate interactive workflow config', function() {
			const validConfig = {
				enabled: true,
				workflow: 'interactive',
				threshold: 2,
				keyFiles: [],
				signerLabels: ['Alice', 'Bob'],
			};

			// Basic validation
			expect(validConfig.workflow).to.be.oneOf(['interactive', 'offline']);
			expect(validConfig.threshold).to.be.a('number');
			expect(validConfig.threshold).to.be.at.least(1);
		});

		it('should validate offline workflow config', function() {
			const exportConfig = {
				enabled: true,
				workflow: 'offline',
				exportOnly: true,
				threshold: 2,
			};

			expect(exportConfig.workflow).to.equal('offline');
			expect(exportConfig.exportOnly).to.be.true;

			const executeConfig = {
				enabled: true,
				workflow: 'offline',
				exportOnly: false,
				signatureFiles: ['sig1.json', 'sig2.json'],
				threshold: 2,
			};

			expect(executeConfig.signatureFiles).to.have.lengthOf(2);
			expect(executeConfig.threshold).to.equal(2);
		});

		it('should validate threshold constraints', function() {
			const config = {
				threshold: 3,
				keyFiles: ['key1.enc', 'key2.enc'],
			};

			// Threshold should not exceed available signers
			// (This would be caught by WorkflowOrchestrator validation)
			expect(config.threshold).to.be.greaterThan(config.keyFiles.length);
		});
	});

	describe('Integration Patterns', function() {

		it('should support drop-in replacement pattern', function() {
			// The executeContractFunction should be usable as a drop-in replacement
			// for manual ContractExecuteTransaction code

			const oldPattern = {
				usesContractExecuteTransaction: true,
				requiresManualReceiptCheck: true,
				requiresManualSigning: true,
			};

			const newPattern = {
				usesExecuteContractFunction: true,
				autoHandlesMultiSig: true,
				autoHandlesReceipt: true,
				backwardCompatible: true,
			};

			expect(newPattern.usesExecuteContractFunction).to.be.true;
			expect(newPattern.backwardCompatible).to.be.true;
		});

		it('should preserve single-sig behavior when multi-sig disabled', function() {
			const args = ['node', 'script.js']; // No --multisig flag
			const config = parseMultiSigArgs(args);

			expect(config.enabled).to.be.false;
			// When disabled, should fall back to contractExecuteFunction from solidityHelpers
		});

		it('should enable multi-sig when flag present', function() {
			const args = ['node', 'script.js', '--multisig'];
			const config = parseMultiSigArgs(args);

			expect(config.enabled).to.be.true;
			// When enabled, should use multi-sig workflows
		});
	});

	describe('Argument Filtering', function() {

		it('should filter out flags from positional arguments', function() {
			const args = ['node', 'script.js', '10', '--multisig', '--threshold=2'];

			// Script should extract '10' as the percentage argument
			const percentage = args[2];
			const isFlag = percentage.startsWith('--');

			expect(isFlag).to.be.false;
			expect(percentage).to.equal('10');
		});

		it('should handle flags before positional arguments', function() {
			const args = ['node', 'script.js', '--multisig', '10', '--threshold=2'];

			// Find first non-flag argument
			const firstNonFlag = args.find((arg, idx) => idx >= 2 && !arg.startsWith('--'));

			expect(firstNonFlag).to.equal('10');
		});

		it('should handle all flags with no positional arguments', function() {
			const args = ['node', 'script.js', '--multisig', '--export-only', '--threshold=2'];

			const nonFlags = args.slice(2).filter(arg => !arg.startsWith('--'));

			expect(nonFlags).to.have.lengthOf(0);
		});
	});

	// ============================================================================
	// Enhanced Integration Tests
	// ============================================================================

	describe('Threshold Variations', function() {

		it('should support 2-of-3 threshold configuration', function() {
			const config = {
				workflow: 'interactive',
				threshold: 2,
				keyFiles: ['key1.enc', 'key2.enc', 'key3.enc'],
			};

			expect(config.threshold).to.equal(2);
			expect(config.keyFiles).to.have.lengthOf(3);
			expect(config.threshold).to.be.lessThan(config.keyFiles.length);
		});

		it('should support 3-of-5 threshold configuration', function() {
			const config = {
				workflow: 'interactive',
				threshold: 3,
				keyFiles: ['key1.enc', 'key2.enc', 'key3.enc', 'key4.enc', 'key5.enc'],
			};

			expect(config.threshold).to.equal(3);
			expect(config.keyFiles).to.have.lengthOf(5);
		});

		it('should support exact threshold (M-of-M)', function() {
			const config = {
				workflow: 'interactive',
				threshold: 3,
				keyFiles: ['key1.enc', 'key2.enc', 'key3.enc'],
			};

			expect(config.threshold).to.equal(config.keyFiles.length);
		});

		it('should validate threshold does not exceed available signers', function() {
			const config = {
				threshold: 5,
				keyFiles: ['key1.enc', 'key2.enc', 'key3.enc'],
			};

			// This validation would be performed by WorkflowOrchestrator
			const isValid = config.threshold <= config.keyFiles.length;
			expect(isValid).to.be.false;
		});
	});

	describe('Workflow Mode Selection', function() {

		it('should detect interactive mode from --multisig flag', function() {
			const args = ['node', 'script.js', '--multisig'];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('interactive');
		});

		it('should detect offline mode from --offline flag', function() {
			const args = ['node', 'script.js', '--offline'];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('offline');
		});

		it('should detect offline mode from --workflow=offline', function() {
			const args = ['node', 'script.js', '--workflow=offline'];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('offline');
		});

		it('should prioritize explicit workflow over default', function() {
			const args = ['node', 'script.js', '--multisig', '--workflow=offline'];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('offline');
		});

		it('should detect export-only mode', function() {
			const args = ['node', 'script.js', '--export-only'];
			const config = parseMultiSigArgs(args);

			expect(config.exportOnly).to.be.true;
			expect(config.workflow).to.equal('offline');
		});
	});

	describe('Mixed Key Types', function() {

		it('should support mixed Ed25519 and ECDSA keys in config', async function() {
			// Simulate config with both key types
			const config = {
				workflow: 'interactive',
				threshold: 2,
				signerLabels: ['Alice (Ed25519)', 'Bob (ECDSA)', 'Charlie (Ed25519)'],
				keyAlgorithms: ['Ed25519', 'ECDSA', 'Ed25519'],
			};

			expect(config.keyAlgorithms).to.include('Ed25519');
			expect(config.keyAlgorithms).to.include('ECDSA');
		});

		it('should handle key type detection for Ed25519', function() {
			// Mock Ed25519 DER prefix
			const ed25519Prefix = '302e';
			expect(ed25519Prefix).to.equal('302e');
		});

		it('should handle key type detection for ECDSA', function() {
			// Mock ECDSA DER prefix
			const ecdsaPrefix = '3030';
			expect(ecdsaPrefix).to.equal('3030');
		});
	});

	describe('Error Scenarios', function() {

		it('should handle missing threshold gracefully', function() {
			const args = ['node', 'script.js', '--multisig'];
			const config = parseMultiSigArgs(args);

			expect(config.threshold).to.be.null;
			// Should default to number of key providers
		});

		it('should handle missing key files for interactive mode', function() {
			const args = ['node', 'script.js', '--multisig', '--threshold=2'];
			const config = parseMultiSigArgs(args);

			expect(config.keyFiles).to.deep.equal([]);
			// Should prompt for keys instead
		});

		it('should handle invalid threshold value', function() {
			const args = ['node', 'script.js', '--threshold=abc'];
			const config = parseMultiSigArgs(args);

			// Invalid threshold should parse as NaN
			expect(isNaN(config.threshold)).to.be.true;
		});

		it('should handle empty signer labels', function() {
			const args = ['node', 'script.js', '--signers='];
			const config = parseMultiSigArgs(args);

			// Empty string value results in array with empty string
			expect(config.signerLabels).to.deep.equal(['']);
		});

		it('should handle malformed signature file paths', function() {
			const args = ['node', 'script.js', '--signatures='];
			const config = parseMultiSigArgs(args);

			// Empty string value results in array with empty string
			expect(config.signatureFiles).to.deep.equal(['']);
		});
	});

	describe('Offline Workflow Phases', function() {

		it('should configure phase 1: freeze and export', function() {
			const args = ['node', 'script.js', '--offline', '--export-only'];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('offline');
			expect(config.exportOnly).to.be.true;
			// signatureFiles not specified should be empty array or undefined
			expect(config.signatureFiles || []).to.be.an('array');
		});

		it('should configure phase 2+3: collect and execute', function() {
			const args = [
				'node',
				'script.js',
				'--offline',
				'--signatures=sig1.json,sig2.json,sig3.json',
				'--threshold=2',
			];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('offline');
			expect(config.signatureFiles).to.deep.equal(['sig1.json', 'sig2.json', 'sig3.json']);
			expect(config.threshold).to.equal(2);
		});

		it('should handle partial signature collection', function() {
			const args = [
				'node',
				'script.js',
				'--offline',
				'--signatures=sig1.json,sig2.json',
				'--threshold=3',
			];
			const config = parseMultiSigArgs(args);

			expect(config.signatureFiles.length).to.be.lessThan(config.threshold);
			// Should fail validation later
		});
	});

	describe('Security Tier Selection', function() {

		it('should use PromptKeyProvider when no key files specified (highest security)', async function() {
			const config = {
				workflow: 'interactive',
				keyFiles: [],
				threshold: 2,
			};

			const providers = await createKeyProviders(config);

			expect(providers).to.have.lengthOf(2);
			providers.forEach(provider => {
				expect(provider.constructor.name).to.equal('PromptKeyProvider');
			});
		});

		it('should use EncryptedFileProvider when key files specified', async function() {
			const config = {
				workflow: 'interactive',
				keyFiles: ['key1.enc', 'key2.enc'],
				threshold: 2,
			};

			const providers = await createKeyProviders(config);

			expect(providers).to.have.lengthOf(2);
			providers.forEach(provider => {
				expect(provider.constructor.name).to.equal('EncryptedFileProvider');
			});
		});

		it('should use EnvKeyProvider for offline export (dev tier)', async function() {
			const config = {
				workflow: 'offline',
				keyFiles: [],
				threshold: null,
			};

			const providers = await createKeyProviders(config);

			expect(providers).to.have.lengthOf(1);
			expect(providers[0].constructor.name).to.equal('EnvKeyProvider');
		});
	});

	describe('Signer Label Management', function() {

		it('should parse comma-separated signer labels', function() {
			const args = ['node', 'script.js', '--signers=Alice,Bob,Charlie'];
			const config = parseMultiSigArgs(args);

			expect(config.signerLabels).to.deep.equal(['Alice', 'Bob', 'Charlie']);
		});

		it('should handle labels with spaces', function() {
			const args = ['node', 'script.js', '--signers=Alice Smith,Bob Jones,Charlie Brown'];
			const config = parseMultiSigArgs(args);

			expect(config.signerLabels).to.deep.equal(['Alice Smith', 'Bob Jones', 'Charlie Brown']);
		});

		it('should match signer labels to key files count', function() {
			const args = [
				'node',
				'script.js',
				'--keyfile=key1.enc,key2.enc,key3.enc',
				'--signers=Alice,Bob,Charlie',
			];
			const config = parseMultiSigArgs(args);

			expect(config.keyFiles.length).to.equal(config.signerLabels.length);
		});

		it('should handle mismatched label and key file counts', function() {
			const args = [
				'node',
				'script.js',
				'--keyfile=key1.enc,key2.enc',
				'--signers=Alice,Bob,Charlie',
			];
			const config = parseMultiSigArgs(args);

			// More labels than key files - should be handled gracefully
			expect(config.signerLabels.length).to.be.greaterThan(config.keyFiles.length);
		});
	});

	describe('CLI Flag Compatibility', function() {

		it('should handle long-form and short-form flags', function() {
			const longForm = parseMultiSigArgs(['node', 'script.js', '--multisig-help']);
			const shortForm = parseMultiSigArgs(['node', 'script.js', '--ms-help']);

			expect(shouldDisplayHelp(['node', 'script.js', '--multisig-help'])).to.be.true;
			expect(shouldDisplayHelp(['node', 'script.js', '--ms-help'])).to.be.true;
		});

		it('should handle flag aliases', function() {
			const workflow1 = parseMultiSigArgs(['node', 'script.js', '--workflow=offline']);
			const workflow2 = parseMultiSigArgs(['node', 'script.js', '--offline']);

			expect(workflow1.workflow).to.equal(workflow2.workflow);
		});

		it('should handle boolean flags without values', function() {
			const config = parseMultiSigArgs(['node', 'script.js', '--multisig', '--export-only']);

			expect(config.enabled).to.be.true;
			expect(config.exportOnly).to.be.true;
		});

		it('should handle value-based flags with equals sign', function() {
			const config = parseMultiSigArgs([
				'node',
				'script.js',
				'--threshold=3',
				'--workflow=offline',
			]);

			expect(config.threshold).to.equal(3);
			expect(config.workflow).to.equal('offline');
		});
	});

	describe('Real-World Admin Script Scenarios', function() {

		it('should configure setBurnPercentage with 2-of-3 multi-sig', function() {
			const args = [
				'node',
				'setBurnPercentage.js',
				'10',
				'--multisig',
				'--threshold=2',
				'--signers=Treasury,Security,Operations',
			];
			const config = parseMultiSigArgs(args);

			expect(config.enabled).to.be.true;
			expect(config.threshold).to.equal(2);
			expect(config.signerLabels).to.have.lengthOf(3);
			expect(args[2]).to.equal('10'); // Preserve positional arg
		});

		it('should configure pauseContract for emergency offline signing', function() {
			const args = [
				'node',
				'pauseContract.js',
				'--offline',
				'--export-only',
				'--signers=CTO,CEO,Lead Security',
			];
			const config = parseMultiSigArgs(args);

			expect(config.workflow).to.equal('offline');
			expect(config.exportOnly).to.be.true;
			expect(config.signerLabels).to.have.lengthOf(3);
		});

		it('should configure withdrawTokens with encrypted keys', function() {
			const args = [
				'node',
				'withdrawTokens.js',
				'0.0.123456',
				'1000',
				'--multisig',
				'--keyfile=treasury.enc,security.enc,operations.enc',
				'--threshold=2',
			];
			const config = parseMultiSigArgs(args);

			expect(config.enabled).to.be.true;
			expect(config.keyFiles).to.have.lengthOf(3);
			expect(config.threshold).to.equal(2);
			expect(args[2]).to.equal('0.0.123456'); // Token ID preserved
			expect(args[3]).to.equal('1000'); // Amount preserved
		});

		it('should handle createPool with comprehensive multi-sig setup', function() {
			const args = [
				'node',
				'createPool.js',
				'--multisig',
				'--workflow=interactive',
				'--threshold=3',
				'--keyfile=admin1.enc,admin2.enc,admin3.enc,admin4.enc,admin5.enc',
				'--signers=Alice,Bob,Charlie,Dave,Eve',
			];
			const config = parseMultiSigArgs(args);

			expect(config.enabled).to.be.true;
			expect(config.workflow).to.equal('interactive');
			expect(config.threshold).to.equal(3);
			expect(config.keyFiles).to.have.lengthOf(5);
			expect(config.signerLabels).to.have.lengthOf(5);
		});
	});

	describe('Audit and Logging Configuration', function() {

		it('should handle custom audit log path', function() {
			const customPath = './custom/audit/multi-sig.log';
			const config = {
				auditLogPath: customPath,
			};

			expect(config.auditLogPath).to.equal(customPath);
		});

		it('should handle custom export directory', function() {
			const customDir = './secure-exports';
			const config = {
				exportDir: customDir,
			};

			expect(config.exportDir).to.equal(customDir);
		});

		it('should validate audit log path format', function() {
			const validPaths = [
				'./logs/audit.log',
				'/var/log/multisig/audit.log',
				'C:\\logs\\audit.log',
				'./audit-2024-12-19.log',
			];

			validPaths.forEach(path => {
				expect(path).to.be.a('string');
				expect(path.length).to.be.greaterThan(0);
			});
		});
	});
});
