// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Core Staking Module for NFTs + HTS Lite
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract handles the movement of NFTs between the user and other contracts
/// @dev removes the usage of $LAZY for gas refills / token movements instead only hbar is used
/// @version 3.0 -- simplified for the Lotto Contract.
/// Lite version with reduced functionality for smaller contracts

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenServiceLite} from "./HederaTokenServiceLite.sol";
import {IHederaTokenServiceLite} from "./interfaces/IHederaTokenServiceLite.sol";
import {KeyHelperLite} from "./KeyHelperLite.sol";

import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract HTSLottoUtils is HederaTokenServiceLite, KeyHelperLite {
    using SafeCast for uint256;
    using SafeCast for int256;

    error FailedToInitialize();
    error BadArguments();
    error NFTTransferFailed(TransferDirection _direction);
    error AssociationFailed(address tokenAddress);
    error BatchAssociationFailed();

    enum TransferDirection {
        STAKING,
        WITHDRAWAL
    }

    address public lazyToken;
    ILazyGasStation public lazyGasStation;
    ILazyDelegateRegistry public lazyDelegateRegistry;
    uint256 private constant MAX_NFTS_PER_TX = 8;

    function _initContracts(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry
    ) internal {
        lazyToken = _lazyToken;
        lazyGasStation = ILazyGasStation(_lazyGasStation);
        lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);

        int256 response = associateToken(address(this), lazyToken);

        if (response != HederaResponseCodes.SUCCESS) {
            revert FailedToInitialize();
        }
    }

    //function to transfer NFTs
    /**
     * @dev Internal function to move a batch of NFTs (up to MAX_NFTS_PER_TX).
     * It constructs the necessary transfer lists for HBAR (tinybar dust for discovery) and NFTs,
     * then calls the cryptoTransfer precompile.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param _collectionAddress The address of the NFT collection.
     * @param _serials An array of serial numbers for the NFTs to transfer (max length MAX_NFTS_PER_TX).
     * @param _contractAddress The address of the contract (e.g., staking contract).
     * @param _eoaAddress The address of the EOA involved in the transfer.
     */
    function _moveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _contractAddress,
        address _eoaAddress
    ) internal {
        if (_serials.length > 8) revert BadArguments();
        address receiverAddress;
        address senderAddress;
        bool isHbarApproval;

        if (_direction == TransferDirection.STAKING) {
            receiverAddress = _contractAddress;
            senderAddress = _eoaAddress;
        } else {
            receiverAddress = _eoaAddress;
            senderAddress = _contractAddress;
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

            _nftTransfer.serialNumber = int256(_serials[i]).toInt64();
            _transfers[i].nftTransfers[0] = _nftTransfer;
        }

        int256 response = cryptoTransfer(_hbarTransfer, _transfers);

        if (response != SUCCESS) {
            // could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
            revert NFTTransferFailed(_direction);
        }
    }

    /**
     * @dev Associates the calling contract with a token on the Hedera network.
     * @param tokenId The address of the token to associate with.
     * @return True if the association was successful or if the token was already associated, false otherwise.
     */
    function _tokenAssociate(address tokenId) internal returns (bool) {
        int256 response = associateToken(address(this), tokenId);

        if (
            !(response == SUCCESS ||
                response == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            return false;
        }
        return true;
    }

    /**
     * @dev Transfers multiple NFTs in bulk, either for staking or withdrawal.
     * If staking, it first associates the contract with the token if not already associated.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param nftTokens An array of NFT collection addresses.
     * @param nftSerials A 2D array where each inner array contains the serial numbers of NFTs from the corresponding collection in nftTokens.
     * @param _eoaAddress The address of the externally owned account (EOA) involved in the transfer.
     */
    function _bulkTransfer(
        TransferDirection _direction,
        address[] memory nftTokens,
        uint256[][] memory nftSerials,
        address _eoaAddress
    ) internal {
        if (address(this).balance < 20) {
            lazyGasStation.refillHbar(100);
        }

        uint256 _length = nftTokens.length;
        for (uint256 i = 0; i < _length; ) {
            if (_direction == TransferDirection.STAKING) {
                if (IERC721(nftTokens[i]).balanceOf(address(this)) == 0) {
                    bool success = _tokenAssociate(nftTokens[i]);
                    if (!success) {
                        revert AssociationFailed(nftTokens[i]);
                    }
                }
            }

            // now stake the NFTs for the prize
            _batchMoveNFTs(
                _direction,
                nftTokens[i],
                nftSerials[i],
                _eoaAddress
            );

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Internal function to move NFTs in batches, respecting MAX_NFTS_PER_TX.
     * It iterates through the provided serials and calls `moveNFTs` for each batch.
     * @param _direction The direction of the transfer (STAKING or WITHDRAWAL).
     * @param _collectionAddress The address of the NFT collection.
     * @param _serials An array of serial numbers for all NFTs to transfer.
     * @param _eoaAddress The address of the EOA involved in the transfer.
     */
    function _batchMoveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _eoaAddress
    ) internal {
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
            _moveNFTs(
                _direction,
                _collectionAddress,
                serials,
                address(this),
                _eoaAddress
            );
        }
    }

    /**
     * @dev Mints new NFTs and transfers them to a receiver.
     * @param token The address of the NFT collection.
     * @param sender The address of the sender (contract treasury).
     * @param receiver The address of the receiver.
     * @param metadata An array of metadata for the new NFTs.
     * @return responseCode The response code from the HTS precompile.
     * @return serialNumbers An array of serial numbers for the minted NFTs.
     */
    function _mintAndTransferNFT(
        address token,
        address sender,
        address receiver,
        bytes[] memory metadata
    ) internal returns (int32 responseCode, int64[] memory serialNumbers) {
        // 1. Mint NFT to contract (treasury)
        (responseCode, , serialNumbers) = mintToken(token, 0, metadata);

        if (responseCode != SUCCESS || serialNumbers.length == 0) {
            return (responseCode, serialNumbers);
        }

        // 2. Transfer the minted NFTs
        // create an array of sender and receiver addresses of length serialNumbers
        address[] memory senderAddresses = new address[](serialNumbers.length);
        address[] memory receiverAddresses = new address[](
            serialNumbers.length
        );

        for (uint256 i = 0; i < serialNumbers.length; i++) {
            senderAddresses[i] = sender;
            receiverAddresses[i] = receiver;
        }
        responseCode = transferNFTs(
            token,
            senderAddresses,
            receiverAddresses,
            serialNumbers
        );
    }
}
