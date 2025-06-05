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
            console.log(`[DEBUG] Modified ABI: ${funcName} stateMutability changed to 'view'.`);
        }
    } else {
        console.warn(`[DEBUG] Could not find function ${funcName} in IQuoterV2ABI.`);
    }
});

// console.log("[DEBUG] ABI entry for quoteExactInputSingle before contract instantiation:");
// const debugAbiEntry = IQuoterV2ABI.find(
//     (entry) => entry.name === "quoteExactInputSingle" && entry.type === "function"
// );
// if (debugAbiEntry) {
//     console.log(`[DEBUG]   Name: ${debugAbiEntry.name}`);
//     console.log(`[DEBUG]   Type: ${debugAbiEntry.type}`);
//     console.log(`[DEBUG]   StateMutability: ${debugAbiEntry.stateMutability}`);
//     console.log(`[DEBUG]   Inputs (first param type): ${debugAbiEntry.inputs && debugAbiEntry.inputs[0] ? debugAbiEntry.inputs[0].type : 'N/A'}`);
// } else {
//     console.log("[DEBUG]   quoteExactInputSingle entry not found in ABI.");
// }


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

  const IN_FEE_NUMERATOR = BigInt(Math.round((1 - dexFee) * 1_000_000));
  const IN_FEE_DENOMINATOR = 1_000_000n;

  const amountInWithFee = (amountIn * IN_FEE_NUMERATOR) / IN_FEE_DENOMINATOR;

  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * IN_FEE_DENOMINATOR + amountInWithFee;

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
  const token0IsTokenIn =
    reserves.token0Address.toLowerCase() === tokenInAddress.toLowerCase();
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

  return Number(formatUnits(amountOut.toString(), tokenOutDecimals));
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
async function getAmountOutV3(amountIn, pool, tokenIn, tokenOut, provider) {
    try {
        // console.log(`[DEBUG] Tentative d'instancier QuoterV2 Contract avec l'adresse: ${PANCAKESWAP_V3_QUOTER_V2}`);

        // Créer une interface pour encoder/décoder les appels
        const quoterInterface = new ethers.Interface(IQuoterV2ABI);

         
        // console.log(`[DEBUG] Valeur de tokenIn.address: ${tokenIn ? tokenIn.address : 'TOKEN_IN_UNDEFINED_OR_NULL'}`);
        // console.log(`[DEBUG] Valeur de tokenOut.address: ${tokenOut ? tokenOut.address : 'TOKEN_OUT_UNDEFINED_OR_NULL'}`);

        const params = {
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            fee: pool.fee,
            amountIn: amountIn,
            sqrtPriceLimitX96: 0 // Pas de limite de prix pour une simple estimation
        };

        // Encoder les données de l'appel de fonction
        const encodedData = quoterInterface.encodeFunctionData("quoteExactInputSingle", [params]);

        // Effectuer l'appel direct au provider
        const rawResult = await provider.call({
            to: PANCAKESWAP_V3_QUOTER_V2,
            data: encodedData
        });

        // Décode le résultat de l'appel
        // La fonction quoteExactInputSingle retourne un uint256 (BigNumber en ethers v5, BigInt en v6)
        const decodedResult = quoterInterface.decodeFunctionResult("quoteExactInputSingle", rawResult);

        // Le résultat est un tableau, le premier élément est le montant
        const quotedAmountOut = decodedResult[0];

        // Assurez-vous que c'est un BigInt (ethers v6 le fait par défaut pour uint256)
        return quotedAmountOut;

    } catch (err) {
        console.error(`❌ Erreur getAmountOutV3:`, err.message);
        if (err.code) console.error(`[DEBUG] Error Code: ${err.code}`);
        if (err.data) console.error(`[DEBUG] Error Data (revert reason encoded): ${err.data}`);
        if (err.reason) console.error(`[DEBUG] Error Reason (decoded): ${err.reason}`);
        console.error(`[DEBUG] Stack trace de l'erreur:`, err.stack);
        return 0n;
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
    // La propriété `token0Price` du pool donne le prix de 1 token0 en token1
    // et `token1Price` donne le prix de 1 token1 en token0.
    // Assurez-vous d'utiliser le bon pour votre paire.
    const price = pool.token0Price.toSignificant(6); // exemple de prix de token0 en token1
    return Number(price);
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