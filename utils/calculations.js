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

const IQuoterV2ABI_RAW = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/IQuoterV2.sol/IQuoterV2.json').abi;

const IQuoterV2ABI = JSON.parse(JSON.stringify(IQuoterV2ABI_RAW));

const functionsToFix = [
    "quoteExactInput",
    "quoteExactInputSingle",
    "quoteExactOutput",
    "quoteExactOutputSingle",
];

functionsToFix.forEach(funcName => {
    const abiEntry = IQuoterV2ABI.find(
        (entry) => entry.name === funcName && entry.type === "function"
    );
    if (abiEntry) {
        if (abiEntry.stateMutability === "nonpayable") { // Ne modifie que si c'est 'nonpayable'
            abiEntry.stateMutability = "view";
        }
    } else {
        console.warn(`[DEBUG] Could not find function ${funcName} in IQuoterV2ABI.`);
    }
});


/**
 * Calcule la quantité de `amountOut` obtenue pour un `amountIn` donné sur un DEX V2.
 * (Fonction existante, gardée pour la compatibilité V2)
 *
 * @param {BigInt} amountIn - Le montant du token que l'on donne.
 * @param {BigInt} reserveIn - La réserve du token que l'on donne dans la pool.
 * @param {BigInt} reserveOut - La réserve du token que l'on veut recevoir dans la pool.
 * @param {number} dexFee - Les frais du DEX en décimal (ex: 0.0025 pour 0.25%).
 * @returns {BigInt} La quantité de token que l'on reçoit.
 */
function getAmountOutV2(amountIn, reserveIn, reserveOut, dexFee) {
  if (amountIn <= 0n) return 0n;
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n;

  const IN_FEE_NUMERATOR = BigInt(Math.round((1 - dexFee) * 1_000));
  const IN_FEE_DENOMINATOR = 1_000n;

  const amountInWithFee = (amountIn * IN_FEE_NUMERATOR) / IN_FEE_DENOMINATOR;

  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn + amountInWithFee;
  //const denominator = reserveIn + amountInWithFee;

  const amountOut = numerator / denominator;
  return amountOut;
}

/**
 * Calcule le prix de "vente" d'un token A contre un token B sur un DEX V2.
 * (Fonction existante, gardée pour la compatibilité V2)
 *
 * @param {object} reserves - Les réserves de la paire.
 * @param {string} tokenInAddress - L'adresse du token que l'on vend.
 * @param {string} tokenOutAddress - L'adresse du token que l'on veut acheter.
 * @param {object} tokenDecimalsMap - Une carte des adresses de tokens vers leurs décimales.
 * @param {number} dexFee - Les frais du DEX en décimal (ex: 0.0025 pour 0.25%).
 * @returns {number | null} Le prix de 1 tokenIn en tokenOut.
 */
function calculatePriceV2(
  reserves,
  tokenInAddress,
  tokenOutAddress,
  tokenDecimalsMap,
  dexFee
) {
  const token0IsTokenIn = reserves.token0Address.toLowerCase() === tokenInAddress.toLowerCase();
  const reserveIn = token0IsTokenIn ? reserves.reserve0 : reserves.reserve1;
  const reserveOut = token0IsTokenIn ? reserves.reserve1 : reserves.reserve0;

  const tokenInDecimals = tokenDecimalsMap[tokenInAddress.toLowerCase()];
  const tokenOutDecimals = tokenDecimalsMap[tokenOutAddress.toLowerCase()];

  if (tokenInDecimals === undefined || tokenOutDecimals === undefined) {
    console.warn(
      `⚠️ Décimales manquantes pour ${tokenInAddress} ou ${tokenOutAddress}`
    );
    return null;
  }

  const oneUnitIn = parseUnits("1", tokenInDecimals);
  const amountOut = getAmountOutV2(oneUnitIn, reserveIn, reserveOut, dexFee);

  if (oneUnitIn === 0n) return null;

  return Number(formatUnits(amountOut.toString(), tokenInDecimals)).toFixed(2);
}

/**
 * Simule un swap sur Uniswap V3 pour obtenir amountOut pour un amountIn donné.
 * Nécessite un `provider` pour interagir avec le smart contract `Quoter`.
 * @param {object} pool - Instance de Pool V3 (créée avec createV3Pool).
 * @param {object} tokenIn - Instance du TokenIn (from @uniswap/sdk-core).
 * @param {object} tokenOut - Instance du TokenOut (from @uniswap/sdk-core).
 * @param {BigInt} amountIn - Montant de tokenIn à échanger (en BigInt, unités natives).
 * @param {string} quoterAddress - Adresse du contrat `Quoter` V3. (This parameter is not used in the code, PANCAKESWAP_V3_QUOTER_V2 from config is used)
 * @param {object} provider - Instance d'ethers.js Provider.
 * @returns {Promise<BigInt>} Le montant de tokenOut reçu.
 */

// **New: Rate Limiter for getAmountOutV3**
let lastQuoterCallTime = 0;
const QUOTER_THROTTLE_INTERVAL_MS = 200; // Adjust as needed. e.g., 50ms for 20 calls/sec.

async function getAmountOutV3(amountIn, pool, tokenIn, tokenOut, provider) {
    // Implement rate limiting directly here for the quoter calls
    const now = Date.now();
    if (now - lastQuoterCallTime < QUOTER_THROTTLE_INTERVAL_MS) {
        // If we hit the rate limit here, we should wait, not skip,
        // because the arbitrage calculation depends on this result.
        // A simple `await new Promise(resolve => setTimeout(resolve, ...))` can work,
        // but a more sophisticated queue with exponential backoff is better for production.
        // For now, let's just log and return 0n to indicate a skipped/failed call.
        // In a real scenario, you'd want to queue this and retry.
        console.warn(`⏩ Saut de l'appel Quoter V3: Trop de requêtes internes. Attendez ou augmentez les limites.`);
        // For simplicity and to avoid blocking indefinitely, we return 0n.
        // In a production system, you'd want to queue and retry, or use a robust rate-limiter library.
        await new Promise(resolve => setTimeout(resolve, QUOTER_THROTTLE_INTERVAL_MS - (now - lastQuoterCallTime)));
    }
    lastQuoterCallTime = Date.now(); // Update after potential wait


    try {
        const quoterInterface = new ethers.Interface(IQuoterV2ABI);

        const params = {
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            fee: pool.fee,
            amountIn: amountIn,
            sqrtPriceLimitX96: 0 // No price limit for a simple estimate
        };

        const encodedData = quoterInterface.encodeFunctionData("quoteExactInputSingle", [params]);

        const rawResult = await provider.call({
            to: PANCAKESWAP_V3_QUOTER_V2,
            data: encodedData
        });

        const decodedResult = quoterInterface.decodeFunctionResult("quoteExactInputSingle", rawResult);
        const quotedAmountOut = decodedResult[0];

        return quotedAmountOut;

    } catch (err) {
        console.error(`❌ Erreur getAmountOutV3:`, err.message);
        if (err.code) console.error(`[DEBUG] Error Code: ${err.code}`);
        if (err.data) console.error(`[DEBUG] Error Data (revert reason encoded): ${err.data}`);
        if (err.reason) console.error(`[DEBUG] Error Reason (decoded): ${err.reason}`);
        console.error(`[DEBUG] Stack trace de l'erreur:`, err.stack);
        // Potentially re-throw or handle specific Infura rate limit errors
        if (err.code === 'BAD_DATA' && err.message.includes('Too Many Requests')) {
            console.error('Infura rate limit hit during getAmountOutV3 call. Consider reducing LOAN_AMOUNT_INCREMENT_USDT or upgrading Infura plan.');
            // Implement a more aggressive backoff here or flag to the main loop to slow down.
        }
        return 0n; // Return 0n on error to prevent breaking subsequent calculations
    }
}

/**
 * Calcule le prix d'un token A contre un token B sur une pool V3.
 * Utilise la `Price` du SDK Uniswap V3.
 * @param {object} pool - Instance de Pool V3 (créée avec createV3Pool).
 * @returns {number | null} Le prix de 1 token0 en token1.
 */
function calculatePriceV3(pool) {
  try {
    const token0Symbol = pool.token0.symbol;
    const token1Symbol = pool.token1.symbol;

    let priceValue;

    // On veut le prix de 1 WBNB en USDT
    if (pool.token0.symbol === 'WBNB' && pool.token1.symbol === 'USDT') {
      // Cas: token0 est WBNB (18 décimales), token1 est USDT (6 décimales)
      // pool.token0Price est le prix de WBNB en USDT (token0 par token1).
      // La valeur de `toSignificant` sera le prix correct multiplié par 10^(décimales_WBNB - décimales_USDT)
      const rawPriceString = pool.token0Price.toSignificant(6);
      const decimalDifference = pool.token0.decimals - pool.token1.decimals; // 18 - 6 = 12
      priceValue = Number(rawPriceString) / (10 ** decimalDifference);
      
    } else if (pool.token0.symbol === 'USDT' && pool.token1.symbol === 'WBNB') {
      // Cas: token0 est USDT (6 décimales), token1 est WBNB (18 décimales)
      // pool.token1Price est le prix de WBNB en USDT (token1 par token0).
      // La valeur de `toSignificant` sera le prix correct multiplié par 10^(décimales_WBNB - décimales_USDT)
      const rawPriceString = pool.token1Price.toSignificant(6);
      const decimalDifference = pool.token1.decimals - pool.token0.decimals; // 18 - 6 = 12
      priceValue = Number(rawPriceString) / (10 ** decimalDifference);

    } else {
      console.warn("⚠️ Paire inattendue dans calculatePriceV3:", token0Symbol, token1Symbol);
      return null;
    }

    return priceValue;

  } catch (err) {
    console.error(`❌ Erreur calculatePriceV3:`, err.message);
    return null;
  }
}


module.exports = {
  getAmountOutV2,
  calculatePriceV2,
  getAmountOutV3,
  calculatePriceV3,
};