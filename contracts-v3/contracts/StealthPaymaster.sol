// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.12;
/// ABIEncoderV2 is required !
pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/BasePaymaster.sol";
import "@opengsn/gsn/contracts/interfaces/GsnTypes.sol";

contract StealthPaymaster is BasePaymaster {
  address public stealthSwapAddr;

  /// Address is the Stealth.sol contract address
  constructor(address _stealthSwapAddr) public {
    stealthSwapAddr = _stealthSwapAddr;
  }

  function versionPaymaster() external override view returns (string memory) {
    return "1.2.0";
  }

  function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    returns (bytes memory context, bool rejectOnRecipientRevert) {
      (signature, approvalData, maxPossibleGas);

      require(relayRequest.request.to == stealthSwapAddr, "StealthPaymaster: Not Target");
      return (abi.encode(0x0), true);
    }

  function postRelayedCall(
    bytes calldata context,
    bool success,
    uint256 gasUseWithoutPost,
    GsnTypes.RelayData calldata relayData
  )
  external
  override
  relayHubOnly {
    (context, success, gasUseWithoutPost, relayData);
  }
}
