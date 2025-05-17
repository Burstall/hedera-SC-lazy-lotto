// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Core Staking Module for NFTs
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract handles the movement of NFTs between the user and other contracts
/// @dev Uses hbar for royalties making it generic
/// @version 1.0 - 1 tinybar only.

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenServiceLite} from "./HederaTokenServiceLite.sol";
import {IHederaTokenServiceLite} from "./interfaces/IHederaTokenServiceLite.sol";
import {KeyHelperLite} from "./KeyHelperLite.sol"; // Added import for KeyHelperLite

import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TokenStaker is HederaTokenServiceLite, KeyHelperLite {
    using SafeCast for uint256;
    using SafeCast for int256;

    error FailedToInitialize();
    error BadArguments();
    error NFTTransferFailed(TransferDirection _direction);
    error AssociationFailed();
    error BatchAssociationFailed();

    enum TransferDirection {
        STAKING,
        WITHDRAWAL
    }

    address public lazyToken;
    ILazyGasStation public lazyGasStation;
    ILazyDelegateRegistry public lazyDelegateRegistry;
    uint256 private constant MAX_NFTS_PER_TX = 8;

    modifier refill() {
        // check the $LAZY balance of the contract and refill if necessary
        if (IERC20(lazyToken).balanceOf(address(this)) < 20) {
            lazyGasStation.refillLazy(50);
        }
        // check the balance of the contract and refill if necessary
        if (address(this).balance < 20) {
            lazyGasStation.refillHbar(50);
        }
        _;
    }

    function initContracts(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry
    ) internal {
        lazyToken = _lazyToken;
        lazyGasStation = ILazyGasStation(_lazyGasStation);
        lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);

        int256 response = super.associateToken(address(this), lazyToken);

        if (response != HederaResponseCodes.SUCCESS) {
            revert FailedToInitialize();
        }
    }

    //function to transfer NFTs
    function moveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
        bool _delegate
    ) internal {
        if (_serials.length > 8) revert BadArguments();
        address receiverAddress;
        address senderAddress;
        bool isHbarApproval;

        if (_direction == TransferDirection.STAKING) {
            receiverAddress = address(this);
            senderAddress = _transferInitiator;
        } else {
            receiverAddress = _transferInitiator;
            senderAddress = address(this);
            isHbarApproval = true;
        }

        // hbar moves sit separate from NFT moves (max 8 NFTs + 2 hbar legs +1/-1 tiny bar)
        IHederaTokenServiceLite.TokenTransferList[]
            memory _transfers = new IHederaTokenServiceLite.TokenTransferList[](
                _serials.length
            );

        // prep the hbar transfer
        IHederaTokenServiceLite.TransferList memory _hbarTransfer;
        _hbarTransfer.transfers = new IHederaTokenServiceLite.AccountAmount[](
            2
        );

        _hbarTransfer.transfers[0].accountID = receiverAddress;
        _hbarTransfer.transfers[0].amount = -1;
        _hbarTransfer.transfers[0].isApproval = isHbarApproval;

        _hbarTransfer.transfers[1].accountID = senderAddress;
        _hbarTransfer.transfers[1].amount = 1;

        if (_delegate && _direction == TransferDirection.WITHDRAWAL) {
            // order matters, we can only do this BEFORE transfer as contract must hold the NFTs
            lazyDelegateRegistry.revokeDelegateNFT(
                _collectionAddress,
                _serials
            );
        }

        // transfer NFT
        for (uint256 i = 0; i < _serials.length; i++) {
            IHederaTokenServiceLite.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = senderAddress;
            _nftTransfer.receiverAccountID = receiverAddress;
            _nftTransfer.isApproval = !isHbarApproval;

            if (_serials[i] == 0) {
                continue;
            }
            _transfers[i].token = _collectionAddress;

            _transfers[i]
                .nftTransfers = new IHederaTokenServiceLite.NftTransfer[](1);

            _nftTransfer.serialNumber = SafeCast.toInt64(int256(_serials[i]));
            _transfers[i].nftTransfers[0] = _nftTransfer;
        }

        int256 response = super.cryptoTransfer(_hbarTransfer, _transfers);

        if (response != HederaResponseCodes.SUCCESS) {
            // could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
            revert NFTTransferFailed(_direction);
        }

        if (_delegate && _direction == TransferDirection.STAKING) {
            // order matters, we can only do this AFTER transfer as contract must hold the NFTs
            lazyDelegateRegistry.delegateNFT(
                senderAddress,
                _collectionAddress,
                _serials
            );
        }
    }

    /**
     * @dev associate token with hedera service
     * @param tokenId address to associate
     */
    function tokenAssociate(address tokenId) public {
        int256 response = super.associateToken(address(this), tokenId);

        if (
            !(response == SUCCESS ||
                response == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            revert AssociationFailed();
        }
    }

    function batchTokenAssociate(address[] memory tokenIds) public {
        int256 response = super.associateTokens(address(this), tokenIds);

        if (response != HederaResponseCodes.SUCCESS) {
            revert BatchAssociationFailed();
        }
    }

    /**
     * @dev associate a group of tokens one at a time to ensure already associated tokens are safely handled
     * less gas efficient than batchTokenAssociate
     * @param tokenIds array of token addresses to associate
     */
    function safeBatchTokenAssociate(address[] memory tokenIds) public {
        uint256 tokenArrayLength = tokenIds.length;
        for (uint256 i = 0; i < tokenArrayLength; ) {
            tokenAssociate(tokenIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev associate a group of tokens one at a time comparing to a list of already associated tokens
     * less gas efficient than batchTokenAssociate but should be more efficient than safeBatchTokenAssociate
     * lots of loop work here, so gas costs are high
     * @param tokenIds array of token addresses to associate
     * @param existingTokenIds array of token addresses already associated
     */
    function noClashBatchTokenAssociate(
        address[] memory tokenIds,
        address[] memory existingTokenIds
    ) public {
        uint256 tokenArrayLength = tokenIds.length;
        uint256 existingTokenArrayLength = existingTokenIds.length;
        for (uint256 i = 0; i < tokenArrayLength; ) {
            bool clash = false;
            for (uint256 j = 0; j < existingTokenArrayLength; ) {
                if (tokenIds[i] == existingTokenIds[j]) {
                    clash = true;
                    break;
                }
                unchecked {
                    ++j;
                }
            }
            if (!clash) {
                tokenAssociate(tokenIds[i]);
            }
            unchecked {
                ++i;
            }
        }
    }

    function batchMoveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
        bool _delegate
    ) internal refill {
        // check the number of serials and send in batches of 8
        for (
            uint256 outer = 0;
            outer < _serials.length;
            outer += MAX_NFTS_PER_TX
        ) {
            uint256 batchSize = (_serials.length - outer) >= MAX_NFTS_PER_TX
                ? MAX_NFTS_PER_TX
                : (_serials.length - outer);
            uint256[] memory serials = new uint256[](batchSize);
            for (
                uint256 inner = 0;
                ((outer + inner) < _serials.length) &&
                    (inner < MAX_NFTS_PER_TX);
                inner++
            ) {
                if (outer + inner < _serials.length) {
                    serials[inner] = _serials[outer + inner];
                }
            }
            moveNFTs(
                _direction,
                _collectionAddress,
                serials,
                _transferInitiator,
                _delegate
            );
        }
    }
}
