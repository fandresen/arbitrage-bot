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
const QUOTER_V2_SINGLE_QUOTE_ABI = require("../abis/pancakeSwapQuoter.json");

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
async function getAmountOutV3(
  tokenIn,
  tokenOut,
  fee,
  amountIn,
  provider,
  quoterAddress
) {
  try {
    // Valider si amountIn est un BigInt et est positif
    if (typeof amountIn !== "bigint" || amountIn <= 0n) {
      console.warn(
        `⚠️ getAmountOutV3: amountIn invalide ou non positif. Reçu: ${amountIn}`
      );
      return null;
    }

    const quoterContract = new ethers.Contract(
      quoterAddress,
      QUOTER_V2_SINGLE_QUOTE_ABI,
      provider
    );

    // Pour quoteExactInputSingle, sqrtPriceLimitX96 peut être 0 pour pas de limite inférieure
    // ou Math.sqrt(MAX_UINT256) pour pas de limite supérieure, selon le sens du swap.
    // Utiliser 0 pour une limite minimale permet de trouver n'importe quel prix tant que la liquidité existe.
    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] =
      await quoterContract.quoteExactInputSingle.staticCall({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        fee: fee,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });

    return amountOut;
  } catch (err) {
    if (err.code === "CALL_EXCEPTION") {
      console.error(
        `❌ Erreur getAmountOutV3 (${quoterAddress}) pour ${formatUnits(
          amountIn,
          tokenIn.decimals
        )} ${tokenIn.symbol} (Frais: ${fee / 100}%): CALL_EXCEPTION - ${
          err.message
        }. Cela peut indiquer une liquidité insuffisante pour le montant demandé ou un slippage trop élevé.`
      );
    } else {
      console.error(
        `❌ Erreur getAmountOutV3 (${quoterAddress}):`,
        err.message
      );
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
    if (pool.token0.symbol === "WBNB" && pool.token1.symbol === "USDT") {
      priceValue = parseFloat(pool.token0Price.toSignificant(6));
    } else if (pool.token0.symbol === "USDT" && pool.token1.symbol === "WBNB") {
      priceValue = parseFloat(pool.token1Price.toSignificant(6));
    } else {
      console.warn("⚠️ Pool de paires non supportées pour le calcul du prix.");
      return 0;
    }

    // Ensure the price is valid
    if (isNaN(priceValue) || !isFinite(priceValue)) {
      console.error(
        "❌ Erreur de calcul du prix V3: Le prix résultant n'est pas un nombre valide."
      );
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
