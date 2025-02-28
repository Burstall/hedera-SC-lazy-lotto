// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

interface ILazyNFTStaking {
	event StakedNFT(address _user, address collection, uint256[] serials, uint256[] rewards);

    event UnstakedNFT(address _user, address collection, uint256[] serials, uint256[] rewards);

    event ClaimedRewards(
        address _user,
        uint256 _rewardAmount,
        uint256 _burnPercentage
    );

	event StakingMessage(
		string _functionName,
		address _sender,
		uint256 _amount,
		string _message
	);

    struct Stake {
        address collection;
        uint256[] serials;
        uint256[] rewards;
    }

    struct Rewards {
        uint256 lastRewardSnapshot;
        uint256 snapshotTimestamp;
    }

    struct RewardProof {
        uint256 boostRate;
        uint256 validityTimestamp;
        bytes signature;
    }

    function stake(
        Stake[] memory _stakes,
		RewardProof memory _rewardProof
	) external;

    function unstake(
        Stake[] memory _stakes,
		RewardProof memory _rewardProof
	) external;

    function claimRewards() external returns (uint256 rewardPaid);

	function getStakingUsers() external view returns (address[] memory);

	function getStakableCollections() external view returns (address[] memory);

	function getStakedNFTs(
		address _user
	) external view returns (address[] memory collections, uint256[][] memory serials);

	function getStakedSerials(
		address _collection
	) external view returns (uint256[] memory serials);

	function getNumStakedNFTs(
		address _collection
	) external view returns (uint256);
}
