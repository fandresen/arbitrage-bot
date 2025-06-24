// utils/calculations.js
const { parseUnits, formatUnits } = require("ethers");
const ethers = require("ethers"); // Import the full ethers object
const { Trade, Route, SwapQuoter } = require("@uniswap/v3-sdk"); // Importez les nécessaires
const { Token, CurrencyAmount, TradeType } = require("@uniswap/sdk-core"); // Importez les nécessaires
const { PANCAKESWAP_V3_QUOTER_V2 } = require("../config");

const IUniswapV3PoolABI =
  require("@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json").abi;
const ISwapRouterABI =
  require("@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json").abi;

// Define a minimal ABI for the specific function causing issues
const QUOTER_V2_SINGLE_QUOTE_ABI = [
  {
    inputs: [
      { internalType: "address", name: "tokenIn", type: "address" },
      { internalType: "address", name: "tokenOut", type: "address" },
      { internalType: "uint24", name: "fee", type: "uint24" },
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    name: "quoteExactInputSingle",
    outputs: [
      { internalType: "uint256", name: "amountOut", type: "uint256" }, // 1er output
      { internalType: "uint160", name: "sqrtPriceX96After", type: "uint160" }, // 2ème output (très probable)
      { internalType: "uint32", name: "initializedTicksCrossed", type: "uint32" }, // 3ème output (très probable)
      { internalType: "uint256", name: "gasEstimate", type: "uint256" } // 4ème output (très probable)
    ],
    stateMutability: "view",
    type: "function",
  },
];


/**
 * Récupère le montant de sortie estimé pour un swap V3.
 * @param {Token} tokenIn - L'instance du token d'entrée.
 * @param {Token} tokenOut - L'instance du token de sortie.
 * @param {number} fee - Le niveau de frais de la pool (ex: 500 pour 0.05%).
 * @param {BigInt} amountIn - Le montant d'entrée (en BigInt).
 * @param {object} provider - Instance d'ethers.js Provider.
 * @param {string} quoterAddress - L'adresse du contrat Quoter V2 (PancakeSwap ou Uniswap).
 * @returns {Promise<BigInt|null>} Le montant de sortie estimé en BigInt, ou null en cas d'erreur.
 */
async function getAmountOutV3(tokenIn, tokenOut, fee, amountIn, provider, quoterAddress) {
  try {
    // Valider si amountIn est un BigInt et est positif
    if (typeof amountIn !== 'bigint' || amountIn <= 0n) {
      console.warn(`⚠️ getAmountOutV3: amountIn invalide ou non positif. Reçu: ${amountIn}`);
      return null;
    }

    const quoterContract = new ethers.Contract(quoterAddress, QUOTER_V2_SINGLE_QUOTE_ABI, provider);
    
    // Pour quoteExactInputSingle, sqrtPriceLimitX96 peut être 0 pour pas de limite inférieure
    // ou Math.sqrt(MAX_UINT256) pour pas de limite supérieure, selon le sens du swap.
    // Utiliser 0 pour une limite minimale permet de trouver n'importe quel prix tant que la liquidité existe.
    const quotedAmountOut = await quoterContract.quoteExactInputSingle(
      tokenIn.address,
      tokenOut.address,
      fee,
      amountIn,
      0 // sqrtPriceLimitX96: 0 means no limit (or max/min depending on swap direction for a given pool)
    );
    return BigInt(quotedAmountOut);
  } catch (err) {
    if (err.code === 'CALL_EXCEPTION') {
      console.error(`❌ Erreur getAmountOutV3 (${quoterAddress}) pour ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol} (Frais: ${fee / 100}%): CALL_EXCEPTION - ${err.message}. Cela peut indiquer une liquidité insuffisante pour le montant demandé ou un slippage trop élevé.`);
    } else {
      console.error(`❌ Erreur getAmountOutV3 (${quoterAddress}):`, err.message);
    }
    return null;
  }
}

/**
 * Calcule le prix d'un token par rapport à un autre dans une pool V3.
 * @param {Pool} pool - L'instance de la pool V3.
 * @returns {number} Le prix du token1 par rapport au token0 (USDT par WBNB).
 */
function calculatePriceV3(pool) {
  try {
    let priceValue = 0;

    // Determine the USDT/WBNB price based on token order in the pool
    if (pool.token0.symbol === 'WBNB' && pool.token1.symbol === 'USDT') {
      // If token0 is WBNB (18 decimals) and token1 is USDT (6 decimals)
      // pool.token0Price is the price of WBNB in USDT. We need to adjust for decimal differences.
      const rawPriceString = pool.token0Price.toSignificant(6);
      const decimalDifference = pool.token0.decimals - pool.token1.decimals; // 18 - 6 = 12
      priceValue = Number(rawPriceString) / (10 ** decimalDifference);

    } else if (pool.token0.symbol === 'USDT' && pool.token1.symbol === 'WBNB') {
      // If token0 is USDT (6 decimals) and token1 is WBNB (18 decimals)
      // pool.token1Price is the price of WBNB in USDT. We need to adjust for decimal differences.
      const rawPriceString = pool.token1Price.toSignificant(6);
      const decimalDifference = pool.token1.decimals - pool.token0.decimals; // 18 - 6 = 12
      priceValue = Number(rawPriceString) / (10 ** decimalDifference);

    } else {
      console.warn("⚠️ Pool de paires non supportées pour le calcul du prix.");
      return 0;
    }
    
    // Ensure the price is valid
    if (isNaN(priceValue) || !isFinite(priceValue)) {
      console.error("❌ Erreur de calcul du prix V3: Le prix résultant n'est pas un nombre valide.");
      return 0;
    }

    return priceValue;

  } catch (err) {
    console.error("❌ Erreur lors du calcul du prix V3:", err.message);
    return 0;
  }
}


module.exports = {
  getAmountOutV3,
  calculatePriceV3,
};