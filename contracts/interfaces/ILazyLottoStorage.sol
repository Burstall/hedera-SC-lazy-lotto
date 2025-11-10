// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/*
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 * ⚡                                                             ⚡
 * ⚡                        LAZY SUPERHEROES                     ⚡
 * ⚡                      The OG Hedera Project                  ⚡
 * ⚡                                                             ⚡
 * ⚡                        %%%%#####%%@@@@                      ⚡
 * ⚡                   @%%%@%###%%%%###%%%%%@@                   ⚡
 * ⚡                %%%%%%@@@@@@@@@@@@@@@@%##%%@@                ⚡
 * ⚡              @%%@#@@@@@@@@@@@@@@@@@@@@@@@@*%%@@             ⚡
 * ⚡            @%%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*%@@           ⚡
 * ⚡           %%%#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%#%@@         ⚡
 * ⚡          %%%@@@@@@@@@@@@@@#-:--==+#@@@@@@@@@@@@@*%@@        ⚡
 * ⚡         %@#@@@@@@@@@@@@@@*-------::%@@@@@@@@%%%%%*%@@       ⚡
 * ⚡        %%#@@@@@@@@@@@@@@@=-------:#@@@@@@@@@%%%%%%*%@@      ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@#-------:+@@@@@@@@@@%%%%%%%#%@@     ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@=------:=@@@@@@@@@@@%%%%%%%%#@@     ⚡
 * ⚡      #%#@@@%%%%%%%@@@@@%------:-@@@@@@@@@@@@@%%%%%%%#%@@    ⚡
 * ⚡      %%#@@@%%%%%%%%@@@@=------------:::@@@@@@@@%%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@%:------------::%@@@@@@@@@%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@=:::---------:-@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      #%#@@@%%%%%%%@@@@*:::::::----:-@@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      %%%%@@@@%%%%%@@@@@@@@@@-:---:=@@@@@@@@@@@@@@@@@%@@@    ⚡
 * ⚡       %%#@@@@%%%%@@@@@@@@@@@::--:*@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡       %#%#@@@%@%%%@@@@@@@@@#::::#@@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡        %%%%@@@%%%%%%@@@@@@@*:::%@@@@@@@@@@@@@@@@@@%@@@      ⚡
 * ⚡         %%#%@@%%%%%%%@@@@@@=.-%@@@@@@@@@@@@@@@@@@%@@@       ⚡
 * ⚡          %##*@%%%%%%%%%@@@@=+@@@@@@@@@@@@@@@@@@%%@@@        ⚡
 * ⚡           %##*%%%%%%%%%%@@@@@@@@@@@@@@@@@@@@@@%@@@@         ⚡
 * ⚡             %##+#%%%%%%%%@@@@@@@@@@@@@@@@@@@%@@@@           ⚡
 * ⚡               %##*=%%%%%%%@@@@@@@@@@@@@@@#@@@@@             ⚡
 * ⚡                 %##%#**#@@@@@@@@@@@@%%%@@@@@@               ⚡
 * ⚡                    %%%%@@%@@@%%@@@@@@@@@@@                  ⚡
 * ⚡                         %%%%%%%%%%%@@                       ⚡
 * ⚡                                                             ⚡
 * ⚡                 Development Team Focused on                 ⚡
 * ⚡                   Decentralized Solutions                   ⚡
 * ⚡                                                             ⚡
 * ⚡         Visit: http://lazysuperheroes.com/                  ⚡
 * ⚡            or: https://dapp.lazysuperheroes.com/            ⚡
 * ⚡                   to get your LAZY on!                      ⚡
 * ⚡                                                             ⚡
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 */

import {IHederaTokenServiceLite} from "./IHederaTokenServiceLite.sol";

/// @title ILazyLottoStorage
/// @notice Interface for LazyLottoStorage contract - handles all HTS operations and token custody
interface ILazyLottoStorage {
    // --- STRUCTS ---
    struct NFTFeeObject {
        uint32 numerator;
        uint32 denominator;
        uint32 fallbackfee;
        address account;
    }

    // --- ADMIN MANAGEMENT ---
    function addAdmin(address a) external;
    function removeAdmin(address a) external;
    function setContractUser(address contractUser) external;
    function isAdmin(address a) external view returns (bool);
    function getContractUser() external view returns (address);

    // --- TOKEN ASSOCIATION ---
    function associateTokenToStorage(address token) external;

    // --- HBAR OPERATIONS ---
    function withdrawHbar(address payable recipient, uint256 amount) external;
    function withdrawFungible(
        address token,
        address recipient,
        uint256 amount
    ) external;
    function transferHbar(address payable to, uint256 amount) external;
    function depositHbar() external payable;

    // --- FUNGIBLE TOKEN OPERATIONS ---
    function pullFungibleFrom(
        address token,
        address from,
        uint256 amount
    ) external;
    function ensureFungibleBalance(
        address token,
        address from,
        uint256 amountToPull
    ) external;
    function transferFungible(
        address token,
        address to,
        uint256 amount
    ) external;
    function executeCryptoTransfer(
        IHederaTokenServiceLite.TransferList memory transferList,
        IHederaTokenServiceLite.TokenTransferList[] memory tokenTransfers
    ) external;

    // --- TOKEN CREATION ---
    function createToken(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        NFTFeeObject[] memory _royalties
    ) external payable returns (address tokenAddress);

    // --- NFT OPERATIONS ---
    function mintAndTransferNFT(
        address token,
        address receiver,
        bytes[] memory metadata
    ) external returns (int64[] memory serialNumbers);

    function transferNFTCollection(
        address token,
        address from,
        address to,
        int64[] memory serialNumbers
    ) external;

    function wipeNFT(
        address token,
        address account,
        int64[] memory serialNumbers
    ) external;

    // --- BULK NFT TRANSFER OPERATIONS ---
    function moveNFTsWithHbar(
        bool isStaking,
        address collectionAddress,
        uint256[] memory serials,
        address eoaAddress
    ) external;

    function bulkTransferNFTs(
        bool isStaking,
        address[] memory nftTokens,
        uint256[][] memory nftSerials,
        address eoaAddress
    ) external;
}
