pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/BasePaymaster.sol";
import "@opengsn/gsn/contracts/interfaces/GsnTypes.sol";

contract StealthPaymaster is BasePaymaster {
  address public stealthAddr;

  constructor(address _stealthAddr) public {
    stealthAddr = _stealthAddr;
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
      (signature, approvalData, maxPossibleGas); // to silence compiler warnings

      require(relayRequest.request.to == stealthAddr, "StealthPaymaster: Not Target");
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
    (context, success, gasUseWithoutPost, relayData); // to silence compiler warnings
  }
}
