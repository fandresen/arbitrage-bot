// live_test_runner.js
require("dotenv").config();
const { ethers } = require("ethers");
const { executeFlashLoanArbitrage } = require("./utils/executeArbitrageFlashLoan");
const config = require("./config");

const {
  WBNB_ADDRESS,
  USDT_ADDRESS,
  FLASH_LOAN_CONTRACT_ADDRESS,
} = config;

// L'ABI minimal requis pour interagir avec le contrat
const FlashLoanABI = require("./abis/FlashLoan.json").abi;

/**
 * Fonction principale pour lancer le test en direct.
 */
async function runLiveTest() {
  console.log("🚀 Lancement du test d'intégration en direct pour bloXroute...");

  // --- Vérification des prérequis ---
  if (!process.env.PRIVATE_KEY || !process.env.HTTP_RPC_URL || !process.env.BLOXROUTE_AUTH_HEADER) {
    console.error("❌ Erreur: Les variables d'environnement PRIVATE_KEY, HTTP_RPC_URL, ou BLOXROUTE_AUTH_HEADER sont manquantes dans le fichier .env");
    return;
  }

  // --- Configuration d'Ethers avec de vraies données ---
  const provider = new ethers.JsonRpcProvider(process.env.HTTP_RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(FLASH_LOAN_CONTRACT_ADDRESS, FlashLoanABI, signer);

  console.log(`👤 Signer configuré pour l'adresse: ${signer.address}`);
  console.log(`📄 Contrat initialisé à l'adresse: ${await contract.getAddress()}`);

  // --- Définition des paramètres pour la transaction d'arbitrage ---
  // IMPORTANT: Ces paramètres doivent être valides pour que la transaction ne soit pas immédiatement rejetée.
  const loanAmountToken0 = ethers.parseUnits("10", 6); // Exemple: 10 USDT
  const loanAmountToken1 = 0n; // Pas de prêt en WBNB

  // Paramètres de swap (à adapter à une opportunité réelle pour un test complet)
  const swap1Params = {
    tokenIn: USDT_ADDRESS, // USDT
    tokenOut: WBNB_ADDRESS, // WBNB
    fee: 500, // 0.05%
    exchange: 1, // Uniswap
    amountOutMin: 0n // Pas de protection de slippage pour ce test
  };
  const swap2Params = {
    tokenIn: WBNB_ADDRESS, // WBNB
    tokenOut: USDT_ADDRESS, // USDT
    fee: 500, // 0.05%
    exchange: 0, // PancakeSwap
    amountOutMin: 0n
  };

  // --- Dépendances pour votre fonction ---
  const dependencies = {
    log: console.log, // On utilise console.log pour voir les messages
    sendEmailNotification: (subject, text) => {
      console.log(`--- EMAIL SIMULÉ ---`);
      console.log(`Sujet: ${subject}`);
      console.log(`Message: ${text}`);
      console.log(`--------------------`);
    },
    parseUnits: ethers.parseUnits,
  };

  // --- Appel de votre fonction avec les vrais composants ---
  console.log("\n▶️  Appel de executeFlashLoanArbitrage avec des données réelles...");
  await executeFlashLoanArbitrage(
    contract,
    dependencies,
    loanAmountToken0,
    loanAmountToken1,
    swap1Params,
    swap2Params
  );
}

// Lancement du script
runLiveTest().catch(error => {
  console.error("💥 Une erreur fatale est survenue lors de l'exécution du test:", error);
});