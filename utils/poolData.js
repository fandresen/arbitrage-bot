// src/utils/poolData.js
const { ethers } = require("ethers");
const { Pool, TickMath, TickListDataProvider } = require("@uniswap/v3-sdk");
const JSBI = require("jsbi");
const ITickLensABI = require("../abis/ITickLens.json");

/**
 * Récupère les ticks et corrige le ZERO_NET invariant avec un tick fantôme aligné
 */
async function fetchTickData(poolAddress, currentTick, provider, tickLensAddress) {
  const tickLensContract = new ethers.Contract(tickLensAddress, ITickLensABI, provider);

  const tickSpacing = 10; 
  
  const compressed = Math.floor(currentTick / tickSpacing);
  const wordPos = compressed >> 8;
  
  const promises = [];
  for (let i = -3; i <= 3; i++) {
      promises.push(tickLensContract.getPopulatedTicksInWord(poolAddress, wordPos + i));
  }

  const results = await Promise.all(promises);
  
  let ticks = [];
  results.forEach(res => {
      res.forEach(t => {
          ticks.push({
              index: Number(t.tick),
              liquidityNet: t.liquidityNet.toString(),
              liquidityGross: t.liquidityGross.toString()
          });
      });
  });

  // --- 🛡️ FIX ZERO_NET & TICK_SPACING 🛡️ ---
  let netSum = JSBI.BigInt(0);
  for (const t of ticks) {
      netSum = JSBI.add(netSum, JSBI.BigInt(t.liquidityNet));
  }

  if (JSBI.notEqual(netSum, JSBI.BigInt(0))) {
      const phantomLiquidityNet = JSBI.multiply(netSum, JSBI.BigInt(-1));
      
      const minTick = TickMath.MIN_TICK;
      const phantomTickIndex = Math.ceil(minTick / tickSpacing) * tickSpacing;

      ticks.push({
          index: phantomTickIndex, 
          liquidityNet: phantomLiquidityNet.toString(),
          liquidityGross: phantomLiquidityNet.toString() 
      });
  }
  // -------------------------------------

  return ticks.sort((a, b) => a.index - b.index);
}

function createSDKPool(tokenA, tokenB, fee, state, ticks) {
  try {
      // --- CORRECTION : TRI DES TOKENS ---
      // Le SDK exige que token0 < token1 par adresse.
      // state.sqrtPriceX96 et state.tick viennent du contrat, donc ils respectent déjà cet ordre.
      const [token0, token1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];
      
      const tickDataProvider = new TickListDataProvider(ticks, 10); 
      
      return new Pool(
        token0, // Toujours le plus petit en premier
        token1,
        fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick,
        tickDataProvider
      );
  } catch (error) {
      // On logue l'erreur pour voir si ça plante encore
      console.error("❌ Failed to create SDK Pool:", error.message);
      return null;
  }
}

module.exports = { fetchTickData, createSDKPool };