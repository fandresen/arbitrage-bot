// utils/calculations.js
const { parseUnits, formatUnits } = require("ethers");

/**
 * Calcule la quantité de `amountOut` obtenue pour un `amountIn` donné
 * en prenant en compte les frais Uniswap V2 (0.3%).
 *
 * @param {BigInt} amountIn - Le montant du token que l'on donne.
 * @param {BigInt} reserveIn - La réserve du token que l'on donne dans la pool.
 * @param {BigInt} reserveOut - La réserve du token que l'on veut recevoir dans la pool.
 * @returns {BigInt} La quantité de token que l'on reçoit.
 */
function getAmountOut(amountIn, reserveIn, reserveOut) {
  if (amountIn <= 0n) return 0n;
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n;

  const amountInWithFee = amountIn * 997n; // 997 / 1000 = 0.997 (1 - 0.003)
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  const amountOut = numerator / denominator;
  return amountOut;
}

/**
 * Calcule le prix de "vente" d'un token A contre un token B.
 * C'est-à-dire, combien de Token B on obtient en vendant Token A.
 * Cela correspond à `getAmountOut(1 TokenA, ReserveA, ReserveB)`.
 *
 * @param {object} reserves - Les réserves de la paire.
 * @param {string} tokenInAddress - L'adresse du token que l'on vend.
 * @param {string} tokenOutAddress - L'adresse du token que l'on veut acheter.
 * @param {object} tokenDecimalsMap - Une carte des adresses de tokens vers leurs décimales.
 * @returns {number | null} Le prix de 1 tokenIn en tokenOut.
 */
function calculatePrice(reserves, tokenInAddress, tokenOutAddress, tokenDecimalsMap) {
  const token0IsTokenIn = reserves.token0Address.toLowerCase() === tokenInAddress.toLowerCase();
  const reserveIn = token0IsTokenIn ? reserves.reserve0 : reserves.reserve1;
  const reserveOut = token0IsTokenIn ? reserves.reserve1 : reserves.reserve0;

  const tokenInDecimals = tokenDecimalsMap[tokenInAddress.toLowerCase()];
  const tokenOutDecimals = tokenDecimalsMap[tokenOutAddress.toLowerCase()];

  if (tokenInDecimals === undefined || tokenOutDecimals === undefined) {
      console.warn(`Décimales manquantes pour ${tokenInAddress} ou ${tokenOutAddress}`);
      return null;
  }

  // Simuler l'échange de 1 unité du tokenIn (avec ses décimales)
  const oneUnitIn = parseUnits("1", tokenInDecimals);
  const amountOut = getAmountOut(oneUnitIn, reserveIn, reserveOut);

  if (oneUnitIn === 0n) return null;

  // Retourne le prix de 1 tokenIn en tokenOut (formaté en nombre flottant)
  return Number(formatUnits(amountOut.toString(), tokenOutDecimals));
}

module.exports = {
  getAmountOut,
  calculatePrice,
};