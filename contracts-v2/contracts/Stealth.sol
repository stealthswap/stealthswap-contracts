// SPDX-License-Identifier: GPL-3.0
/**
 * Stealth.sol
 * Implements the StealthSwap core functionnality.
 * GSN Placeholders are used to fetch msg.sender until
 * Future integration where withdrawals will be processed trough
 * GSN.
 */

pragma solidity ^0.6.2;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@opengsn/gsn/contracts/BaseRelayRecipient.sol";

/// @title StealthSwap Oracle Contract for Broadcasting Payment Notes
contract Stealth is BaseRelayRecipient, OwnableUpgradeSafe {
  using SafeMath for uint256;

   /// @dev protocol token (OWL) definition
  IERC20 private protocolToken;

  uint256 public protocolFee;
  uint256 public etherProtocolFee;
  uint256 public abyss;
  address public feeManager;
  address payable public feeTaker;
  bool private initialized;

  constructor(
    IERC20 _protocolToken,
    uint256 _protocolFee,
    uint256 _etherProtocolFee,
    address _feeManager,
    address payable _feeTaker
  ) public {
    __Ownable_init();
    protocolToken = _protocolToken;
    protocolFee = _protocolFee;
    etherProtocolFee = _etherProtocolFee;
    feeManager = _feeManager;
    feeTaker = _feeTaker;
    abyss = 1 wei;
  }

  mapping(address => bool) usedAddrs;
  mapping(address => Payment) processedPayments;

  /// Ownable Functions : Ownership is set at owner, then changed
  /// to Governing Contract.
  function setProtocolFee(uint256 _newFee) public onlyOwner {
    protocolFee = _newFee;
  }

  function setEtherProtocolFee(uint256 _newEtherFee) public onlyOwner {
    etherProtocolFee = _newEtherFee;
  }

  function setFeeManager(address _newFeeManager) public onlyOwner {
    feeManager = _newFeeManager;
  }

  function setFeeTaker(address payable _newFeeTaker) public onlyOwner {
    feeTaker = _newFeeTaker;
  }

  /// Events are singular blobs broadcasted by the oracle contract.

  /// @notice PaymentNote represent a new payment made trough StealthSwap
  /// @param receiver receiver's stealth address
  /// @param token address of transferred token
  /// @param amount amount transferred
  /// @param iv initialization vector
  /// @param xCoord ephemeral public key (X-coord)
  /// @param yCoord ephemeral public key (Y-coord)
  /// @param ctBuf0 cipher text first chuncked to 32 bytes
  /// @param ctBuf1 cipher text second chunck
  /// @param ctBuf2 cipher text last chunck
  /// @param mac message authentification tag (HMAC-SHA256)
  event PaymentNote(
    address indexed receiver,
    address indexed token,
    uint256 indexed amount,
    bytes16 iv,
    bytes32 xCoord,
    bytes32 yCoord,
    bytes32 ctBuf0,
    bytes32 ctBuf1,
    bytes32 ctBuf2,
    bytes32 mac
  );

  /// @notice Withdrawal is emitted from the local payment storage
  /// @param receiver withdrawal address
  /// @param interim hodler approving withdrawls
  /// @param token address
  /// @param amount being withdrawn (always full amounts prevent partials)
  event Withdrawal(
    address indexed receiver,
    address indexed interim,
    address indexed token,
    uint256 amount
  );

  /// @notice a payment is represented by its token address and amount
  struct Payment {
    address token;
    uint256 amount;
  }

  /// @dev Checksummed address similar to 0x0000000000000000000000000000000000000000
  address constant ETHER_TOKEN = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

  /// Sending Functions

  /// @notice send ether to stealth address
  /// @param _receiver receiver's address
  /// @param _iv initialization vector
  /// @param _xCoord ephemeral public key (X-coord)
  /// @param _yCoord ephemeral public key (Y-coord)
  /// @param _enc0 cipher text
  /// @param _enc1 cipher text
  /// @param _enc2 cipher text
  /// @param _mac message authentification tag
  function sendEther(
    address payable _receiver,
    bytes16 _iv,
    bytes32 _xCoord,
    bytes32 _yCoord,
    bytes32 _enc0,
    bytes32 _enc1,
    bytes32 _enc2,
    bytes32 _mac
  ) public payable unusedAddr(_receiver) {
    /// enforce against dust attacks for ether transactions
    require(msg.value >= protocolFee, "StealthSwap: Must have value higher than the protocol fee");
    uint256 feeAllowance = IERC20(protocolToken).allowance(_msgSender(), address(this));
    /// insure allowance is sufficient to pay for protocol fee
    require(feeAllowance >= protocolFee, "StealthSwap: You must provide allowance to pay the protocol fee");
    uint256 amount = msg.value;
    /// enforce protocol fee payment
    IERC20(protocolToken).transferFrom(_msgSender(), address(this), protocolFee);
    /// emit new Payment Note
    emit PaymentNote(_receiver, ETHER_TOKEN, amount, _iv, _xCoord, _yCoord, _enc0, _enc1, _enc2, _mac);
    // Tag address as used to prevent stealth address re-use
    usedAddrs[_receiver] = true;
    // Transfer Ether to receiving stealth address
    _receiver.transfer(amount);
  }

  /// @notice send erc20 token to stealth address
  /// @param _receiver receiver's address
  /// @param _tokenAddr token transferred address
  /// @param _amount amount transferred
  /// @param _iv initialization vector
  /// @param _xCoord ephemeral public key (X-coord)
  /// @param _yCoord ephemeral public key (Y-coord)
  /// @param _enc0 cipher text
  /// @param _enc1 cipher text
  /// @param _enc2 cipher text
  /// @param _mac message authentification tag
  function sendERC20(
    address payable _receiver,
    address _tokenAddr,
    uint256 _amount,
    bytes16 _iv,
    bytes32 _xCoord,
    bytes32 _yCoord,
    bytes32 _enc0,
    bytes32 _enc1,
    bytes32 _enc2,
    bytes32 _mac
  ) public payable unusedAddr(_receiver) {
    /// otherwise we will be accepting 0 ether transaction
    /// this prevents the case where attackers mint and send worthless tokens
    require(msg.value >= etherProtocolFee, "StealthSwap: Must have value greater than or equal to ether protocol fee");
    uint256 feeAllowance = IERC20(protocolToken).allowance(_msgSender(), address(this));
    /// insure allowance is sufficient to pay for protocol fee
    require(feeAllowance >= protocolFee, "StealthSwap: You must provide allowance to pay the protocol fee");
    uint256 tokenAllowance = IERC20(_tokenAddr).allowance(_msgSender(), address(this));
    /// insure allowance is higher than protocolFee
    require(tokenAllowance >= _amount, "StealthSwap: You must provide allowance to pay the protocol fee");
    /// enforce protocol fee payment
    IERC20(protocolToken).transferFrom(_msgSender(), address(this), protocolFee);
    /// store token payment in our balance sheet
    processedPayments[_receiver] = Payment({token: _tokenAddr, amount: _amount});
    /// emit payment note
    emit PaymentNote(_receiver, _tokenAddr, _amount, _iv, _xCoord, _yCoord, _enc0, _enc1, _enc2, _mac);
    /// transfer tokens to contract control
    IERC20(_tokenAddr).transferFrom(_msgSender(), _receiver, _amount);
    /// tag stealth address as used to prevent re-use
    usedAddrs[_receiver] = true;
    /// transfer Ether protocol fee to receiver's address to afford withdrawals
    _receiver.transfer(etherProtocolFee);
  }

  /// Withdrawal Processing

  function withdraw(address _receiver) public {
    uint256 amount = processedPayments[_msgSender()].amount;
    address tokenAddr = processedPayments[_msgSender()].token;
    // make sure _msgSender() has proper allocation
    require(amount > 0, "StealthSwap: Unavailable tokens for withdrawal");
    /// remove token payment from our balance sheet
    delete processedPayments[_msgSender()];
    emit Withdrawal(_msgSender(), _receiver, tokenAddr, amount);
    /// send token to receiver
    IERC20(tokenAddr).transferFrom(_msgSender(), _receiver, amount);
  }

  /// @notice collect paid fees for redistribituion
  /// @dev this should be called by the staking contract
  function collectPaidFees() public onlyManager {
    feeTaker.transfer(address(this).balance);
    uint256 totalFees = IERC20(protocolToken).balanceOf(address(this));
    IERC20(protocolToken).approve(feeTaker,totalFees);
    IERC20(protocolToken).transfer(feeTaker, totalFees);
  }

  /// Modifiers

  function _msgSender()
    internal
    override(ContextUpgradeSafe, BaseRelayRecipient)
    view
    returns (address payable)
  {
    return BaseRelayRecipient._msgSender();
  }

  modifier onlyManager() {
    require(_msgSender() == feeManager, "StealthSwap: Wrong Fee Manager");
    _;
  }

  modifier unusedAddr(address _addr) {
    require(!usedAddrs[_addr], "StealthSwap: stealth address cannot be reused");
    _;
  }
}
