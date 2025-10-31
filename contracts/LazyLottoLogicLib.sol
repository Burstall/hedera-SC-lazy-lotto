// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";
import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";

/// @title LazyLottoLogicLib
/// @author stowerling.eth / stowerling.hbar
/// @notice Library containing business logic for LazyLotto contract
/// @dev Uses PUBLIC functions to avoid inlining - code stays in library and gets linked
library LazyLottoLogicLib {}
