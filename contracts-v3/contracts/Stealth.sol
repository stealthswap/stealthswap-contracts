// SPDX-License-Identifier: GPL-3.0
/**
 * Stealth.sol
 * Implements the StealthSwap core functionnality.
 * GSN Placeholders are used to fetch msg.sender until
 * Future integration where withdrawals will be processed trough
 * GSN.
 */

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@opengsn/gsn/contracts/BaseRelayRecipient.sol";
import "@opengsn/gsn/contracts/interfaces/IKnowForwarderAddress.sol";
import "@opengsn/gsn/contracts/interfaces/IRelayHub.sol";

/// @title StealthSwap Oracle Contract for Broadcasting Payment Notes
contract Stealth is Ownable, BaseRelayRecipient, IKnowForwarderAddress {
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
    address payable _feeTaker,
    address _gsnForwarder
  ) public {
    protocolToken = _protocolToken;
    protocolFee = _protocolFee;
    etherProtocolFee = _etherProtocolFee;
    feeManager = _feeManager;
    feeTaker = _feeTaker;
    abyss = 1 wei;
    trustedForwarder = _gsnForwarder;

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

  function versionRecipient() external override view returns (string memory) {
    return "1.2.0";
  }
  /// Events are singular blobs broadcasted by the oracle contract.

  /// @notice PaymentNote represent a new payment made trough StealthSwap
  /// @param receiver receiver's stealth address
  /// @param token address of transferred token
  /// @param amount amount transferred
  /// @param publicKey used to encrypt the paymentnote
  /// @param note encrypted scalar used to unlock funds on receiving end
  event PaymentNote(
    address indexed receiver,
    address indexed token,
    uint256 indexed amount,
    bytes32 publicKey,
    bytes32 note
  );

  /// @notice Withdrawal is emitted from the local payment storage
  /// @param receiver withdrawal address
  /// @param interim address holding funds
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
  /// @param _publicKey public key used to encrypt the note
  /// @param _note encrypted scalar
  function sendEther(
    address payable _receiver,
    bytes32 _publicKey,
    bytes32 _note
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
    emit PaymentNote(_receiver, ETHER_TOKEN, amount, _publicKey, _note);
    // Tag address as used to prevent stealth address re-use
    usedAddrs[_receiver] = true;
    // Transfer Ether to receiving stealth address
    _receiver.transfer(amount);
  }

  /// @notice send erc20 token to stealth address
  /// @param _receiver receiver's address
  /// @param _tokenAddr token transferred address
  /// @param _amount amount transferred
  /// @param _publicKey public key used to encrypt the note
  /// @param _note encrypted payment note
  function sendERC20(
    address payable _receiver,
    address _tokenAddr,
    uint256 _amount,
    bytes32 _publicKey,
    bytes32 _note
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
    /// hashReceiver = getSHA3Hash(_receiver)
    /// processedPayments[hashReceiver] = ....
    processedPayments[_receiver] = Payment({token: _tokenAddr, amount: _amount});
    /// emit payment note
    emit PaymentNote(_receiver, _tokenAddr, _amount, _publicKey, _note);
    /// transfer tokens to contract control
    /// transferFrom(_msgSender(),address(this),_amount)
    IERC20(_tokenAddr).transferFrom(_msgSender(), address(this), _amount);
    /// tag stealth address as used to prevent re-use
    /// hashReceiver = getSHA3Hash(_receiver)
    usedAddrs[_receiver] = true;
    /// transfer Ether protocol fee to receiver's address to afford withdrawals
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
    SafeERC20.safeTransfer(IERC20(tokenAddr), _receiver, amount);
  }

  /// @notice collect paid fees for redistribituion
  /// @dev this should be called by the staking contract
  function collectPaidFees() public onlyManager {
    feeTaker.transfer(address(this).balance);
    uint256 totalFees = IERC20(protocolToken).balanceOf(address(this));
    IERC20(protocolToken).approve(feeTaker,totalFees);
    IERC20(protocolToken).transfer(feeTaker, totalFees);
  }
  /// GSN Integration
  function getTrustedForwarder() external override view returns(address) {
    return trustedForwarder;
  }
  function setForwarder(address _forwarder) public onlyOwner {
    trustedForwarder = _forwarder;
  }

  /// Modifiers

  function _msgSender() internal override(Context, BaseRelayRecipient) view returns (address payable)
  {
    return BaseRelayRecipient._msgSender();
  }

  function _msgData() internal view override(Context, BaseRelayRecipient) returns (bytes memory) {
      return BaseRelayRecipient._msgData();
  }
  modifier onlyManager() {
    require(_msgSender() == feeManager, "StealthSwap: Wrong Fee Manager");
    _;
  }

  modifier unusedAddr(address _addr) {
    require(!usedAddrs[_addr], "StealthSwap: stealth address cannot be reused");
    _;
  }

  /// Utility Functions
  function getSHA3Hash(bytes memory input) public returns (bytes32 hashedOutput)
  {
      hashedOutput = keccak256(input);
  }
}
