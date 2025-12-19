// src/utils/poolData.js
const { ethers } = require("ethers");
const { Pool, TickMath, TickListDataProvider } = require("@uniswap/v3-sdk");
const JSBI = require("jsbi");
const ITickLensABI = require("../abis/ITickLens.json");

// Helper pour déterminer l'espacement selon les frais
function getTickSpacing(fee) {
    if (fee === 100) return 1;      // 0.01%
    if (fee === 500) return 10;     // 0.05%
    if (fee === 3000) return 60;    // 0.3%
    if (fee === 2500) return 60;    // 0.25% (Pancake)
    if (fee === 10000) return 200;  // 1%
    return 60; // Fallback standard
}

/**
 * Récupère les ticks et corrige le ZERO_NET invariant avec un tick fantôme aligné
 */
async function fetchTickData(poolAddress, currentTick, provider, tickLensAddress, fee) { // <--- Ajout du paramètre 'fee'
  const tickLensContract = new ethers.Contract(tickLensAddress, ITickLensABI, provider);

  // DYNAMIQUE : On récupère le bon spacing
  const tickSpacing = getTickSpacing(fee);
  
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
      // Arrondi correct au multiple de tickSpacing
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
      const [token0, token1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];
      
      const tickSpacing = getTickSpacing(fee);
      const tickDataProvider = new TickListDataProvider(ticks, tickSpacing); 
      
      return new Pool(
        token0,
        token1,
        fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick,
        tickDataProvider
      );
  } catch (error) {
      console.error("❌ Failed to create SDK Pool:", error.message);
      // console.error(error.stack); // Décommente pour voir la stacktrace si besoin
      return null;
  }
}

module.exports = { fetchTickData, createSDKPool };