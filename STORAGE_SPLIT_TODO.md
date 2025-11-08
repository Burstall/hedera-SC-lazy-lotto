# LazyLotto Storage Split Architecture - Implementation TODO

## Overview
Refactor LazyLottoVoucher → LazyLottoStorage to hold all HTS operations and token custody, allowing LazyLotto to become pure business logic without HTS inheritance.

**Expected Result:** LazyLotto drops from 26.079 KB to ~23-23.5 KB (under 24 KB limit) ✅

---

## Phase 1: Contract Architecture Changes

### 1.1 Rename & Expand LazyLottoVoucher → LazyLottoStorage
- [ ] Rename contract file: `LazyLottoVoucher.sol` → `LazyLottoStorage.sol`
- [ ] Rename interface: `ILazyLottoVoucher.sol` → `ILazyLottoStorage.sol`
- [ ] Update contract documentation to reflect "storage and HTS operations" role
- [ ] Keep existing NFT operations (createToken, mintAndTransferNFT, wipeNFT)

### 1.2 Add Token Transfer Operations to LazyLottoStorage
- [ ] Add `associateToken(address token, address account)` - wraps HTS associate
- [ ] Add `transferHbar(address payable to, uint256 amount)` - HBAR transfers
- [ ] Add `transferFungible(address token, address to, uint256 amount)` - FT transfers
- [ ] Add `cryptoTransfer(...)` - atomic multi-token transfers for prizes
- [ ] Add `transferNFTCollection(address token, address from, address to, int64[] serials)` - batch NFT moves
- [ ] Add events for all transfer operations

### 1.3 Add Token Balance Query Functions to LazyLottoStorage
- [ ] Add `getHbarBalance()` - returns contract's HBAR balance
- [ ] Add `getFungibleBalance(address token)` - returns token balance
- [ ] Add `getNFTOwnership(address token, int64 serial)` - verify NFT ownership
- [ ] These are view functions for transparency

---

## Phase 2: Remove HTS from LazyLotto

### 2.1 Update LazyLotto Inheritance
- [ ] Remove `HederaTokenServiceLite` from inheritance
- [ ] Remove `KeyHelperLite` from inheritance (now only in Storage)
- [ ] Keep `ReentrancyGuard` and `Pausable`
- [ ] Update imports to remove HTS-related files

### 2.2 Update LazyLotto State Variables
- [ ] Change `voucherContract` → `storageContract` (ILazyLottoStorage)
- [ ] Remove `SUCCESS` constant references (will come from Storage responses)
- [ ] Keep all business logic state (pools, pending prizes, bonuses, etc.)

### 2.3 Update LazyLotto Constructor
- [ ] Rename parameter: `_voucherContract` → `_storageContract`
- [ ] Remove `associateToken()` call (will be done via Storage)
- [ ] Call `storageContract.associateToken(address(this), lazyToken)` instead
- [ ] Update constructor documentation

---

## Phase 3: Refactor LazyLotto Token Operations

### 3.1 Pool Creation (createPool)
- [ ] Replace direct `createToken()` call with `storageContract.createToken()`
- [ ] Keep royalty conversion logic in LazyLotto
- [ ] Update gas estimation comments

### 3.2 Token Association (_tokenAssociate)
- [ ] Replace internal HTS calls with `storageContract.associateToken()`
- [ ] Update for fee tokens and prize tokens

### 3.3 Prize Addition (addPrizePackage, addMultipleFungiblePrizes)
- [ ] Keep validation logic in LazyLotto
- [ ] Replace `cryptoTransfer()` with `storageContract.cryptoTransfer()`
- [ ] Update NFT transfer calls to use Storage

### 3.4 Prize Distribution (_distributePrize)
- [ ] Replace HBAR sends with `storageContract.transferHbar()`
- [ ] Replace FT transfers with `storageContract.transferFungible()`
- [ ] Replace NFT transfers with `storageContract.transferNFTCollection()`
- [ ] Keep prize package logic in LazyLotto

### 3.5 NFT Voucher Operations
- [ ] Update `_redeemEntriesToNFT()` to use `storageContract.mintAndTransferNFT()`
- [ ] Update `_redeemEntriesFromNFT()` to use `storageContract.wipeNFT()`
- [ ] Update `_redeemPendingPrizeToNFT()` to use `storageContract.mintAndTransferNFT()`
- [ ] Update `_redeemPendingPrizeFromNFT()` to use `storageContract.wipeNFT()`

### 3.6 Admin Transfer Functions
- [ ] Update `transferHbar()` to call `storageContract.transferHbar()`
- [ ] Update `transferFungible()` to call `storageContract.transferFungible()`
- [ ] Keep admin access control in LazyLotto

---

## Phase 4: Update Interfaces

### 4.1 Create ILazyLottoStorage Interface
- [ ] Copy ILazyLottoVoucher.sol → ILazyLottoStorage.sol
- [ ] Add new function signatures:
  - `associateToken(address token, address account)`
  - `transferHbar(address payable to, uint256 amount)`
  - `transferFungible(address token, address to, uint256 amount)`
  - `cryptoTransfer(...)` - need full HTS signature
  - `transferNFTCollection(address token, address from, address to, int64[] serials)`
  - `getHbarBalance()`
  - `getFungibleBalance(address token)`

### 4.2 Update LazyLotto Imports
- [ ] Replace `import {ILazyLottoVoucher}` with `import {ILazyLottoStorage}`
- [ ] Remove HTS-related imports that are no longer needed

---

## Phase 5: Testing Updates

### 5.1 Update Test File (LazyLotto.test.js)
- [ ] Rename deployment: `LazyLottoVoucher` → `LazyLottoStorage`
- [ ] Deploy LazyLottoStorage before LazyLotto
- [ ] Pass storage address to LazyLotto constructor
- [ ] Update storage admin setup: `storageContract.addAdmin(lazyLottoContract)`

### 5.2 Update Token Approval Flow in Tests
- [ ] **CRITICAL CHANGE**: Users now approve tokens to LazyLottoStorage address (not LazyLotto)
- [ ] Update `setFTAllowance()` calls to use storage address
- [ ] Update `setHbarAllowance()` calls to use storage address
- [ ] Update `setNFTAllowanceAll()` calls to use storage address
- [ ] Add comments explaining approval target change

### 5.3 Add New Test Cases
- [ ] Test LazyLottoStorage token transfer functions independently
- [ ] Test LazyLotto calling Storage for all token operations
- [ ] Verify tokens are held by Storage contract, not LazyLotto
- [ ] Test admin access control (only LazyLotto can call Storage operations)

### 5.4 Update Existing Test Assertions
- [ ] Update balance checks to query LazyLottoStorage (not LazyLotto)
- [ ] Update NFT ownership checks to query Storage
- [ ] Update HBAR balance checks to query Storage
- [ ] Verify LazyLotto has minimal/no token balances

---

## Phase 6: Documentation Updates

### 6.1 Update LazyLotto-BUSINESS_LOGIC.md
- [ ] Add section: "Architecture: Storage Pattern"
- [ ] Explain LazyLotto = logic, LazyLottoStorage = custody
- [ ] Document that Storage holds all tokens/NFTs
- [ ] Update deployment flow documentation

### 6.2 Update LazyLotto-UX_IMPLEMENTATION_GUIDE.md
- [ ] **CRITICAL SECTION**: "Token Approval Architecture"
- [ ] Explain users approve tokens to **LazyLottoStorage** address
- [ ] Update code examples showing approval to Storage
- [ ] Add architecture diagram:
  ```
  User → [approves tokens to] → LazyLottoStorage
  User → [calls functions on] → LazyLotto
  LazyLotto → [calls Storage for HTS ops] → LazyLottoStorage
  ```
- [ ] Update transaction workflow examples
- [ ] Add troubleshooting: "Common mistake: approving to LazyLotto instead of Storage"

### 6.3 Update LazyLotto-TESTING_PLAN.md
- [ ] Add "Storage Split Architecture" section
- [ ] Document test setup changes (Storage deployment, approvals)
- [ ] Update gas estimation for Storage operations
- [ ] Add integration testing guidance

### 6.4 Create DEPLOYMENT_GUIDE.md (New)
- [ ] Document deployment order:
  1. Deploy LazyLottoStorage
  2. Deploy LazyLotto with Storage address
  3. Set LazyLotto as Storage admin
  4. Users approve tokens to Storage address
- [ ] Include address verification steps
- [ ] Add troubleshooting section

---

## Phase 7: Compilation & Validation

### 7.1 Compile Contracts
- [ ] Run `npx hardhat compile --force`
- [ ] Verify LazyLotto is **under 24 KB** (target: 23-23.5 KB)
- [ ] Verify LazyLottoStorage is under 24 KB (expect 6-8 KB)
- [ ] Check for compilation errors
- [ ] Verify no HTS code in LazyLotto bytecode

### 7.2 Run Test Suite
- [ ] Run full test suite: `npx hardhat test`
- [ ] Verify all existing tests pass
- [ ] Verify new Storage tests pass
- [ ] Check gas usage remains reasonable
- [ ] Verify no regressions in functionality

### 7.3 Size Analysis
- [ ] Document exact contract sizes
- [ ] Calculate savings: Original LazyLotto - New LazyLotto
- [ ] Verify savings meet expectations (~2-3 KB)
- [ ] Create size comparison chart for documentation

---

## Phase 8: Final Validation

### 8.1 Integration Testing
- [ ] Test complete user flow: approve → buy → roll → claim
- [ ] Test NFT voucher system end-to-end
- [ ] Test admin functions (pool creation, prize management)
- [ ] Test bonus system still works correctly
- [ ] Test edge cases (insufficient approvals, etc.)

### 8.2 Security Review
- [ ] Verify admin access control on Storage (only LazyLotto can call)
- [ ] Verify no direct user access to Storage functions
- [ ] Verify LazyLotto cannot be bypassed
- [ ] Verify token custody is secure in Storage
- [ ] Check for reentrancy vulnerabilities in new pattern

### 8.3 Documentation Review
- [ ] All docs updated and accurate
- [ ] Code comments reflect new architecture
- [ ] Migration guide for existing users (if applicable)
- [ ] Frontend integration guide updated

---

## Phase 9: Deployment Preparation

### 9.1 Create Deployment Scripts
- [ ] Update `deployLazyLottoStorage.js` (rename from voucher)
- [ ] Update `deployLazyLotto.js` with Storage address parameter
- [ ] Create `setupStorageAdmin.js` for admin setup
- [ ] Test deployment scripts on testnet

### 9.2 Create Migration Plan (if needed)
- [ ] Document steps to upgrade from current version
- [ ] Create scripts for prize migration (if applicable)
- [ ] User communication plan about approval address change

---

## Success Criteria

✅ **Primary Goal**: LazyLotto < 24 KB (target: 23-23.5 KB)
✅ **Secondary Goal**: LazyLottoStorage < 24 KB (expect: 6-8 KB)
✅ **Functionality**: All tests pass, no features lost
✅ **Architecture**: Clear separation - Logic (LazyLotto) vs Storage
✅ **Documentation**: Complete user/dev guidance on new pattern
✅ **Security**: Storage admin access properly controlled

---

## Risk Mitigation

⚠️ **User Approval Change**: Users must approve tokens to Storage (not LazyLotto)
- Mitigation: Clear documentation, UI warnings, migration guides

⚠️ **Contract Interaction Complexity**: LazyLotto → Storage adds call layer
- Mitigation: Comprehensive testing, gas profiling

⚠️ **Existing Approvals**: Users with old approvals to LazyLotto need to re-approve
- Mitigation: Detection in UI, helpful error messages

---

## Implementation Order

**Recommended sequence:**
1. Phase 1 (Contract Architecture) - Foundation
2. Phase 2 (Remove HTS) - Core refactor
3. Phase 4 (Interfaces) - Enable compilation
4. Phase 3 (Refactor Operations) - Wire everything up
5. Phase 7 (Compile & Validate) - Check size savings
6. Phase 5 (Testing Updates) - Validation
7. Phase 6 (Documentation) - Communication
8. Phase 8 (Final Validation) - Production readiness
9. Phase 9 (Deployment Prep) - Ship it

**Estimated Effort**: 4-6 hours for experienced developer

---

## Notes

- This is a **major architectural change** - thorough testing critical
- Users will need to **re-approve tokens** to new Storage address
- ABI of LazyLotto remains **mostly unchanged** (good for frontends)
- Storage contract is **highly reusable** for other projects
- Consider versioning: LazyLottoV3 with Storage pattern

---

**Status**: Ready to begin Phase 1
**Last Updated**: November 3, 2025
