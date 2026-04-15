// utils/calculations.js
const { parseUnits, formatUnits } = require("ethers");
const ethers = require("ethers");

// Import rpcManager et log depuis le scope principal (on les passe en paramètre ou on les importe)
const rpcManager = require("./rpcManager");   // ← Ajoute cet import

// ABI minimal pour quoteExactInputSingle (Quoter V2)
const QUOTER_V2_SINGLE_QUOTE_ABI = require("../abis/pancakeSwapQuoter.json");

/**
 * Récupère le montant de sortie estimé pour un swap V3.
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
    if (typeof amountIn !== "bigint" || amountIn <= 0n) {
      console.warn(`⚠️ getAmountOutV3: amountIn invalide → ${amountIn}`);
      return null;
    }

    const quoterContract = new ethers.Contract(
      quoterAddress,
      QUOTER_V2_SINGLE_QUOTE_ABI,
      provider
    );

    const params = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: fee,
      amountIn: amountIn,
      sqrtPriceLimitX96: 0n,   // 0 = pas de limite (standard pour les quotes)
    };

    // Utilisation recommandée : .callStatic
    const result = await quoterContract.callStatic.quoteExactInputSingle(params);

    // result est un tuple : [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]
    return result[0];   // amountOut

  } catch (err) {
    const errorMsg = err.message || err.toString();

    // Rate limit → switch RPC (unifié)
    if (rpcManager.isRateLimitError && rpcManager.isRateLimitError(err)) {
      console.log(`🚨 Rate limit détecté sur Quoter (${quoterAddress}) → Switch RPC`);
      rpcManager.switchToNextRpc();
      return null;
    }

    // Erreur courante : liquidité insuffisante pour le montant testé
    if (err.code === "CALL_EXCEPTION" || errorMsg.includes("revert") || errorMsg.includes("Unexpected error")) {
      // Log silencieux pour les gros montants (fréquent sur Uniswap qui a moins de liquidité)
      if (amountIn > 5000n * 10n ** 18n) {  // > 5000 USDT
        console.warn(`⚠️ Quoter CALL_EXCEPTION (liquidité faible?) pour ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`);
      } else {
        console.error(`❌ Quoter error (${quoterAddress}): CALL_EXCEPTION - ${errorMsg}`);
      }
    } else {
      console.error(`❌ Erreur inattendue getAmountOutV3:`, errorMsg);
    }

    return null;
  }
}

/**
 * Calcule le prix spot à partir d'une Pool @uniswap/v3-sdk
 */
function calculatePriceV3(pool) {
  try {
    if (!pool || !pool.token0 || !pool.token1) {
      console.warn("⚠️ Pool invalide pour calculatePriceV3");
      return 0;
    }

    let priceValue = 0;

    if (pool.token0.symbol === "WBNB" && pool.token1.symbol === "USDT") {
      priceValue = parseFloat(pool.token0Price.toSignificant(6));
    } else if (pool.token0.symbol === "USDT" && pool.token1.symbol === "WBNB") {
      priceValue = parseFloat(pool.token1Price.toSignificant(6));
    } else {
      console.warn(`⚠️ Tokens non supportés dans la pool: ${pool.token0.symbol}/${pool.token1.symbol}`);
      return 0;
    }

    if (isNaN(priceValue) || !isFinite(priceValue) || priceValue <= 0) {
      console.error("❌ Prix calculé invalide dans calculatePriceV3");
      return 0;
    }

    return priceValue;
  } catch (err) {
    console.error("❌ Erreur calculatePriceV3:", err.message);
    return 0;
  }
}

module.exports = {
  getAmountOutV3,
  calculatePriceV3,
};