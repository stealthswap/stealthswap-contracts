// SPDX-License-Identifier: GPL-3.0
/**
 * ProtocolToken.sol
 * Implements ERC20 compatible ProtocolToken.
 */

pragma solidity ^0.6.2;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20.sol";

contract ProtocolToken is ERC20UpgradeSafe {
  function mint(address account, uint256 amount) public {
    _mint(account, amount);
  }
}
