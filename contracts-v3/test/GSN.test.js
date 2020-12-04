const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { balance, ether, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const Stealth = contract.fromArtifact('Stealth');
const StealthPaymaster = contract.fromArtifact('StealthPaymaster');
const TestToken = contract.fromArtifact('TestToken');
const { keccak256 } = require("@ethersproject/keccak256");

const { RelayProvider } = require('@opengsn/gsn/dist/src/relayclient/RelayProvider');
const { GsnTestEnvironment } = require('@opengsn/gsn/dist/GsnTestEnvironment');
const { configureGSN } = require('@opengsn/gsn/dist/src/relayclient/GSNConfigurator');
// ProtocolToken is used to pay transfer fees (protocolFee)
const ProtocolToken = contract.fromArtifact('ProtocolToken');

// Example of an unpacked payment note
const paymentNote = {
  ephemeralPublicKey: '0x043a258b6e77773a2429dba2fc434544828c73e1251791abcb09a5a10f0998fe0f0a7857d76d5cba188a709013b9f352b3889b4a15bbd2fd41a35a323b04fba030',
  ciphertext: '0x8e99b5e16ef3c173144927260fca90f2a34c9c8997b102820baf1d1c9ef682f1',
};
// Packed Note as a two array of 32 bytes each

const packedNote = [`0x${paymentNote.ephemeralPublicKey.slice(4, 4 + 64)}`, `0x${paymentNote.ephemeralPublicKey.slice(4+64, 4+2*64)}`,paymentNote.ciphertext];




const { toWei } = web3.utils;
const origProvider = web3.currentProvider;

const tokenAmount = toWei('100', 'ether');

describe('Stealth GSN', () => {
  const [
    owner,
    protocolFeeCollector,
    protocolFeeReceiver,
    payer,
    receiver,
    interim,
    other,
  ] = accounts;

  const deployedToll = toWei('0.001', 'ether');
  const ethFee = ether('0.025');
  before(async () => {
    // Deploy the Stealth contracts
    this.protocolToken = await ProtocolToken.new('ProtocolToken','OWL');
    this.stealth = await Stealth.new(this.protocolToken.address,deployedToll, protocolFeeCollector, protocolFeeReceiver, other, { from: owner });
    this.paymaster = await StealthPaymaster.new(this.stealth.address, { from: owner });

    // Mint tokens needed for test
    this.token = await TestToken.new('TestToken', 'TT');
    await this.token.mint(payer, tokenAmount);

    await this.protocolToken.mint(payer, tokenAmount);

    // Start the GSN Test environment— this includes deployment of a relay hub, a forwarder, and
    // a stake manager, as well as starting a relay server. It also deploys a naive Paymaster, but we
    // will use our own
    const gsnInstance = await GsnTestEnvironment.startGsn(Stealth.web3.currentProvider.wrappedProvider.host);

    // Save the forwader, as we'll need it when sending contract calls via our RelayProvider
    this.forwarder = gsnInstance.deploymentResult.forwarderAddress;

    // Configure GSN with the params from the test deployment + our paymaster
    const gsnConfigParams = {
      gasPriceFactorPercent: 70,
      // methodSuffix: '_v4',
      // jsonStringifyRequest: true,
      // chainId: '*',
      relayLookupWindowBlocks: 1e5,
      preferredRelays: [gsnInstance.relayUrl],
      relayHubAddress: gsnInstance.deploymentResult.relayHubAddress,
      stakeManagerAddress: gsnInstance.deploymentResult.stakeManagerAddress,
      paymasterAddress: this.paymaster.address,
      verbose: false,
    };
    const gsnConfig = configureGSN(gsnConfigParams);

    // Create and save a RelayProvider. This web3 provder wraps the original web3
    // provider given by the OZ test environment, but also accounts for interaction with
    // contracts via GSN, and thus needs to know our gsn config as well
    this.gsnProvider = new RelayProvider(origProvider, gsnConfig);

    // Configure our paymaster to use the global RelayHub instance
    await this.paymaster.setRelayHub(gsnInstance.deploymentResult.relayHubAddress, { from: owner });

    // Set our trusted forwarder in the stealth contract, which is part of the
    // BaseRelayRecipient it inherits from.
    await this.stealth.setForwarder(this.forwarder, { from: owner });

    // Fund our Paymaster to pay for gas. Actually, this funds the RelayHub with ETH our Paymaster
    // has the right to spend, since payments to the Paymaster are forwarded
    await web3.eth.sendTransaction({
      from: owner,
      to: this.paymaster.address,
      value: toWei('1', 'ether'),
    });
  });

  // Drain the receiver's balance to ensure later that it is able to withdraw the
  // tokens sent to it without having to pay anything for gas.
  it('should drain the receiver\'s balance', async () => {
    const receiverBalance = await web3.eth.getBalance(receiver);
    await web3.eth.sendTransaction({
      from: receiver,
      to: owner,
      value: receiverBalance,
      gasPrice: 0,
    });

    const newBalance = await web3.eth.getBalance(receiver);

    expect(newBalance.toString()).to.equal('0');
  });

  // Sending the token is done without GSN
  it('should permit someone to pay with a token', async () => {
    const protocolFee = await this.stealth.protocolFee();
    await this.token.approve(this.stealth.address, tokenAmount, { from: payer });
    await this.protocolToken.approve(this.stealth.address, tokenAmount, { from: payer});
    const receipt = await this.stealth.sendERC20(
      receiver,
      this.token.address,
      protocolFee,
      ...packedNote,
      { from: payer, value: ethFee },
    );

    const contractBalance = await this.token.balanceOf(this.stealth.address);

    expect(contractBalance.toString()).to.equal(protocolFee.toString());
    const receiverHash = keccak256(receiver)

    expectEvent(receipt, 'PaymentNote', {
      receiver:receiverHash,
      amount: protocolFee,
      token: this.token.address,
      xCoord: packedNote[0],
      yCoord: packedNote[1],
      note: packedNote[2],
    });
  });

  it('should not permit a non-receiver to withdraw tokens with GSN', async () => {
    // This line updates the web3 Provider used by our this.stealth instance for all future calls.
    // Needing to do update it this way is an idiosyncracy of truffle-contract. The important
    // thing is that calls be made using the RelayProvider instantiated previously.
    // By using the RelayProvider instances, tx's sent through this.stealth will now go through GSN.
    Stealth.web3.setProvider(this.gsnProvider);

    await expectRevert(
      this.stealth.withdraw(interim, {
        from: other,
        forwarder: this.forwarder,
      }),
      'StealthSwap: Unavailable tokens for withdrawal',
    );
  });

  it('should permit receiver to withdraw their tokens with GSN', async () => {
    // Technically this is only needed once in the first test, but we repeat it in each test
    // to avoid failures if test ordering is chagned.
    Stealth.web3.setProvider(this.gsnProvider);
     const protocolFee = await this.stealth.protocolFee();

    const receipt = await this.stealth.withdraw(interim, {
      from: receiver,
      // When making a contract call with the RelayProvider, an additional options param is
      // needed: the forwarder that will be used.
      forwarder: this.forwarder,
    });

    const interimBalance = await this.token.balanceOf(interim);

    expect(interimBalance.toString()).to.equal(protocolFee.toString());

    expectEvent(receipt, 'Withdrawal', {
      receiver,
      interim,
      amount: protocolFee,
      token: this.token.address,
    });
  });

  it('should not permit a receiver to withdraw tokens twice with GSN', async () => {
    Stealth.web3.setProvider(this.gsnProvider);

    await expectRevert(
      this.stealth.withdraw(interim, {
        from: receiver,
        forwarder: this.forwarder,
      }),
      'StealthSwap: Unavailable tokens for withdrawal',
    );
  });
});
