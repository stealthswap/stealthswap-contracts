// SPDX-License-Identifier: GPL-3.0
/**
 * TestToken.sol
 * Implements ERC20 compatible TestToken.
 */
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract TestToken is ERC20 {

  constructor (string memory name, string memory symbol)
  ERC20(name, symbol)
  public {}

  function mint(address account, uint256 amount) public {
    _mint(account, amount);
  }
}
