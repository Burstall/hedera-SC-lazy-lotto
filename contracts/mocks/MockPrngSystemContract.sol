// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

import {IPrngSystemContract} from "../interfaces/IPrngSystemContract.sol";

contract MockPrngSystemContract is IPrngSystemContract {
    bytes32 private staticSeed;
    uint256 private staticNumber;
    uint256[] private staticArray;

    constructor(bytes32 _seed, uint256 _number) {
        staticSeed = _seed;
        staticNumber = _number;
    }

    // Setters for test control
    function setStaticSeed(bytes32 _seed) external {
        staticSeed = _seed;
    }

    function setStaticNumber(uint256 _number) external {
        staticNumber = _number;
    }

    function setStaticArray(uint256[] calldata _array) external {
        staticArray = _array;
    }

    function getPseudorandomSeed() external view override returns (bytes32) {
        return staticSeed;
    }

    function getPseudorandomNumber(
        uint256 lo,
        uint256 hi,
        uint256 /*userSeed*/
    ) external view override returns (uint256) {
        require(lo <= hi, "lo > hi");
        if (lo == hi) return lo;
        // Always return lo for deterministic win, or hi-1 for deterministic loss
        return lo + (staticNumber % (hi - lo));
    }

    function generateRandomNumber() external view override returns (uint256) {
        return staticNumber;
    }

    function getPseudorandomNumberArray(
        uint256 lo,
        uint256 hi,
        uint256 /*userSeed*/,
        uint256 arrayLength
    ) external view override returns (uint256[] memory) {
        require(lo < hi, "lo >= hi");
        require(arrayLength > 0, "arrayLength == 0");
        uint256[] memory arr = new uint256[](arrayLength);
        for (uint256 i = 0; i < arrayLength; i++) {
            if (i < staticArray.length) {
                arr[i] = lo + (staticArray[i] % (hi - lo));
            } else {
                arr[i] = lo + (staticNumber % (hi - lo));
            }
        }
        return arr;
    }
}
