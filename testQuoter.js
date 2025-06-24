require("dotenv").config();
const { ethers, BigNumber } = require("ethers");

const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const BUSD_ADDRESS = "0xe9e7CEA3DedcA5984780BfFcd38296799765fC5";

const TOKEN_DECIMALS = {
  [WBNB_ADDRESS.toLowerCase()]: 18,
  [BUSD_ADDRESS.toLowerCase()]: 18,
};

const PANCAKESWAP_V3_QUOTER_V2_ADDRESS = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";
const UNISWAP_V3_QUOTER_V2_ADDRESS = "0x78D78E420Da98ad378D7799bE8f4AF69033EB077"; // Quoter V2 pour Uniswap V3 (sur BSC)

// Niveaux de frais standard pour Uniswap V3 / PancakeSwap V3
const FEE_TIERS = [
  500,  // 0.05%
  2500, // 0.25% (existe sur Uniswap V3)
  3000, // 0.3%
  10000 // 1%
];

// --- ABI complète pour quoteExactInputSingle (avec 4 retours) ---
const QUOTER_V2_ABI = require("./abis/pancakeSwapQuoter.json");

// --- Fonction principale ---
async function getQuotes() {
  const provider = new ethers.JsonRpcProvider(process.env.HTTP_RPC_URL);

  const pancakeswapQuoter = new ethers.Contract(PANCAKESWAP_V3_QUOTER_V2_ADDRESS, QUOTER_V2_ABI, provider);
  const uniswapQuoter = new ethers.Contract(UNISWAP_V3_QUOTER_V2_ADDRESS, QUOTER_V2_ABI, provider);

  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`Connecté au RPC. Numéro de bloc actuel: ${blockNumber}`);
  } catch (error) {
    console.error("ERREUR CRITIQUE: Échec de la connexion RPC de base (getBlockNumber) :", error);
    // Si cette erreur se produit, tout le reste échouera.
    return;
  }

  // Ajoutez ces lignes
  console.log("Adresse du PancakeSwap V3 Quoter utilisée :", pancakeswapQuoter.target);
  console.log("Adresse de l'Uniswap V3 Quoter utilisée :", uniswapQuoter.target);

  const amountToQuote = 1; // Exemple: 1 USDT
  const amountInUSDT = ethers.parseUnits(amountToQuote.toString(), TOKEN_DECIMALS[BUSD_ADDRESS.toLowerCase()]); // Convertir en BigInt avec les bonnes décimales

  // Changez le message pour qu'il corresponde aux tokens réels (BUSD -> CAKE)
  console.log(`\n--- Tentative de cotation pour ${amountToQuote} BUSD -> CAKE ---`); 

  // --- Test PancakeSwap V3 Quoter ---
  console.log("\n--- PancakeSwap V3 Quoter ---");
  for (const fee of FEE_TIERS) {
    try {
      console.log(`  Tentative avec frais: ${fee / 100}%`);
      const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = await pancakeswapQuoter.quoteExactInputSingle.staticCall({ 
          tokenIn: BUSD_ADDRESS,
          tokenOut: WBNB_ADDRESS,
          fee: fee,
          amountIn: amountInUSDT,
          sqrtPriceLimitX96: 0 // Laisser à 0 pour l'instant
        }
      );

      console.log(`    PancakeSwap V3 (Frais ${fee/100}%):`);
      console.log(`      CAKE obtenu (estimé): ${ethers.formatUnits(amountOut, TOKEN_DECIMALS[WBNB_ADDRESS.toLowerCase()])}`); // Changez WBNB en CAKE
      console.log(`      Prix final (sqrtPriceX96After): ${sqrtPriceX96After.toString()}`);
      console.log(`      Ticks traversés: ${initializedTicksCrossed.toString()}`);
      console.log(`      Estimation gaz du swap: ${gasEstimate.toString()}`);
    } catch (error) {
      console.error(`    Erreur pour PancakeSwap V3 (Frais ${fee/100}%):`, error.message);
      if (error.code === 'CALL_EXCEPTION') {
          console.error("      Cela peut indiquer: pool inexistant pour ces frais, liquidité insuffisante, ou paramètres incorrects.");
      }
    }
  }

  // --- Test Uniswap V3 Quoter ---
  console.log("\n--- Uniswap V3 Quoter ---");
  for (const fee of FEE_TIERS) {
    try {
      console.log(`  Tentative avec frais: ${fee / 100}%`);
      const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = await uniswapQuoter.quoteExactInputSingle.staticCall({
        tokenIn: BUSD_ADDRESS, 
        tokenOut: WBNB_ADDRESS,
        fee: fee,
        amountIn: amountInUSDT,
        sqrtPriceLimitX96: 0
      });

      console.log(`    Uniswap V3 (Frais ${fee/100}%):`);
      console.log(`      CAKE obtenu (estimé): ${ethers.formatUnits(amountOut, TOKEN_DECIMALS[WBNB_ADDRESS.toLowerCase()])}`); // Changez WBNB en CAKE
      console.log(`      Prix final (sqrtPriceX96After): ${sqrtPriceX96After.toString()}`);
      console.log(`      Ticks traversés: ${initializedTicksCrossed.toString()}`);
      console.log(`      Estimation gaz du swap: ${gasEstimate.toString()}`);
    } catch (error) {
      console.error(`    Erreur pour Uniswap V3 (Frais ${fee/100}%):`, error.message);
      if (error.code === 'CALL_EXCEPTION') {
          console.error("      Cela peut indiquer: pool inexistant pour ces frais, liquidité insuffisante, ou paramètres incorrects.");
      }
    }
  }
}

// Exécuter la fonction principale
getQuotes().catch(console.error);