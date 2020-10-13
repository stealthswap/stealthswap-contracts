const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, balance, ether , expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect, assert } = require('chai');
const { serializedArguments } = require('./test-data');

// TestToken is used to test transfers of ERC20
const TestToken = contract.fromArtifact('TestToken');
// ProtocolToken is used to pay transfer fees (protocolFee)
const ProtocolToken = contract.fromArtifact('ProtocolToken');
// Stealth is the oracle contract
const Stealth = contract.fromArtifact('Stealth');


describe('Stealth', () => {
  // this.timeout(0);

  const [
    owner,
    feeManager,
    feeTaker,
    payer1,
    receiver1,
    payer2,
    receiver2,
    payer3,
    receiver3,
    payer4,
    receiver4,
    payer5,
    receiver5,
    outReceiver,
    attacker,
  ] = accounts;

  const deployedFee =ether('0.1'); // 0.01 OWL
  const updatedFee = ether('0.01'); // 0.001 OWL
  const lowFee = ether('0.005') // 0.005 OWL
  const ethFee = ether('0.025'); // 0.025 Ether

  const ethPayment = ether('1.2'); // 1.2 Ether
  const tokenAmount = ether('100'); // 100 Token
  const feeAmount = ether('10'); // 10 OWL


  before(async () => {
    this.token = await TestToken.new('TestToken', 'TT');
    this.protocolToken = await ProtocolToken.new('ProtocolToken', 'OWL');
    this.stealth = await Stealth.new(this.protocolToken.address, deployedFee, ethFee, feeManager, feeTaker,
    { from: owner });

    assert(deployedFee < feeAmount);
    await this.token.mint(payer2, tokenAmount);
    await this.protocolToken.mint(payer1, feeAmount);
    await this.protocolToken.mint(payer2, feeAmount);
    await this.protocolToken.mint(payer3, feeAmount);
    await this.protocolToken.mint(payer4, feeAmount);
    await this.protocolToken.mint(payer5, lowFee);
    await this.protocolToken.approve(this.stealth.address, tokenAmount, { from: payer1 });
    await this.protocolToken.approve(this.stealth.address, tokenAmount, { from: payer2 });
    await this.protocolToken.approve(this.stealth.address, tokenAmount, { from: payer3 });
    await this.protocolToken.approve(this.stealth.address, lowFee, { from: payer5 });
  });

  it('should deploy the protocol fee token contract', async () => {
    const tokenBalance = await this.protocolToken.balanceOf(payer2);
    const tokenAllowance = await this.protocolToken.allowance(payer2, this.stealth.address);
    expect(tokenBalance.toString()).to.equal(feeAmount.toString());
    expect(tokenAllowance.toString()).to.equal(tokenAmount.toString());
  });

  it('should see the deployed Stealth contracts', async () => {
    expect(this.stealth.address.startsWith('0x')).to.be.true;
    expect(this.stealth.address.length).to.equal(42);
    expect(this.token.address.startsWith('0x')).to.be.true;
    expect(this.token.address.length).to.equal(42);
    expect(this.protocolToken.address.startsWith('0x')).to.be.true;
    expect(this.protocolToken.address.length).to.equal(42);
  });

  it('should have correct values initialized', async () => {
    const theOwner = await this.stealth.owner();
    expect(theOwner).to.equal(owner);

    const theCollector = await this.stealth.feeManager();
    expect(theCollector).to.equal(feeManager);

    const theReceiver = await this.stealth.feeTaker();
    expect(theReceiver).to.equal(feeTaker);

    const protocolFee = await this.stealth.protocolFee();
    expect(protocolFee.toString()).to.equal(deployedFee.toString());

    const tokenBalance = await this.token.balanceOf(payer2);
    expect(tokenBalance.toString()).to.equal(tokenAmount.toString());

    const tokenAllowance = await this.protocolToken.allowance(payer2, this.stealth.address);
    expect(tokenAllowance.toString()).to.equal(tokenAmount.toString());
  });

  it('should let the owner update the protocol fee', async () => {
    await this.stealth.setProtocolFee(updatedFee, { from: owner });
    const protocolFee = await this.stealth.protocolFee();

    expect(protocolFee.toString()).to.equal(updatedFee.toString());
  });

  it('must prevent someone other than the owner to upate the protocol fee', async () => {
    await expectRevert(
      this.stealth.setProtocolFee(deployedFee, { from: attacker }),
      'Ownable: caller is not the owner',
    );
  });

  it('must prevent someone to pay less than the protocol fee amount', async () => {
    const protocolFee = await this.stealth.protocolFee();
    const paymentAmount = protocolFee.sub(new BN('1'));

    await expectRevert(
      this.stealth.sendEther(receiver1, ...serializedArguments, { from: payer1, value: paymentAmount }),
      'StealthSwap: Must have value higher than the protocol fee',
    );
  });

  it('permit someone to pay in eth', async () => {
    const receiverInitBalance = new BN(await web3.eth.getBalance(receiver1));
    const tokenAllowance = await this.protocolToken.allowance(payer1, this.stealth.address);
    const protocolFee = await this.stealth.protocolFee();

    const receipt = await this.stealth.sendEther(receiver1, ...serializedArguments, {
      from: payer1,
      value: ethPayment,
    });

    const receiverPostBalance = new BN(await web3.eth.getBalance(receiver1));
    const amountReceived = receiverPostBalance.sub(receiverInitBalance);

    expect(amountReceived.toString()).to.equal(ethPayment.toString());
    expect(tokenAllowance.toString()).to.equal(tokenAmount.toString());
    expectEvent(receipt, 'PaymentNote', {
      receiver: receiver1,
      token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      amount: ethPayment.toString(),
      iv: serializedArguments[0],
      xCoord: serializedArguments[1],
      yCoord: serializedArguments[2],
      ctBuf0: serializedArguments[3],
      ctBuf1: serializedArguments[4],
      ctBuf2: serializedArguments[5],
      mac: serializedArguments[6],
    });

    const feePostBalance = new BN(await this.protocolToken.balanceOf(this.stealth.address));

    expect(feePostBalance.toString()).to.equal(protocolFee.toString());
  });

  it('must prevent someone to send to the ETH receiver twice', async () => {
    await expectRevert(
      this.stealth.sendEther(receiver1, ...serializedArguments, {
        from: payer1,
        value: ethPayment,
      }),
      'StealthSwap: stealth address cannot be reused',
    );
  });

  it('should not let the eth receiver withdraw tokens', async () => {
    await expectRevert(
      this.stealth.withdraw(outReceiver, { from: receiver1 }),
      'StealthSwap: Unavailable tokens for withdrawal',
    );
  });

  it('must prevent someone to pay tokens to a previous ETH receiver', async () => {
    const protocolFee = await this.stealth.protocolFee();

    await expectRevert(
      this.stealth.sendERC20(
        receiver1,
        this.token.address,
        tokenAmount,
        ...serializedArguments,
        { from: payer2, value: protocolFee },
      ),
      'StealthSwap: stealth address cannot be reused',
    );
  });

  it('must prevent someone to pay with a token without sending the ether protocol fee', async () => {
    await expectRevert(
      this.stealth.sendERC20(
        receiver2,
        this.token.address,
        tokenAmount,
        ...serializedArguments,
        { from: payer2 },
      ),
      'StealthSwap: Must have value greater than or equal to ether protocol fee',
    );
  });

  it('must prevent someone to pay with a token without sending the full protocol fee', async () => {
    const protocolFee = await this.stealth.protocolFee();
    const lessFee = protocolFee.sub(new BN('1'));

    await expectRevert(
      this.stealth.sendERC20(
        receiver2,
        this.token.address,
        tokenAmount,
        ...serializedArguments,
        { from: payer2, value: lessFee },
      ),
      'StealthSwap: Must have value greater than or equal to ether protocol fee',
    );
  });

  it('permit someone to pay with a token', async () => {
    await this.token.approve(this.stealth.address, tokenAmount, { from: payer2 });
    const receiverInitBalance = new BN(await web3.eth.getBalance(receiver2));
    const receiverEthExpectedBalance = receiverInitBalance.add(new BN(ethFee));

    const receipt = await this.stealth.sendERC20(
      receiver2,
      this.token.address,
      tokenAmount,
      ...serializedArguments,
      { from: payer2, value: ethFee },
    );

    const receiverPostBalance = new BN(await web3.eth.getBalance(receiver2));
    const receiverPostTokenBalance = await this.token.balanceOf(receiver2);

    expect(receiverPostBalance.toString()).to.equal(receiverEthExpectedBalance.toString());
    expect(receiverPostTokenBalance.toString()).to.equal(tokenAmount.toString());

    expectEvent(receipt, 'PaymentNote', {
      receiver: receiver2,
      amount: tokenAmount,
      token: this.token.address,
      iv: serializedArguments[0],
      xCoord: serializedArguments[1],
      yCoord: serializedArguments[2],
      ctBuf0: serializedArguments[3],
      ctBuf1: serializedArguments[4],
      ctBuf2: serializedArguments[5],
      mac: serializedArguments[6],
    });
  });

  it('must prevent someone to pay a token to a reused address', async () => {
    await this.token.approve(this.stealth.address, tokenAmount, { from: payer2 });

    await expectRevert(
      this.stealth.sendERC20(
        receiver2,
        this.token.address,
        tokenAmount,
        ...serializedArguments,
        { from: payer2, value: ethFee },
      ),
      'StealthSwap: stealth address cannot be reused',
    );
  });

  it('must prevent someone to send tokens to a previous ETH receiver', async () => {
    await expectRevert(
      this.stealth.sendEther(receiver2, ...serializedArguments, {
        from: payer1,
        value: ethPayment,
      }),
      'StealthSwap: stealth address cannot be reused',
    );
  });


  it('must prevent a non-receiver to withdraw tokens', async () => {
    await expectRevert(
      this.stealth.withdraw(outReceiver, { from: attacker }),
      'StealthSwap: Unavailable tokens for withdrawal',
    );
  });

  it('permit receiver to withdraw their token', async () => {
    await this.token.approve(this.stealth.address, tokenAmount, { from: receiver2 });
    const receipt = await this.stealth.withdraw(outReceiver, { from: receiver2 });

    const outReceiverBalance = await this.token.balanceOf(outReceiver);

    expect(outReceiverBalance.toString()).to.equal(tokenAmount.toString());

    expectEvent(receipt, 'Withdrawal', {
      receiver: receiver2,
      interim: outReceiver,
      amount: tokenAmount,
      token: this.token.address,
    });
  });

  it('must prevent a receiver to withdraw their tokens twice', async () => {
    await expectRevert(
      this.stealth.withdraw(outReceiver, { from: receiver2 }),
      'StealthSwap: Unavailable tokens for withdrawal',
    );
  });

  it('must prevent someone else to move fees to protocol fee receiver', async () => {
    await expectRevert(
      this.stealth.collectPaidFees({ from: attacker }),
      'StealthSwap: Wrong Fee Manager',
    );
  });

  it('permit the protocol fee collector to move fees to protocol fee receiver', async () => {
    const protocolFee = await this.stealth.protocolFee();
    const expectedCollection = protocolFee.mul(new BN('2'));
    const expectedContractFeeBalance = new BN('0');

    await this.stealth.collectPaidFees({ from: feeManager });

    const receiverFeeBalance = await this.protocolToken.balanceOf(feeTaker);
    expect(receiverFeeBalance.toString()).to.equal(expectedCollection.toString());

    const contractFeeBalance = await this.protocolToken.balanceOf(this.stealth.address);
    expect(contractFeeBalance.toString()).to.equal(expectedContractFeeBalance.toString());
  });

  it('must prevent someone to pay eth without allowance for the protocol fee amount', async () => {
    await expectRevert(
      this.stealth.sendEther(receiver4, ...serializedArguments, { from: payer4, value: ethPayment }),
      'StealthSwap: You must provide allowance to pay the protocol fee',
    );
  });

  it('must prevent someone to pay eth without sufficient allowance for the protocol fee amount', async () => {
    await expectRevert(
      this.stealth.sendEther(receiver5, ...serializedArguments, { from: payer5, value: ethPayment }),
      'StealthSwap: You must provide allowance to pay the protocol fee',
    );
  });

  it('enforce someone to pay in eth if they pay protocol fee', async () => {
    const receiverInitBalance = new BN(await web3.eth.getBalance(receiver3));
    const tokenAllowance = await this.protocolToken.allowance(payer3, this.stealth.address);
    const protocolFee = await this.stealth.protocolFee();

    const receipt = await this.stealth.sendEther(receiver3, ...serializedArguments, {
      from: payer3,
      value: ethPayment,
    });

    const receiverPostBalance = new BN(await web3.eth.getBalance(receiver3));
    const amountReceived = receiverPostBalance.sub(receiverInitBalance);

    expect(amountReceived.toString()).to.equal(ethPayment.toString());
    expect(tokenAllowance.toString()).to.equal(tokenAmount.toString());

    expectEvent(receipt, 'PaymentNote', {
      receiver: receiver3,
      amount: ethPayment.toString(),
      token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      iv: serializedArguments[0],
      xCoord: serializedArguments[1],
      yCoord: serializedArguments[2],
      ctBuf0: serializedArguments[3],
      ctBuf1: serializedArguments[4],
      ctBuf2: serializedArguments[5],
      mac: serializedArguments[6],
    });

    const feePostBalance = new BN(await this.protocolToken.balanceOf(this.stealth.address));

    expect(feePostBalance.toString()).to.equal(protocolFee.toString());
  });
});
