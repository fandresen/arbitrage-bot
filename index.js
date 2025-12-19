// index.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { parseUnits, formatUnits, JsonRpcProvider, ethers } = require("ethers");
const { Token } = require("@uniswap/sdk-core");
const { Pool } = require("@uniswap/v3-sdk");

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
  PANCAKESWAP_V3_FACTORY,
  PANCAKESWAP_V3_FEE_TIERS,
  PANCAKESWAP_V3_QUOTER_V2,
  UNISWAP_V3_FACTORY,
  UNISWAP_V3_QUOTER_V2,
  UNISWAP_V3_FEE_TIERS,
  FLASH_LOAN_CONTRACT_ADDRESS,
  UNISWAP_V3_TICKET_LENS,
  PANCAKESWAP_V3_TICKET_LENS
} = config;

// Import des utilitaires et ABIs
const { getV3PoolAddress, getV3PoolState, createV3Pool } = require("./utils/v3contracts");
const { calculatePriceV3,getAmountOutLocal } = require("./utils/calculations");
const { fetchTickData, createSDKPool } = require("./utils/poolData");
const { sendEmailNotification } = require("./utils/notifications");
const { sendSlackNotification } = require("./utils/slackNotifier");
const FlashLoanABI = require("./abis/FlashLoan.json").abi;
const { executeFlashLoanArbitrage } = require("./utils/executeArbitrageFlashLoan");

// --- Configuration et Variables Globales ---
let signer;
const flashLoanContractAddress = FLASH_LOAN_CONTRACT_ADDRESS;
let flashLoanContract;

const DEX = { PANCAKESWAP: 0, UNISWAP: 1 };

function log(...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...args);
}

// Stockage de l'état des pools en mémoire pour un accès instantané
const poolStates = {};

let pancakePoolSDK = null;
let uniPoolSDK = null;

// ABI pour décoder les données de l'événement Swap de Uniswap V3
const SWAP_EVENT_ABI = [
  { type: "int256", name: "amount0" },
  { type: "int256", name: "amount1" },
  { type: "uint160", name: "sqrtPriceX96" },
  { type: "uint128", name: "liquidity" },
  { type: "int24", name: "tick" },
];

let web3;
let ethersProvider;
let subscriptionPancakeV3 = null;
let subscriptionUniswapV3_005 = null;

let pancakeswapV3PoolAddress = "";
let uniswapUSDTBNB_005_PoolAddress = null;

// Instances de Token
const WBNB_TOKEN = new Token(56, WBNB_ADDRESS, TOKEN_DECIMALS[WBNB_ADDRESS.toLowerCase()], "WBNB", "Wrapped BNB");
const USDT_TOKEN = new Token(56, USDT_ADDRESS, TOKEN_DECIMALS[USDT_ADDRESS.toLowerCase()], "USDT", "Tether USD");

// Configuration des Logs CSV
const logDir = path.join(__dirname, "LOG");
const csvPath = path.join(logDir, "arbitrage_opportunities_v3_uni_v3.csv");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
if (!fs.existsSync(csvPath)) {
  fs.writeFileSync(
    csvPath,
    "timestamp,pancakeV3Price,uniswap005Price,profit_Uni_to_Pancake,profit_Pancake_to_Uni,difference_percent,loan_amount_usd\n",
    "utf8"
  );
}

let lastCallTime = 0;
const THROTTLE_INTERVAL_MS = 250;

// --- NOUVEAU : Configuration du Watchdog ---
let watchdogInterval = null;
let lastActivityTime = Date.now(); // Initialise au démarrage
const WATCHDOG_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const WATCHDOG_CHECK_INTERVAL_MS = 30 * 1000; // Vérifie toutes les 30 secondes

/**
 * Nettoie toutes les souscriptions WebSocket actives.
 */
function cleanupSubscriptions() {
  const subscriptions = [
    { sub: subscriptionPancakeV3, name: "PancakeSwap V3" },
    { sub: subscriptionUniswapV3_005, name: "Uniswap V3 (0.05%)" },
  ];
  subscriptions.forEach(({ sub, name }) => {
    if (sub) {
      sub.unsubscribe().then(success => {
        if (success) log(`✅ Unsubscribed from ${name} logs.`);
      }).catch(err => console.error(`❌ Error unsubscribing from ${name}:`, err));
    }
  });
  subscriptionPancakeV3 = null;
  subscriptionUniswapV3_005 = null;
}

/**
 * Initialise les fournisseurs et gère la reconnexion.
 */
function initializeProvidersAndSubscriptions() {
  if (!process.env.WS_RPC_URL || !process.env.HTTP_RPC_URL) {
    throw new Error("WS_RPC_URL or HTTP_RPC_URL not defined in .env file.");
  }
  ethersProvider = new JsonRpcProvider(process.env.HTTP_RPC_URL);

  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not defined in .env file.");
  }
  signer = new ethers.Wallet(process.env.PRIVATE_KEY, ethersProvider);
  flashLoanContract = new ethers.Contract(flashLoanContractAddress, FlashLoanABI, signer);
  log(`✅ Signer and Contract initialized for address: ${signer.address}`);

  if (web3 && web3.currentProvider && web3.currentProvider.connected) {
    log("Web3 WebSocketProvider is already connected.");
    return;
  }
  web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.WS_RPC_URL));

  web3.currentProvider.on("end", (event) => {
    log(`🔴 WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}. Attempting to reconnect...`);
    stopBot(); // Utilise stopBot pour un nettoyage complet
    setTimeout(() => {
      log("Re-initializing providers and restarting bot...");
      startBot();
    }, 5000);
  });
  web3.currentProvider.on("error", (error) => log("❌ WebSocket Error:", error.message));
  log(`✅ WebSocket connected to ${process.env.WS_RPC_URL}`);
}

/**
 * Charge les adresses des pools et leur état initial.
 */
async function loadPoolsAndInitialStates() {
  log("Loading pools and their initial states...");
  const loadPool = async (name, factory, tokenA, tokenB, fee) => {
    const address = await getV3PoolAddress(factory, tokenA, tokenB, fee, ethersProvider);
    if (!address) throw new Error(`❌ ${name} pool not found.`);
    log(`✅ ${name} Pool Found: ${address}`);
    const initialState = await getV3PoolState(address, ethersProvider);
    if (!initialState) throw new Error(`❌ Failed to fetch initial state for ${name}.`);
    poolStates[address.toLowerCase()] = initialState;
    log(`✅ Initial state for ${name} loaded. Tick: ${initialState.tick}`);
    return address;
  };

  pancakeswapV3PoolAddress = await loadPool("PancakeSwap V3", PANCAKESWAP_V3_FACTORY, WBNB_TOKEN, USDT_TOKEN, PANCAKESWAP_V3_FEE_TIERS.LOW);
  if (poolStates[pancakeswapV3PoolAddress.toLowerCase()]) {
      const state = poolStates[pancakeswapV3PoolAddress.toLowerCase()];
      const ticks = await fetchTickData(pancakeswapV3PoolAddress, state.tick, ethersProvider,PANCAKESWAP_V3_TICKET_LENS,PANCAKESWAP_V3_FEE_TIERS.LOW);
      pancakePoolSDK = createSDKPool(WBNB_TOKEN, USDT_TOKEN, PANCAKESWAP_V3_FEE_TIERS.LOW, state, ticks);
      log(`✅ Pancake SDK Pool created with ${ticks.length} ticks.`);
  }

  try {
    uniswapUSDTBNB_005_PoolAddress = await loadPool("Uniswap V3 0.05%", UNISWAP_V3_FACTORY, USDT_TOKEN, WBNB_TOKEN, UNISWAP_V3_FEE_TIERS.LOW);

    if (poolStates[uniswapUSDTBNB_005_PoolAddress.toLowerCase()]) {
        const state = poolStates[uniswapUSDTBNB_005_PoolAddress.toLowerCase()];
        const ticks = await fetchTickData(uniswapUSDTBNB_005_PoolAddress, state.tick, ethersProvider,UNISWAP_V3_TICKET_LENS,UNISWAP_V3_FEE_TIERS.LOW);
        uniPoolSDK = createSDKPool(USDT_TOKEN, WBNB_TOKEN, UNISWAP_V3_FEE_TIERS.LOW, state, ticks);
        log(`✅ Uniswap SDK Pool created with ${ticks.length} ticks.`);
    }
  } catch (e) {
    log(`⚠️ Could not load Uniswap V3 pool. Bot will run with limited capacity. Error: ${e.message}`);
  }
}

/**
 * Gestionnaire d'événements qui décode les logs et met à jour l'état en mémoire.
 */
async function handleSwapEvent(eventLog) {
  lastActivityTime = Date.now();
  const poolAddress = eventLog.address.toLowerCase();

  try {
    const decodedData = web3.eth.abi.decodeLog(SWAP_EVENT_ABI, eventLog.data, eventLog.topics.slice(1));
    
    // Mise à jour du state basique
    poolStates[poolAddress] = {
      sqrtPriceX96: decodedData.sqrtPriceX96,
      tick: Number(decodedData.tick),
      liquidity: decodedData.liquidity,
    };

    // --> NOUVEAU : Mise à jour de l'instance SDK concernée
    // On recrée l'instance Pool pour qu'elle prenne en compte le nouveau tick/prix
    // Note: On garde les mêmes ticksDataProvider car la liquidité immobile n'a pas changé (sauf si mint/burn, qu'on ignore pour l'instant)
    if (poolAddress === pancakeswapV3PoolAddress.toLowerCase() && pancakePoolSDK) {
         pancakePoolSDK = new Pool(
            pancakePoolSDK.token0, 
            pancakePoolSDK.token1, 
            pancakePoolSDK.fee,
            decodedData.sqrtPriceX96.toString(), 
            decodedData.liquidity.toString(), 
            Number(decodedData.tick),
            pancakePoolSDK.tickDataProvider // On réutilise les ticks chargés au démarrage
         );
    } 
    // 2. Mise à jour Uniswap
    else if (uniswapUSDTBNB_005_PoolAddress && poolAddress === uniswapUSDTBNB_005_PoolAddress.toLowerCase() && uniPoolSDK) {
         uniPoolSDK = new Pool(
            uniPoolSDK.token0, 
            uniPoolSDK.token1, 
            uniPoolSDK.fee,
            decodedData.sqrtPriceX96.toString(), 
            decodedData.liquidity.toString(), 
            Number(decodedData.tick),
            uniPoolSDK.tickDataProvider
         );
    }

    await checkArbitrageOpportunity();
  } catch (error) {
    log(`❌ Error decoding swap event:`, error.message);
  }
}

/**
 * Vérifie l'arbitrage en utilisant l'état en mémoire.
 */
async function checkArbitrageOpportunity() {
  const now = Date.now();
  if (now - lastCallTime < THROTTLE_INTERVAL_MS) return;
  lastCallTime = now;

  const pancakeState = poolStates[pancakeswapV3PoolAddress.toLowerCase()];
  const uniState = uniswapUSDTBNB_005_PoolAddress ? poolStates[uniswapUSDTBNB_005_PoolAddress.toLowerCase()] : null;
  if (!pancakeState || !uniState) return;

  const pancakeswapV3Price = calculatePriceV3(createV3Pool(WBNB_TOKEN, USDT_TOKEN, PANCAKESWAP_V3_FEE_TIERS.LOW, pancakeState.sqrtPriceX96, pancakeState.tick, pancakeState.liquidity), WBNB_TOKEN);
  const uniswap005Price = calculatePriceV3(createV3Pool(USDT_TOKEN, WBNB_TOKEN, UNISWAP_V3_FEE_TIERS.LOW, uniState.sqrtPriceX96, uniState.tick, uniState.liquidity), WBNB_TOKEN);
  if (!pancakeswapV3Price || !uniswap005Price) return;

  log(`➡️ Prices: PancakeSwap V3: ${pancakeswapV3Price.toFixed(4)} | Uniswap V3: ${uniswap005Price.toFixed(4)}`);

  // 1. Calcul des écarts en pourcentage
  // Prix A > Prix B ?
  const spreadUniToPancake = (pancakeswapV3Price - uniswap005Price) / uniswap005Price; // Si on achète Uni (bas) pour vendre Pancake (haut)
  const spreadPancakeToUni = (uniswap005Price - pancakeswapV3Price) / pancakeswapV3Price; // Si on achète Pancake (bas) pour vendre Uni (haut)

  // 2. Définition du seuil minimal de rentabilité (Break-even)
  // Il faut couvrir : Frais Flashloan + Frais Swap (Uni) + Frais Swap (Pancake)
  // Frais Flashloan = VENUS_FLASH_LOAN_FEE (ex: 0.05%)
  // Frais Swap = 0.05% * 2 = 0.1%
  // Marge de sécurité = 0.05%
  // Total estimé = ~0.20% (0.002)
  // On utilise une estimation conservatrice pour ne pas rater d'opportunités limites
  const MIN_SPREAD_REQUIRED = VENUS_FLASH_LOAN_FEE + 0.0015; // Flashloan + ~0.15% de frais de trading
  log(`MIN SPREAD = ${MIN_SPREAD_REQUIRED*100}%`);

  // 3. Vérification
  let potentialDirection = null;

  if (spreadUniToPancake > MIN_SPREAD_REQUIRED) {
      potentialDirection = "UniV3 -> PancakeV3";
      log(`👀 Spread intéressant détecté (${(spreadUniToPancake*100).toFixed(3)}%): ${potentialDirection}`);
  } else if (spreadPancakeToUni > MIN_SPREAD_REQUIRED) {
      potentialDirection = "PancakeV3 -> UniV3";
      log(`👀 Spread intéressant détecté (${(spreadPancakeToUni*100).toFixed(3)}%): ${potentialDirection}`);
  } else {
      // 🛑 ARRÊT IMMÉDIAT : Pas de différence de prix suffisante.
      // On ne lance pas la boucle coûteuse. On économise les appels RPC.
      log(` Spread PAS intéressant(${(spreadUniToPancake*100).toFixed(3)}%)`);
      return;
  }

  let bestOpp = { profit: -Infinity, loanAmountUSDT: 0n, bnbOut: 0n, finalUSDTOut: 0n, path: "" };
  const usdtDecimals = TOKEN_DECIMALS[USDT_ADDRESS.toLowerCase()];

  if (!pancakePoolSDK || !pancakePoolSDK.getOutputAmount) {
     log("⚠️ Pancake Pool SDK not ready yet.");
    return;
  }
  if (
    uniswapUSDTBNB_005_PoolAddress &&
    (!uniPoolSDK || !uniPoolSDK.getOutputAmount)
  ) {
     log("⚠️ Uniswap Pool SDK not ready yet.");
    return;
  }

  for (let loanAmountNum = MIN_LOAN_AMOUNT_USDT; loanAmountNum <= MAX_LOAN_AMOUNT_USDT; loanAmountNum += LOAN_AMOUNT_INCREMENT_USDT) {
    const currentLoanAmountUSDT = parseUnits(loanAmountNum.toString(), usdtDecimals);
    
    // Path: Uni -> Pancake
    // 1. Buy WBNB on Uniswap (Input: USDT)
    const bnbFromUni = await getAmountOutLocal(uniPoolSDK, USDT_TOKEN, currentLoanAmountUSDT);
    if (bnbFromUni) {
      // 2. Sell WBNB on Pancake (Input: WBNB)
      const usdtFromPancake = await getAmountOutLocal(pancakePoolSDK, WBNB_TOKEN, bnbFromUni);
      if (usdtFromPancake) {
        const profit = (parseFloat(formatUnits(usdtFromPancake, usdtDecimals)) - loanAmountNum) * (1 - VENUS_FLASH_LOAN_FEE);
        if (profit > bestOpp.profit) bestOpp = { profit, loanAmountUSDT: currentLoanAmountUSDT, bnbOut: bnbFromUni, finalUSDTOut: usdtFromPancake, path: "UniV3 -> PancakeV3" };
      }
    }

    // Path: Pancake -> Uni
    // 1. Buy WBNB on Pancake (Input: USDT)
    const bnbFromPancake = await getAmountOutLocal(pancakePoolSDK, USDT_TOKEN, currentLoanAmountUSDT);
    if (bnbFromPancake) {
      // 2. Sell WBNB on Uniswap (Input: WBNB)
      const usdtFromUni = await getAmountOutLocal(uniPoolSDK, WBNB_TOKEN, bnbFromPancake);
      if (usdtFromUni) {
        const profit = (parseFloat(formatUnits(usdtFromUni, usdtDecimals)) - loanAmountNum) * (1 - VENUS_FLASH_LOAN_FEE);
        if (profit > bestOpp.profit) bestOpp = { profit, loanAmountUSDT: currentLoanAmountUSDT, bnbOut: bnbFromPancake, finalUSDTOut: usdtFromUni, path: "PancakeV3 -> UniV3" };
      }
    }
  }

  // --- Log CSV ---
  const timestampForCsv = new Date().toISOString();
  const differencePercent = Math.abs((100 - (pancakeswapV3Price * 100) / uniswap005Price).toFixed(3));
  let profitUniToPancake = 0;
  let profitPancakeToUni = 0;
  if (bestOpp.path === "UniV3 -> PancakeV3") {
    profitUniToPancake = bestOpp.profit;
  } else if (bestOpp.path === "PancakeV3 -> UniV3") {
    profitPancakeToUni = bestOpp.profit;
  }
  const loanAmountForCsv = bestOpp.loanAmountUSDT > 0n ? formatUnits(bestOpp.loanAmountUSDT, usdtDecimals) : "0";
  const csvRow = `${timestampForCsv},${pancakeswapV3Price.toFixed(2)},${uniswap005Price.toFixed(2)},${profitUniToPancake.toFixed(2)},${profitPancakeToUni.toFixed(2)},${differencePercent},${parseFloat(loanAmountForCsv).toFixed(0)}\n`;
  fs.appendFile(csvPath, csvRow, (err) => {
    if (err) log("❌ Error writing to CSV:", err);
  });
  
  if (bestOpp.profit > PROFIT_THRESHOLD_USD) {
    const loanAmountStr = formatUnits(bestOpp.loanAmountUSDT, usdtDecimals);
    const msg = `💰 EXECUTION: ${bestOpp.path} | Profit: ${bestOpp.profit.toFixed(4)} USD | Loan: ${loanAmountStr} USD`;
    log(msg);
    sendSlackNotification(`Arbitrage Triggered (${bestOpp.path})\n${msg}`, "info");

    const amountOutMinWBNB = 0n;
    const amountOutMinUSDT = 0n;

    const isUniFirst = bestOpp.path.startsWith("Uni");
    const swap1Params = { tokenIn: USDT_ADDRESS, tokenOut: WBNB_ADDRESS, fee: isUniFirst ? UNISWAP_V3_FEE_TIERS.LOW : PANCAKESWAP_V3_FEE_TIERS.LOW, exchange: isUniFirst ? DEX.UNISWAP : DEX.PANCAKESWAP, amountOutMin: amountOutMinWBNB };
    const swap2Params = { tokenIn: WBNB_ADDRESS, tokenOut: USDT_ADDRESS, fee: isUniFirst ? PANCAKESWAP_V3_FEE_TIERS.LOW : UNISWAP_V3_FEE_TIERS.LOW, exchange: isUniFirst ? DEX.PANCAKESWAP : DEX.UNISWAP, amountOutMin: amountOutMinUSDT };

    await executeFlashLoanArbitrage(
        flashLoanContract,
        { log, sendEmailNotification, sendSlackNotification, parseUnits }, 
        bestOpp.loanAmountUSDT,
        0n,
        swap1Params,
        swap2Params,
        bestOpp
    );
  } else {
     log(`💤 No profitable opportunity found. Best path profit: ${bestOpp.profit.toFixed(4)} USD.`);
  }
}

/**
 * --- NOUVEAU : Démarre le watchdog pour surveiller l'activité. ---
 */
function startWatchdog() {
  log("🐶 Watchdog activé. Vérification de l'activité toutes les 30 secondes...");
  // S'assurer qu'il n'y a pas d'intervalle précédent qui tourne
  if (watchdogInterval) clearInterval(watchdogInterval);

  watchdogInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTime;

    if (timeSinceLastActivity > WATCHDOG_TIMEOUT_MS) {
      log(`🔴 Inactivité détectée depuis plus de 5 minutes. Redémarrage du bot...`);
      // Arrêter le watchdog actuel pour éviter des redémarrages multiples
      clearInterval(watchdogInterval);
      watchdogInterval = null; 

      // Procédure de redémarrage
      stopBot(); // Nettoie les connexions
      setTimeout(() => {
        log("🔄 Tentative de redémarrage du bot après inactivité.");
        startBot(); // Relance le bot
      }, 2000); // Petit délai pour s'assurer que tout est bien fermé
    }
  }, WATCHDOG_CHECK_INTERVAL_MS);
}

/**
 * Démarre le bot.
 */
async function startBot() {
  try {
    initializeProvidersAndSubscriptions();
    await loadPoolsAndInitialStates();
    const SWAP_EVENT_TOPIC_V3 = web3.utils.sha3("Swap(address,address,int256,int256,uint160,uint128,int24)");
    log("🚀 Bot started. Listening for swaps...");

    if (pancakeswapV3PoolAddress) {
      subscriptionPancakeV3 = await web3.eth.subscribe("logs", { topics: [SWAP_EVENT_TOPIC_V3], address: [pancakeswapV3PoolAddress] });
      if (subscriptionPancakeV3) {
        subscriptionPancakeV3.on("data", handleSwapEvent);
        subscriptionPancakeV3.on("error", (err) => log("❌ PancakeSwap V3 sub error:", err.message));
      } else {
        throw new Error("Failed to create PancakeSwap V3 subscription.");
      }
    }
    
    if (uniswapUSDTBNB_005_PoolAddress) {
      subscriptionUniswapV3_005 = await web3.eth.subscribe("logs", { topics: [SWAP_EVENT_TOPIC_V3], address: [uniswapUSDTBNB_005_PoolAddress] });
      if (subscriptionUniswapV3_005) {
        subscriptionUniswapV3_005.on("data", handleSwapEvent);
        subscriptionUniswapV3_005.on("error", (err) => log("❌ Uniswap V3 sub error:", err.message));
      } else {
        throw new Error("Failed to create Uniswap V3 subscription.");
      }
    }

    // --- NOUVEAU : Démarrer le watchdog une fois que tout est initialisé ---
    startWatchdog();

  } catch (err) {
    log(`❌ Fatal error during bot startup: ${err.message}`);
    log("Retrying in 10 seconds...");
    setTimeout(startBot, 10000);
  }
}

/**
 * Arrête proprement le bot et ferme les connexions.
 */
function stopBot() {
    log("Stopping bot...");
    
    // --- NOUVEAU : Arrêter le watchdog pour éviter les faux positifs ---
    if (watchdogInterval) {
        clearInterval(watchdogInterval);
        watchdogInterval = null;
        log("🐶 Watchdog désactivé.");
    }
    
    cleanupSubscriptions();
    if (web3 && web3.currentProvider && web3.currentProvider.disconnect) {
        web3.currentProvider.disconnect();
        log("🔴 WebSocket connection closed.");
    }
}

// Lancement
startBot();

// Gestion de la fermeture propre (CTRL+C)
process.on("SIGINT", () => {
    stopBot();
    process.exit(0);
});