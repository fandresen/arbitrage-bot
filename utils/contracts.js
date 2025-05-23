// utils/contracts.js
const IUniswapV2Factory = require("../abis/IUniswapV2Factory.json");
const IUniswapV2Pair = require("../abis/IUniswapV2Pair.json");

/**
 * Récupère l'adresse d'une paire à partir de la factory.
 * @param {string} factoryAddress - Adresse du contrat de la factory.
 * @param {string} tokenA - Adresse du premier token.
 * @param {string} tokenB - Adresse du deuxième token.
 * @param {object} web3Instance - Instance de Web3.
 * @returns {Promise<string|null>} L'adresse de la paire ou null en cas d'erreur.
 */
async function getPairAddress(factoryAddress, tokenA, tokenB, web3Instance) {
  try {
    const factory = new web3Instance.eth.Contract(IUniswapV2Factory.abi, factoryAddress);
    const pairAddress = await factory.methods.getPair(tokenA, tokenB).call();
    if (pairAddress === "0x0000000000000000000000000000000000000000") {
      console.warn(
        `⚠️ Paire introuvable pour ${tokenA} et ${tokenB} sur la factory ${factoryAddress}`
      );
      return null;
    }
    return pairAddress;
  } catch (err) {
    console.error(`Erreur getPairAddress (${factoryAddress}):`, err.message);
    return null;
  }
}

/**
 * Récupère les réserves d'une paire.
 * @param {string} pairAddr - Adresse du contrat de la paire.
 * @param {object} web3Instance - Instance de Web3.
 * @returns {Promise<object|null>} Un objet contenant les réserves et les adresses des tokens, ou null.
 */
async function getReserves(pairAddr, web3Instance) {
  const contract = new web3Instance.eth.Contract(IUniswapV2Pair.abi, pairAddr);
  try {
    const reserves = await contract.methods.getReserves().call();
    const token0Address = await contract.methods.token0().call();
    const token1Address = await contract.methods.token1().call();
    return {
      reserve0: BigInt(reserves.reserve0),
      reserve1: BigInt(reserves.reserve1),
      token0Address: token0Address,
      token1Address: token1Address
    };
  } catch (err) {
    console.error(`Erreur getReserves pour ${pairAddr}:`, err.message);
    return null;
  }
}

module.exports = {
  getPairAddress,
  getReserves,
};