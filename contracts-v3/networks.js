require('dotenv').config();
const HDWalletProvider = require('@truffle/hdwallet-provider');

const projectId = process.env.INFURA_ID;
const privateKey = process.env.ROPSTEN_STEALTHOWNER;

module.exports = {
  networks: {

    ropsten: {
      provider: () => new HDWalletProvider(
        privateKey, `https://ropsten.infura.io/v3/${projectId}`,
      ),
      networkId: 3,
      gasPrice: 10e9,
      gas: 5e6,
    },
  },
};
