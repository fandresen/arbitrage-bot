// main.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { parseUnits, formatUnits, JsonRpcProvider } = require("ethers");
const { Token, ChainId } = require('@uniswap/sdk-core'); 

// Import de la configuration
const config = require("./config");
const {
  WBNB_ADDRESS,
  USDT_ADDRESS,
  TOKEN_DECIMALS,
  PROFIT_THRESHOLD_USD,
  VENUS_FLASH_LOAN_FEE,
  MAX_LOAN_AMOUNT_USDT,
  LOAN_AMOUNT_INCREMENT_USDT,
  MIN_LOAN_AMOUNT_USDT,
  PANCAKESWAP_V2_FACTORY,
  PANCAKESWAP_V2_ROUTER, // Nouveau
  PANCAKESWAP_V2_FEE,
  PANCAKESWAP_V3_FACTORY,
  PANCAKESWAP_V3_ROUTER, // Nouveau
  PANCAKESWAP_V3_FEE_TIERS,
  EMAIL_CONFIG,
} = config;

// Import des utilitaires V2 existants
const { getPairAddress, getReserves } = require("./utils/contracts");
// Import des nouveaux utilitaires V3
const { getV3PoolAddress, getV3PoolState, createV3Pool } = require("./utils/v3contracts");
// Import des calculs mis à jour
const { getAmountOutV2, calculatePriceV2, getAmountOutV3, calculatePriceV3 } = require("./utils/calculations");
const { sendEmailNotification } = require("./utils/notifications");

// --- Configuration du Logger ---
function log(...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...args);
}

// --- Variables Globales pour les Instances et Souscriptions ---
let web3; // Déclaré avec let pour pouvoir être réassigné lors de la reconnexion
let ethersProvider; // Déclaré avec let
let subscriptionV2 = null; // Renommé pour clarté
let subscriptionV3 = null; // Renommé pour clarté

let pancakeswapV2PairAddress = "";
let pancakeswapV3PoolAddress = "";
const pairsToMonitor = new Set();

// Instances de Token pour le SDK V3
const WBNB_TOKEN = new Token(56, WBNB_ADDRESS, TOKEN_DECIMALS[WBNB_ADDRESS.toLowerCase()], 'WBNB', 'Wrapped BNB');
// console.log(`[DEBUG_INDEX] WBNB Token object:`, WBNB_TOKEN); 
// console.log(`[DEBUG_INDEX] WBNB Address:`, WBNB_TOKEN.address);

const USDT_TOKEN = new Token(56, USDT_ADDRESS, TOKEN_DECIMALS[USDT_ADDRESS.toLowerCase()], 'USDT', 'Tether USD');
// console.log(`[DEBUG_INDEX] USDT Token object:`, USDT_TOKEN); 
// console.log(`[DEBUG_INDEX] USDT Address:`, USDT_TOKEN.address);

// --- Configuration des Logs CSV ---
const logDir = path.join(__dirname, "LOG");
const csvPath = path.join(logDir, "arbitrage_opportunities_v2_v3.csv");

if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
if (!fs.existsSync(csvPath)) {
  fs.writeFileSync(csvPath, "timestamp,pancakeV2Price,pancakeV3Price,diff_V3_over_V2,diff_V2_over_V3,net_profit_usd_V2_to_V3,loan_amount_usd_V2_to_V3,net_profit_usd_V3_to_V2,loan_amount_usd_V3_to_V2\n", "utf8");
}

// --- Rate Limiting variables ---
let lastCallTime = 0;
const THROTTLE_INTERVAL_MS = 1000; // 100ms = 10 requests per second (1000ms / 10 requests)

// --- Fonctions Principales ---

/**
 * Initialise Web3 (pour WebSocket) et EthersProvider (pour HTTP/HTTPS).
 * Gère également la logique de reconnexion WebSocket.
 */
function initializeProvidersAndSubscriptions() {
  // Vérification des variables d'environnement
  if (!process.env.WS_RPC_URL) {
    throw new Error("WS_RPC_URL non définie dans le fichier .env. Veuillez la configurer.");
  }
  if (!process.env.HTTP_RPC_URL) {
    throw new Error("HTTP_RPC_URL non définie dans le fichier .env. Veuillez la configurer.");
  }

  // Initialisation d'ethers.js avec un JsonRpcProvider (HTTP/HTTPS) pour les appels de contrats
  ethersProvider = new JsonRpcProvider(process.env.HTTP_RPC_URL);

  // Initialisation de Web3 avec un WebSocketProvider pour les souscriptions d'événements
  if (web3 && web3.currentProvider && web3.currentProvider.connected) {
    log("Web3 WebSocketProvider déjà connecté. Pas de réinitialisation.");
    return;
  }

  web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.WS_RPC_URL));

  // Gérer la reconnexion du WebSocket
  web3.currentProvider.on('end', (event) => {
    log(`🔴 WebSocket déconnecté. Code: ${event.code}, Raison: ${event.reason}. Tentative de reconnexion...`);
    // Annuler les souscriptions existantes pour éviter les fuites de mémoire
    if (subscriptionV2) {
      subscriptionV2.unsubscribe((error, success) => {
        if (success) log('✅ Unsubscribed des logs V2.');
        else console.error('❌ Erreur lors de l\'unsubscribe V2:', error);
      }).catch(err => {
        console.error("❌ Erreur lors de l'unsubscribe V2 (catch):", err);
      });
      subscriptionV2 = null;
    }
    if (subscriptionV3) {
      subscriptionV3.unsubscribe((error, success) => {
        if (success) log('✅ Unsubscribed des logs V3.');
        else console.error('❌ Erreur lors de l\'unsubscribe V3:', error);
      }).catch(err => {
        console.error("❌ Erreur lors de l'unsubscribe V3 (catch):", err);
      });
      subscriptionV3 = null;
    }

    // Réinitialiser le provider et redémarrer le bot après un délai
    setTimeout(() => {
      log("Tentative de reconnexion du WebSocket et de redémarrage du bot...");
      initializeProvidersAndSubscriptions(); // Réinitialise les providers
      startBot(); // Redémarre le bot pour ré-attacher les listeners
    }, 5000); // Tente de se reconnecter après 5 secondes
  });

  web3.currentProvider.on('error', (error) => {
    log("❌ Erreur WebSocket:", error);
  });

  log(`✅ WebSocket connecté à ${process.env.WS_RPC_URL}`);
}

/**
 * Charge les adresses des paires BNB/USDT sur PancakeSwap V2 et V3.
 * @throws {Error} Si l'une des adresses de paire est invalide.
 */
async function loadPairAddresses() {
  log("Chargement des adresses des paires BNB/USDT...");

  // PancakeSwap V2
  pancakeswapV2PairAddress = await getPairAddress(PANCAKESWAP_V2_FACTORY, USDT_ADDRESS, WBNB_ADDRESS, web3);
  if (!pancakeswapV2PairAddress) {
    throw new Error("❌ Erreur : PancakeSwap V2 paire BNB/USDT introuvable ou invalide.");
  }
  pairsToMonitor.add(pancakeswapV2PairAddress.toLowerCase());
  log(`✅ PancakeSwap V2 BNB/USDT Pair: ${pancakeswapV2PairAddress}`);

  // PancakeSwap V3 (Utilisons le tier de frais LOW/0.05%)
  const v3FeeTierUsed = PANCAKESWAP_V3_FEE_TIERS.LOW; // Déclarez la variable ici
  pancakeswapV3PoolAddress = await getV3PoolAddress(
    PANCAKESWAP_V3_FACTORY,
    WBNB_TOKEN,
    USDT_TOKEN,
    v3FeeTierUsed, // Utiliser la variable pour le bon tier de frais
    ethersProvider
  );
  if (!pancakeswapV3PoolAddress) {
    // Utilisez la variable v3FeeTierUsed dans le message d'erreur
    throw new Error(`❌ Erreur : PancakeSwap V3 pool BNB/USDT (${v3FeeTierUsed / 100}% frais) introuvable ou invalide.`);
  }
  pairsToMonitor.add(pancakeswapV3PoolAddress.toLowerCase());
  // Utilisez la variable v3FeeTierUsed dans le message de succès
  log(`✅ PancakeSwap V3 BNB/USDT Pool (${v3FeeTierUsed / 100}%): ${pancakeswapV3PoolAddress}`);
}

/**
 * Vérifie les opportunités d'arbitrage entre PancakeSwap V2 et PancakeSwap V3 pour la paire BNB/USDT.
 */
async function checkArbitrageOpportunity() {
  const now = Date.now();
  if (now - lastCallTime < THROTTLE_INTERVAL_MS) {
    // log("⏩ Saut de la vérification d'arbitrage: Trop de requêtes.");
    return; // Ne pas exécuter si l'intervalle n'est pas passé
  }
  lastCallTime = now;

  log("🔍 Vérification des opportunités d'arbitrage BNB/USDT entre PancakeSwap V2 et V3...");

  // --- Récupération des réserves/état pour V2 ---
  const pancakeswapV2Reserves = await getReserves(pancakeswapV2PairAddress, web3);
  if (!pancakeswapV2Reserves) {
    log("⚠️ Réserves PancakeSwap V2 manquantes. Impossible de vérifier l'arbitrage.");
    return;
  }
  const pancakeswapV2PriceUSDTPerWBNB = calculatePriceV2(
    pancakeswapV2Reserves,
    WBNB_ADDRESS,
    USDT_ADDRESS,
    TOKEN_DECIMALS,
    PANCAKESWAP_V2_FEE
  );

  // --- Récupération de l'état pour V3 ---
  const pancakeswapV3PoolState = await getV3PoolState(pancakeswapV3PoolAddress, ethersProvider);
  if (!pancakeswapV3PoolState) {
    log("⚠️ État PancakeSwap V3 pool manquant. Impossible de vérifier l'arbitrage.");
    return;
  }
  // Créer une instance de Pool V3 pour les calculs du SDK (en utilisant le V3_FEE_TIERS.LOW)
  const v3FeeTierForCalc = PANCAKESWAP_V3_FEE_TIERS.LOW;
  const pancakeswapV3Pool = createV3Pool(
    WBNB_TOKEN,
    USDT_TOKEN,
    v3FeeTierForCalc, // Assurez-vous que c'est le même tier que celui utilisé pour getV3PoolAddress
    pancakeswapV3PoolState.sqrtPriceX96,
    pancakeswapV3PoolState.tick,
    pancakeswapV3PoolState.liquidity
  );
  const pancakeswapV3PriceUSDTPerWBNB = calculatePriceV3(pancakeswapV3Pool);


  if (!pancakeswapV2PriceUSDTPerWBNB || !pancakeswapV3PriceUSDTPerWBNB) {
    log("❌ Erreur de calcul des prix. Impossible de vérifier l'arbitrage.");
    return;
  }

  log(`➡️ Prix PancakeSwap V2: ${pancakeswapV2PriceUSDTPerWBNB} USDT/BNB`);
  // Corrigez le message de log pour V3
  log(`➡️ Prix PancakeSwap V3: ${pancakeswapV3PriceUSDTPerWBNB.toFixed(6)} USDT/BNB (frais: ${v3FeeTierForCalc / 100}%)`);

  // --- Initialisation des variables pour les meilleurs profits et montants ---
  let bestProfitUSD_Scenario1 = -Infinity; // Scenario 1: Acheter V2 -> Vendre V3
  let bestLoanAmount_Scenario1_USDT = 0n;

  let bestProfitUSD_Scenario2 = -Infinity; // Scenario 2: Acheter V3 -> Vendre V2
  let bestLoanAmount_Scenario2_USDT = 0n;

  const usdtDecimals = TOKEN_DECIMALS[USDT_ADDRESS.toLowerCase()];

  // --- Itération pour trouver le meilleur profit ---
  for (let loanAmountNum = MIN_LOAN_AMOUNT_USDT; loanAmountNum <= MAX_LOAN_AMOUNT_USDT; loanAmountNum += LOAN_AMOUNT_INCREMENT_USDT) {
    const currentLoanAmountUSDT = parseUnits(loanAmountNum.toString(), usdtDecimals);
    const flashLoanCost = (currentLoanAmountUSDT * BigInt(Math.round(VENUS_FLASH_LOAN_FEE * 1_000_000))) / 1_000_000n;

    // --- SCÉNARIO 1: Acheter BNB sur PancakeSwap V2, Vendre sur PancakeSwap V3 ---
    // Condition: V2 est moins cher que V3
    if (pancakeswapV2PriceUSDTPerWBNB < pancakeswapV3PriceUSDTPerWBNB) {
        // Simuler achat de BNB sur V2
        const wbnbReceivedFromV2 = getAmountOutV2(
            currentLoanAmountUSDT,
            pancakeswapV2Reserves.token0Address.toLowerCase() === USDT_ADDRESS.toLowerCase() ? pancakeswapV2Reserves.reserve0 : pancakeswapV2Reserves.reserve1,
            pancakeswapV2Reserves.token0Address.toLowerCase() === WBNB_ADDRESS.toLowerCase() ? pancakeswapV2Reserves.reserve0 : pancakeswapV2Reserves.reserve1,
            PANCAKESWAP_V2_FEE
        );

    // console.log(`[DEBUG_CALL_SCENARIO1] Appel de getAmountOutV3 avec:`);
    // console.log(`[DEBUG_CALL_SCENARIO1]   tokenIn.address (WBNB_TOKEN avant l'appel): ${WBNB_TOKEN ? WBNB_TOKEN.address : 'UNDEFINED_WBNB_TOKEN_PASSED'}`);
    // console.log(`[DEBUG_CALL_SCENARIO1]   tokenOut.address (USDT_TOKEN avant l'appel): ${USDT_TOKEN ? USDT_TOKEN.address : 'UNDEFINED_USDT_TOKEN_PASSED'}`);
  
        // Simuler vente de BNB sur V3
        const finalUSDTFromV3 = await getAmountOutV3(
            wbnbReceivedFromV2,    // amountIn : On vend du WBNB (reçu de V2)
            pancakeswapV3Pool,     // pool     : La pool V3
            WBNB_TOKEN,            // tokenIn  : On vend du WBNB
            USDT_TOKEN,            // tokenOut : On reçoit de l'USDT
            ethersProvider         // provider : Le provider ethers.js
        );

        const netProfitUSDT_Current = finalUSDTFromV3 - currentLoanAmountUSDT - flashLoanCost;
        const netProfitUSD_Current = Number(formatUnits(netProfitUSDT_Current.toString(), usdtDecimals));

        if (netProfitUSD_Current > bestProfitUSD_Scenario1) {
            bestProfitUSD_Scenario1 = netProfitUSD_Current;
            bestLoanAmount_Scenario1_USDT = currentLoanAmountUSDT;
        }
    }

    // --- SCÉNARIO 2: Acheter BNB sur PancakeSwap V3, Vendre sur PancakeSwap V2 ---
    // Condition: V3 est moins cher que V2
    if (pancakeswapV3PriceUSDTPerWBNB < pancakeswapV2PriceUSDTPerWBNB) {

    // console.log(`[DEBUG_CALL_SCENARIO1] Appel de getAmountOutV3 avec:`);
    // console.log(`[DEBUG_CALL_SCENARIO1]   tokenIn.address (WBNB_TOKEN avant l'appel): ${WBNB_TOKEN ? WBNB_TOKEN.address : 'UNDEFINED_WBNB_TOKEN_PASSED'}`);
    // console.log(`[DEBUG_CALL_SCENARIO1]   tokenOut.address (USDT_TOKEN avant l'appel): ${USDT_TOKEN ? USDT_TOKEN.address : 'UNDEFINED_USDT_TOKEN_PASSED'}`);
  
        // Simuler achat de BNB sur V3
        const wbnbReceivedFromV3 = await getAmountOutV3(
            currentLoanAmountUSDT, // amountIn : On vend de l'USDT (montant du prêt)
            pancakeswapV3Pool,     // pool     : La pool V3
            USDT_TOKEN,            // tokenIn  : On vend de l'USDT
            WBNB_TOKEN,            // tokenOut : On reçoit du WBNB
            ethersProvider         // provider : Le provider ethers.js
        );

        // Simuler vente de BNB sur V2
        const finalUSDTFromV2 = getAmountOutV2(
            wbnbReceivedFromV3,
            pancakeswapV2Reserves.token0Address.toLowerCase() === WBNB_ADDRESS.toLowerCase() ? pancakeswapV2Reserves.reserve0 : pancakeswapV2Reserves.reserve1,
            pancakeswapV2Reserves.token0Address.toLowerCase() === USDT_ADDRESS.toLowerCase() ? pancakeswapV2Reserves.reserve0 : pancakeswapV2Reserves.reserve1,
            PANCAKESWAP_V2_FEE
        );

        const netProfitUSDT_Current = finalUSDTFromV2 - currentLoanAmountUSDT - flashLoanCost;
        const netProfitUSD_Current = Number(formatUnits(netProfitUSDT_Current.toString(), usdtDecimals));

        if (netProfitUSD_Current > bestProfitUSD_Scenario2) {
            bestProfitUSD_Scenario2 = netProfitUSD_Current;
            bestLoanAmount_Scenario2_USDT = currentLoanAmountUSDT;
        }
    }
  }

  // --- Enregistrement des données et Notification ---
  const timestampForCsv = new Date().toISOString(); // Use a distinct variable name
  const diffV3OverV2 = ((pancakeswapV3PriceUSDTPerWBNB - pancakeswapV2PriceUSDTPerWBNB) / pancakeswapV2PriceUSDTPerWBNB) * 100;
  const diffV2OverV3 = ((pancakeswapV2PriceUSDTPerWBNB - pancakeswapV3PriceUSDTPerWBNB) / pancakeswapV3PriceUSDTPerWBNB) * 100;

  const bestLoanAmountUSD_Scenario1 = Number(formatUnits(bestLoanAmount_Scenario1_USDT.toString(), usdtDecimals));
  const bestLoanAmountUSD_Scenario2 = Number(formatUnits(bestLoanAmount_Scenario2_USDT.toString(), usdtDecimals));

  const csvRow = `${timestampForCsv},${pancakeswapV2PriceUSDTPerWBNB},${pancakeswapV3PriceUSDTPerWBNB.toFixed(6)},${diffV3OverV2.toFixed(4)},${diffV2OverV3.toFixed(4)},${bestProfitUSD_Scenario1.toFixed(4)},${bestLoanAmountUSD_Scenario1.toFixed(0)},${bestProfitUSD_Scenario2.toFixed(4)},${bestLoanAmountUSD_Scenario2.toFixed(0)}\n`;
  fs.appendFile(csvPath, csvRow, (err) => {
    if (err) log("❌ Erreur lors de l'écriture CSV:", err);
  });

  // Logique de notification
  if (bestProfitUSD_Scenario1 > PROFIT_THRESHOLD_USD && bestProfitUSD_Scenario1 >= bestProfitUSD_Scenario2) {
    const msg = `💰 OPPORTUNITÉ DÉTECTÉE: Acheter BNB sur PancakeSwap V2, Vendre sur PancakeSwap V3 | Profit Optimal: ${bestProfitUSD_Scenario1.toFixed(4)} USDT | Montant du Prêt Optimal: ${bestLoanAmountUSD_Scenario1.toFixed(0)} USDT`;
    log(msg);
    sendEmailNotification("Arbitrage (V2 to V3) - Optimal", msg);
    // Ici, vous déclencheriez l'appel à votre smart contract d'arbitrage
    // executeArbitrage(USDT_ADDRESS, WBNB_ADDRESS, 'V2_TO_V3', bestLoanAmount_Scenario1_USDT);
  } else if (bestProfitUSD_Scenario2 > PROFIT_THRESHOLD_USD && bestProfitUSD_Scenario2 > bestProfitUSD_Scenario1) {
    const msg = `💰 OPPORTUNITÉ DÉTECTÉE: Acheter BNB sur PancakeSwap V3, Vendre sur PancakeSwap V2 | Profit Optimal: ${bestProfitUSD_Scenario2.toFixed(4)} USDT | Montant du Prêt Optimal: ${bestLoanAmountUSD_Scenario2.toFixed(0)} USDT`;
    log(msg);
    sendEmailNotification("Arbitrage (V3 to V2) - Optimal", msg);
    // Ici, vous déclencheriez l'appel à votre smart contract d'arbitrage
    // executeArbitrage(USDT_ADDRESS, WBNB_ADDRESS, 'V3_TO_V2', bestLoanAmount_Scenario2_USDT);
  } else {
    log(`💤 Aucune opportunité d'arbitrage rentable (profit > $${PROFIT_THRESHOLD_USD}) après optimisation.`);
  }
}

/**
 * Démarre le bot en souscrivant aux événements de swap.
 */
async function startBot() {
  initializeProvidersAndSubscriptions(); // Initialise les providers et la logique de reconnexion

  // Définir les topics d'événements ICI après l'initialisation de 'web3'
  const SWAP_EVENT_TOPIC = web3.utils.sha3("Swap(address,uint256,uint256,uint256,uint256,address)"); // Pour V2
  const V3_SWAP_EVENT_TOPIC = web3.utils.sha3("Swap(address,address,int256,int256,uint160,uint128,int24)"); // Pour V3


  await loadPairAddresses();
  log("🚀 Bot lancé. Écoute des swaps sur PancakeSwap V2 et V3...");

  try {
    // Souscription aux événements V2
    subscriptionV2 = await web3.eth.subscribe('logs', {
      topics: [SWAP_EVENT_TOPIC],
      address: [pancakeswapV2PairAddress]
    });

    subscriptionV2.on('data', async (logData) => {
      // log(`🔄 Swap V2 détecté sur ${logData.address} (bloc ${logData.blockNumber})`);
      await checkArbitrageOpportunity();
    });
    subscriptionV2.on('error', (error) => {
      log("❌ Erreur de souscription V2:", error);
    });

    // Souscription aux événements V3
    subscriptionV3 = await web3.eth.subscribe('logs', {
      topics: [V3_SWAP_EVENT_TOPIC],
      address: [pancakeswapV3PoolAddress]
    });

    subscriptionV3.on('data', async (logData) => {
      log(`🔄 Swap V3 détecté sur ${logData.address} (bloc ${logData.blockNumber})`);
      await checkArbitrageOpportunity();
    });
    subscriptionV3.on('error', (error) => {
      log("❌ Erreur de souscription V3:", error);
    });

  } catch (err) {
    log("❌ Erreur fatale lors du démarrage du bot:", err);
    setTimeout(() => startBot(), 10000);
  }
}

/**
 * Arrête la souscription WebSocket et ferme la connexion.
 */
function stopBot() {
  if (subscriptionV2) {
    subscriptionV2.unsubscribe((error, success) => {
      if (success) log('✅ Unsubscribed des logs V2.');
      else console.error('❌ Erreur lors de l\'unsubscribe V2:', error);
    }).catch(err => console.error("❌ Erreur lors de l'unsubscribe V2 (catch):", err));
  }
  if (subscriptionV3) {
    subscriptionV3.unsubscribe((error, success) => {
      if (success) log('✅ Unsubscribed des logs V3.');
      else console.error('❌ Erreur lors de l\'unsubscribe V3:', error);
    }).catch(err => console.error("❌ Erreur lors de l'unsubscribe V3 (catch):", err));
  }

  if (web3 && web3.currentProvider && web3.currentProvider.connected) {
    web3.currentProvider.disconnect();
    log('🔴 WebSocket fermé.');
  }
}

// Lancer le bot
startBot();

// --- Exports pour les tests (si nécessaire) ---
module.exports = {
  web3,
  ethersProvider,
  startBot,
  stopBot,
  loadPairAddresses,
  checkArbitrageOpportunity,
  getAmountOutV2,
  calculatePriceV2,
  getAmountOutV3,
  calculatePriceV3,
  getPancakeSwapV2PairAddress: () => pancakeswapV2PairAddress,
  getPancakeSwapV3PoolAddress: () => pancakeswapV3PoolAddress,
};