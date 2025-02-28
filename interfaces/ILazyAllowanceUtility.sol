// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0 <0.9.0;

interface ILazyAllowanceUtility {
	error InvalidArguments();

	event LazyAllowanceUtilityEvent (
		address indexed sender,
		uint256 indexed value,
		string message
	);
	
	// Use to check the live allowance of a FT on Hedera
	/// @param _token address in EVM format of the token
	/// @param _owner address in EVM format of the owner of the token
	/// @param _spender address in EVM format of the spender of the token
	/// @return allowance number of tokens allowed to be spent
	function checkLiveAllowance(address _token, address _owner, address _spender) external view returns (uint256 allowance);

	// Use to check the ALL approval for an NFT on Hedera
	/// @param _token address in EVM format of the NFT token
	/// @param _owner address in EVM format of the owner of the token
	/// @param _spender address in EVM format of the spender of the token
	/// @return isApproved boolean
	function isApprovedForAllSerials(address _token, address _owner, address _spender) external view returns (bool isApproved);

	// Use to check the live allowance of multiple FTs on Hedera
	/// @param _token array of addresses in EVM format of the tokens
	/// @param _owner array of addresses in EVM format of the owners of the tokens
	/// @param _spender array of addresses in EVM format of the spenders of the tokens
	/// @return allowances array of numbers of tokens allowed to be spent
	function checkLiveAllowances(address[] memory _token, address[] memory _owner, address[] memory _spender) external view returns (uint256[] memory allowances);
	
	// Use to check the ALL approval for multiple NFTs on Hedera
	/// @param _token array of addresses in EVM format of the NFT tokens
	/// @param _owner array of addresses in EVM format of the owners of the tokens
	/// @param _spender array of addresses in EVM format of the spenders of the tokens
	/// @return approvals array of booleans
	function checkTokensApprovedForAllSerial(address[] memory _token, address[] memory _owner, address[] memory _spender) external view returns (bool[] memory approvals);

	// Use to check the approved address of an NFT on Hedera
	/// @param _token address in EVM format of the NFT token
	/// @param _serial serial number of the NFT token
	/// @return approvedAddress address in EVM format of the approved address
	function checkApprovedAddress(address _token, uint256 _serial) external returns (address approvedAddress);

	// Use to check the approved addresses of multiple NFTs on Hedera
	/// @param _token array of addresses in EVM format of the NFT tokens
	/// @param _serial array of serial numbers of the NFT tokens
	/// @return approvedAddresses array of addresses in EVM format of the approved addresses
	function checkApprovedAddresses(address[] memory _token, uint256[] memory _serial) external returns (address[] memory approvedAddresses);
}