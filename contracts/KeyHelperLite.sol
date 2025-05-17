// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;
pragma experimental ABIEncoderV2;

import {IHederaTokenServiceLite} from "./interfaces/IHederaTokenServiceLite.sol";

abstract contract KeyHelperLite {
    enum KeyType {
        ADMIN, // 0
        KYC, // 1
        FREEZE, // 2
        WIPE, // 3
        SUPPLY, // 4
        FEE, // 5
        PAUSE // 6
    }

    enum KeyValueType {
        INHERIT_ACCOUNT_KEY,
        CONTRACT_ID,
        ED25519, // Not used by LazyLotto's current key creation path
        SECP256K1, // Not used by LazyLotto's current key creation path
        DELEGETABLE_CONTRACT_ID // Not used by LazyLotto's current key creation path
    }

    // Removed constructor and keyTypes mapping as they are not needed for the pure functions used by LazyLotto.

    function getSingleKey(
        KeyType firstType,
        KeyType secondType,
        KeyValueType keyValueType,
        address keyAddress
    ) internal pure returns (IHederaTokenServiceLite.TokenKey memory tokenKey) {
        tokenKey = IHederaTokenServiceLite.TokenKey(
            getDuplexKeyType(firstType, secondType),
            getKeyValueType(keyValueType, keyAddress)
        );
    }

    function getDuplexKeyType(
        KeyType firstType,
        KeyType secondType
    ) internal pure returns (uint256 keyTypeCombination) {
        keyTypeCombination = 0; // Initialize
        // Uses the enum's underlying integer value (index) for bit position
        keyTypeCombination = setBit(keyTypeCombination, uint8(firstType));
        keyTypeCombination = setBit(keyTypeCombination, uint8(secondType));
        return keyTypeCombination;
    }

    function getKeyValueType(
        KeyValueType keyValueType,
        address keyAddress
    ) internal pure returns (IHederaTokenServiceLite.KeyValue memory keyValue) {
        if (keyValueType == KeyValueType.CONTRACT_ID) {
            keyValue.contractId = keyAddress;
        } else if (keyValueType == KeyValueType.DELEGETABLE_CONTRACT_ID) {
            // This case is not used by LazyLotto's current key setup but kept for completeness of the enum.
            keyValue.delegatableContractId = keyAddress;
        } else if (keyValueType == KeyValueType.INHERIT_ACCOUNT_KEY) {
            // This case is not used by LazyLotto's current key setup.
            keyValue.inheritAccountKey = true;
        }
        // ED25519 and SECP256K1 variants (usually taking bytes) are omitted as not used by LazyLotto's address-based key.
        return keyValue;
    }

    function setBit(uint256 self, uint8 index) internal pure returns (uint256) {
        return self | (uint256(1) << index);
    }

    function createAutoRenewExpiry(
        address autoRenewAccount,
        int32 autoRenewPeriod
    ) internal pure returns (IHederaTokenServiceLite.Expiry memory expiry) {
        expiry.autoRenewAccount = autoRenewAccount;
        expiry.autoRenewPeriod = autoRenewPeriod;
    }
}
