// index.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { parseUnits, formatUnits, JsonRpcProvider, ethers } = require("ethers");
const { Token } = require("@uniswap/sdk-core");

const rpcManager = require("./utils/rpcManager");
global.stopBot = stopBot;
global.startBot = startBot;

// Import de la configuration
const config = require("./config");
const {
  WBNB_ADDRESS,
  USDT_ADDRESS,
  TOKEN_DECIMALS,
  PROFIT_THRESHOLD_USD,
  VENUS_FLASH_LOAN_FEE,
  MAX_LOAN_AMOUNT_USDT,
  PANCAKESWAP_V3_FACTORY,
  PANCAKESWAP_V3_FEE_TIERS,
  PANCAKESWAP_V3_QUOTER_V2,
  UNISWAP_V3_FACTORY,
  UNISWAP_V3_QUOTER_V2,
  RPC_ENDPOINTS,
  UNISWAP_V3_FEE_TIERS,
  FLASH_LOAN_CONTRACT_ADDRESS,
} = config;

// Import des utilitaires et ABIs
const {
  getV3PoolAddress,
  getV3PoolState,
  createV3Pool,
} = require("./utils/v3contracts");
const { getAmountOutV3, calculatePriceV3 } = require("./utils/calculations");
const { sendEmailNotification } = require("./utils/notifications");
const { sendSlackNotification } = require("./utils/slackNotifier");
const FlashLoanABI = require("./abis/FlashLoan.json").abi;
const {
  executeFlashLoanArbitrage,
} = require("./utils/executeArbitrageFlashLoan");

// --- Configuration et Variables Globales ---
let signer;
const flashLoanContractAddress = FLASH_LOAN_CONTRACT_ADDRESS;
let flashLoanContract;

let restartTimer = null;

const DEX = { PANCAKESWAP: 0, UNISWAP: 1 };

function log(...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...args);
}

// Stockage de l'état des pools en mémoire pour un accès instantané
const poolStates = {};

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
const WBNB_TOKEN = new Token(
  56,
  WBNB_ADDRESS,
  TOKEN_DECIMALS[WBNB_ADDRESS.toLowerCase()],
  "WBNB",
  "Wrapped BNB",
);
const USDT_TOKEN = new Token(
  56,
  USDT_ADDRESS,
  TOKEN_DECIMALS[USDT_ADDRESS.toLowerCase()],
  "USDT",
  "Tether USD",
);

// Configuration des Logs CSV
const logDir = path.join(__dirname, "LOG");
const csvPath = path.join(logDir, "arbitrage_opportunities_v3_uni_v3.csv");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
if (!fs.existsSync(csvPath)) {
  fs.writeFileSync(
    csvPath,
    "timestamp,pancakeV3Price,uniswap005Price,profit_Uni_to_Pancake,profit_Pancake_to_Uni,difference_percent,loan_amount_usd\n",
    "utf8",
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
      sub
        .unsubscribe()
        .then((success) => {
          if (success) log(`✅ Unsubscribed from ${name} logs.`);
        })
        .catch((err) =>
          console.error(`❌ Error unsubscribing from ${name}:`, err),
        );
    }
  });
  subscriptionPancakeV3 = null;
  subscriptionUniswapV3_005 = null;
}

/**
 * Initialise les fournisseurs et gère la reconnexion avec failover RPC.
 */

function initializeProvidersAndSubscriptions() {
  if (!config.RPC_ENDPOINTS || config.RPC_ENDPOINTS.length === 0) {
    throw new Error("❌ Aucun RPC_ENDPOINTS défini dans config.js");
  }

  rpcManager.initRpcList(config.RPC_ENDPOINTS);

  // HTTP Provider (ethers)
  ethersProvider = rpcManager.createHttpProvider();

  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not defined in .env file.");
  }
  signer = new ethers.Wallet(process.env.PRIVATE_KEY, ethersProvider);
  flashLoanContract = new ethers.Contract(
    flashLoanContractAddress,
    FlashLoanABI,
    signer,
  );
  log(
    `✅ Signer & Contract initialized on RPC: ${rpcManager.getCurrentRpc().name}`,
  );

  // WebSocket Provider (web3)
  if (web3 && web3.currentProvider && web3.currentProvider.connected) {
    log("Web3 WebSocket déjà connecté.");
    return;
  }

  web3 = new Web3(rpcManager.createWsProvider());

  web3.currentProvider.on("end", (event) => {
    log(
      `🔴 WebSocket disconnected (code: ${event.code}). Tentative de switch RPC...`,
    );
    rpcManager.switchToNextRpc();
  });

  web3.currentProvider.on("error", (error) => {
    log(`❌ WebSocket Error: ${error.message}`);

    if (rpcManager.isRateLimitError(error)) {
      log("🚨 Rate limit détecté sur WS → Switch RPC");
    } else {
      log("🚨 Erreur WebSocket → Switch RPC");
    }

    rpcManager.switchToNextRpc();
  });

  log(`✅ WebSocket connecté → ${rpcManager.getCurrentRpc().name}`);
}

/**
 * Charge les adresses des pools et leur état initial.
 */
async function loadPoolsAndInitialStates() {
  log("Loading pools and their initial states...");
  const loadPool = async (name, factory, tokenA, tokenB, fee, retries = 2) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const address = await getV3PoolAddress(
          factory,
          tokenA,
          tokenB,
          fee,
          ethersProvider,
        );
        if (!address) throw new Error(`❌ ${name} pool not found.`);
        log(`✅ ${name} Pool Found: ${address}`);
        const initialState = await getV3PoolState(address, ethersProvider);
        if (!initialState)
          throw new Error(`❌ Failed to fetch initial state for ${name}.`);
        poolStates[address.toLowerCase()] = initialState;
        log(`✅ Initial state for ${name} loaded. Tick: ${initialState.tick}`);
        return address;
      } catch (e) {
        log(
          `⚠️ Tentative ${attempt}/${retries} échouée pour ${name}: ${e.message}`,
        );
        if (attempt === retries) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };

  pancakeswapV3PoolAddress = await loadPool(
    "PancakeSwap V3",
    PANCAKESWAP_V3_FACTORY,
    WBNB_TOKEN,
    USDT_TOKEN,
    PANCAKESWAP_V3_FEE_TIERS.LOWEST,
  );
  try {
    uniswapUSDTBNB_005_PoolAddress = await loadPool(
      "Uniswap V3 0.05%",
      UNISWAP_V3_FACTORY,
      USDT_TOKEN,
      WBNB_TOKEN,
      UNISWAP_V3_FEE_TIERS.LOWEST,
    );
  } catch (e) {
    log(
      `⚠️ Could not load Uniswap V3 pool. Bot will run with limited capacity. Error: ${e.message}`,
    );
  }
}

/**
 * Gestionnaire d'événements qui décode les logs et met à jour l'état en mémoire.
 */
async function handleSwapEvent(eventLog) {
  // --- NOUVEAU : Met à jour le timestamp de la dernière activité ---
  lastActivityTime = Date.now();

  const poolAddress = eventLog.address.toLowerCase();
  try {
    const decodedData = web3.eth.abi.decodeLog(
      SWAP_EVENT_ABI,
      eventLog.data,
      eventLog.topics.slice(1),
    );
    poolStates[poolAddress] = {
      sqrtPriceX96: decodedData.sqrtPriceX96,
      tick: Number(decodedData.tick),
      liquidity: decodedData.liquidity,
    };
    await checkArbitrageOpportunity();
  } catch (error) {
    log(`❌ Error decoding swap event for ${poolAddress}:`, error.message);
  }
}

/**
 * Vérifie l'arbitrage en utilisant l'état en mémoire.
 */
/**
 * Vérifie l'arbitrage en utilisant l'état en mémoire + simulation réaliste optimisée.
 */
async function checkArbitrageOpportunity() {
  const now = Date.now();
  if (now - lastCallTime < THROTTLE_INTERVAL_MS) return;
  lastCallTime = now;

  const pancakeState = poolStates[pancakeswapV3PoolAddress.toLowerCase()];
  const uniState = uniswapUSDTBNB_005_PoolAddress
    ? poolStates[uniswapUSDTBNB_005_PoolAddress.toLowerCase()]
    : null;

  if (!pancakeState || !uniState) {
    log("⚠️ États des pools incomplets, impossible de vérifier l'arbitrage.");
    return;
  }

  const pancakeswapV3Price = calculatePriceV3(
    createV3Pool(
      WBNB_TOKEN,
      USDT_TOKEN,
      PANCAKESWAP_V3_FEE_TIERS.LOWEST,
      pancakeState.sqrtPriceX96,
      pancakeState.tick,
      pancakeState.liquidity,
    ),
  );

  const uniswap005Price = calculatePriceV3(
    createV3Pool(
      USDT_TOKEN,
      WBNB_TOKEN,
      UNISWAP_V3_FEE_TIERS.LOWEST,
      uniState.sqrtPriceX96,
      uniState.tick,
      uniState.liquidity,
    ),
  );

  if (
    !pancakeswapV3Price ||
    !uniswap005Price ||
    pancakeswapV3Price <= 0 ||
    uniswap005Price <= 0
  ) {
    log("❌ Erreur de calcul des prix spot.");
    return;
  }

  log(
    `➡️ Prices Spot: Pancake V3: ${pancakeswapV3Price.toFixed(6)} | Uniswap V3: ${uniswap005Price.toFixed(6)}`,
  );

  // Calcul des spreads spot (directionnel)
  const spreadUniToPancake =
    (pancakeswapV3Price - uniswap005Price) / uniswap005Price; // Acheter sur Uni → vendre sur Pancake
  const spreadPancakeToUni =
    (uniswap005Price - pancakeswapV3Price) / pancakeswapV3Price; // Acheter sur Pancake → vendre sur Uni

  const maxSpreadSpot = Math.max(spreadUniToPancake, spreadPancakeToUni);

  // Estimation du price impact (plus le montant est gros, plus on exige de spread)
  // Valeurs ajustées selon liquidité réelle observée sur BSC (Pancake ~3M$, Uniswap plus faible)
  const BASE_FEE = VENUS_FLASH_LOAN_FEE + 0.001; // Flashloan + 2 × 0.05% swap fees

  log(
    `📊 Spread spot max: ${(maxSpreadSpot * 100).toFixed(3)}% | Seuil de base: ${(BASE_FEE * 100).toFixed(2)}%`,
  );

  if (maxSpreadSpot < BASE_FEE + 0.001) {
    // Au minimum 0.10% de marge supplémentaire
    log(
      `🛑 Spread spot trop faible (${(maxSpreadSpot * 100).toFixed(3)}%). Pas de simulation Quoter.`,
    );
    return;
  }

  // --- Simulation réelle uniquement si spread spot prometteur ---
  log(
    `🔍 Spread spot intéressant (${(maxSpreadSpot * 100).toFixed(3)}%). Lancement simulation Quoter...`,
  );

  const usdtDecimals = TOKEN_DECIMALS[USDT_ADDRESS.toLowerCase()];
  const testAmounts = [1000, 3000, 6000, 10000, 15000];

  let bestOpp = {
    profit: -Infinity,
    loanAmountUSDT: 0n,
    bnbOut: 0n,
    finalUSDTOut: 0n,
    path: "",
  };

  for (let loanAmountNum of testAmounts) {
    if (loanAmountNum > MAX_LOAN_AMOUNT_USDT) break;

    const currentLoanAmountUSDT = parseUnits(
      loanAmountNum.toString(),
      usdtDecimals,
    );

    // Direction 1: UniV3 (USDT→WBNB) → PancakeV3 (WBNB→USDT)
    const bnbFromUni = await getAmountOutV3(
      USDT_TOKEN,
      WBNB_TOKEN,
      UNISWAP_V3_FEE_TIERS.LOWEST,
      currentLoanAmountUSDT,
      ethersProvider,
      UNISWAP_V3_QUOTER_V2,
    );

    if (bnbFromUni && bnbFromUni > 0n) {
      const usdtFromPancake = await getAmountOutV3(
        WBNB_TOKEN,
        USDT_TOKEN,
        PANCAKESWAP_V3_FEE_TIERS.LOWEST,
        bnbFromUni,
        ethersProvider,
        PANCAKESWAP_V3_QUOTER_V2,
      );

      if (usdtFromPancake && usdtFromPancake > 0n) {
        const received = parseFloat(formatUnits(usdtFromPancake, usdtDecimals));
        const profit = (received - loanAmountNum) * (1 - VENUS_FLASH_LOAN_FEE);

        if (profit > bestOpp.profit) {
          bestOpp = {
            profit,
            loanAmountUSDT: currentLoanAmountUSDT,
            bnbOut: bnbFromUni,
            finalUSDTOut: usdtFromPancake,
            path: "UniV3 → PancakeV3",
          };
        }
      }
    }

    // Direction 2: PancakeV3 (USDT→WBNB) → UniV3 (WBNB→USDT)
    const bnbFromPancake = await getAmountOutV3(
      USDT_TOKEN,
      WBNB_TOKEN,
      PANCAKESWAP_V3_FEE_TIERS.LOWEST,
      currentLoanAmountUSDT,
      ethersProvider,
      PANCAKESWAP_V3_QUOTER_V2,
    );

    if (bnbFromPancake && bnbFromPancake > 0n) {
      const usdtFromUni = await getAmountOutV3(
        WBNB_TOKEN,
        USDT_TOKEN,
        UNISWAP_V3_FEE_TIERS.LOWEST,
        bnbFromPancake,
        ethersProvider,
        UNISWAP_V3_QUOTER_V2,
      );

      if (usdtFromUni && usdtFromUni > 0n) {
        const received = parseFloat(formatUnits(usdtFromUni, usdtDecimals));
        const profit = (received - loanAmountNum) * (1 - VENUS_FLASH_LOAN_FEE);

        if (profit > bestOpp.profit) {
          bestOpp = {
            profit,
            loanAmountUSDT: currentLoanAmountUSDT,
            bnbOut: bnbFromPancake,
            finalUSDTOut: usdtFromUni,
            path: "PancakeV3 → UniV3",
          };
        }
      }
    }
  }

  // --- Logging CSV (inchangé) ---
  const timestampForCsv = new Date().toISOString();
  const differencePercent =
    Math.abs((100 - (pancakeswapV3Price * 100) / uniswap005Price).toFixed(3)) ||
    0;
  const profitUniToPancake =
    bestOpp.path === "UniV3 → PancakeV3" ? bestOpp.profit : 0;
  const profitPancakeToUni =
    bestOpp.path === "PancakeV3 → UniV3" ? bestOpp.profit : 0;
  const loanAmountForCsv =
    bestOpp.loanAmountUSDT > 0n
      ? formatUnits(bestOpp.loanAmountUSDT, usdtDecimals)
      : "0";

  const csvRow = `${timestampForCsv},${pancakeswapV3Price.toFixed(4)},${uniswap005Price.toFixed(4)},${profitUniToPancake.toFixed(4)},${profitPancakeToUni.toFixed(4)},${differencePercent},${parseFloat(loanAmountForCsv).toFixed(0)}\n`;

  fs.appendFile(csvPath, csvRow, (err) => {
    if (err) log("❌ Error writing to CSV:", err);
  });

  // Décision finale
  if (bestOpp.profit > PROFIT_THRESHOLD_USD) {
    const loanAmountStr = formatUnits(bestOpp.loanAmountUSDT, usdtDecimals);
    const msg = `💰 OPPORTUNITÉ PROFITABLE: ${bestOpp.path} | Profit: ${bestOpp.profit.toFixed(4)} USD | Loan: ${loanAmountStr} USDT`;
    log(msg);
    sendSlackNotification(
      `Arbitrage Triggered (${bestOpp.path})\n${msg}`,
      "info",
    );

    const isUniFirst = bestOpp.path.startsWith("Uni");

    const swap1Params = {
      tokenIn: USDT_ADDRESS,
      tokenOut: WBNB_ADDRESS,
      fee: isUniFirst
        ? UNISWAP_V3_FEE_TIERS.LOWEST
        : PANCAKESWAP_V3_FEE_TIERS.LOWEST,
      exchange: isUniFirst ? DEX.UNISWAP : DEX.PANCAKESWAP,
      amountOutMin: 0n,
    };

    const swap2Params = {
      tokenIn: WBNB_ADDRESS,
      tokenOut: USDT_ADDRESS,
      fee: isUniFirst
        ? PANCAKESWAP_V3_FEE_TIERS.LOWEST
        : UNISWAP_V3_FEE_TIERS.LOWEST,
      exchange: isUniFirst ? DEX.PANCAKESWAP : DEX.UNISWAP,
      amountOutMin: 0n,
    };

    await executeFlashLoanArbitrage(
      flashLoanContract,
      { log, sendEmailNotification, sendSlackNotification, parseUnits },
      bestOpp.loanAmountUSDT,
      swap1Params,
      swap2Params,
      bestOpp,
    );
  } else {
    log(
      `💤 Aucune opportunité rentable après simulation. Meilleur profit: ${bestOpp.profit.toFixed(4)} USD (seuil: ${PROFIT_THRESHOLD_USD})`,
    );
  }
}

/**
 * --- NOUVEAU : Démarre le watchdog pour surveiller l'activité. ---
 */
/**
 * --- Watchdog : si pas d'activité pendant 5 min → on switch de RPC (unifié avec le failover)
 */
function startWatchdog() {
  log("🐶 Watchdog activé (5 min d'inactivité → switch RPC automatique)");

  if (watchdogInterval) clearInterval(watchdogInterval);

  lastActivityTime = Date.now(); // reset à chaque (re)démarrage

  watchdogInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTime;

    if (timeSinceLastActivity > WATCHDOG_TIMEOUT_MS) {
      log(`🔴 Inactivité détectée (>5 min). Lancement du failover RPC...`);

      // === IMPORTANT : on n'appelle plus stop/start manuellement ===
      // On passe par le même chemin que les erreurs WS
      if (watchdogInterval) {
        clearInterval(watchdogInterval);
        watchdogInterval = null;
      }

      rpcManager.switchToNextRpc(); // ← c’est tout !
    }
  }, WATCHDOG_CHECK_INTERVAL_MS);
}

/**
 * Démarre le bot.
 */
async function startBot() {
  try {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }

    initializeProvidersAndSubscriptions();
    await loadPoolsAndInitialStates();
    const SWAP_EVENT_TOPIC_V3 = web3.utils.sha3(
      "Swap(address,address,int256,int256,uint160,uint128,int24)",
    );
    log("🚀 Bot started. Listening for swaps...");

    if (pancakeswapV3PoolAddress) {
      subscriptionPancakeV3 = await web3.eth.subscribe("logs", {
        topics: [SWAP_EVENT_TOPIC_V3],
        address: [pancakeswapV3PoolAddress],
      });
      if (subscriptionPancakeV3) {
        subscriptionPancakeV3.on("data", handleSwapEvent);
        subscriptionPancakeV3.on("error", (err) =>
          log("❌ PancakeSwap V3 sub error:", err.message),
        );
      } else {
        throw new Error("Failed to create PancakeSwap V3 subscription.");
      }
    }

    if (uniswapUSDTBNB_005_PoolAddress) {
      subscriptionUniswapV3_005 = await web3.eth.subscribe("logs", {
        topics: [SWAP_EVENT_TOPIC_V3],
        address: [uniswapUSDTBNB_005_PoolAddress],
      });
      if (subscriptionUniswapV3_005) {
        subscriptionUniswapV3_005.on("data", handleSwapEvent);
        subscriptionUniswapV3_005.on("error", (err) =>
          log("❌ Uniswap V3 sub error:", err.message),
        );
      } else {
        throw new Error("Failed to create Uniswap V3 subscription.");
      }
    }

    // --- NOUVEAU : Démarrer le watchdog une fois que tout est initialisé ---
    startWatchdog();
  } catch (err) {
    log(`❌ Fatal error during bot startup: ${err.message}`);
    log("Retrying in 10 seconds...");

    // 2. On stocke le minuteur dans la variable globale pour pouvoir l'annuler
    restartTimer = setTimeout(startBot, 10000);
  }
}

/**
 * Arrête proprement le bot et ferme les connexions.
 */
function stopBot() {
  log("Stopping bot...");

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
    log("🐶 Watchdog désactivé.");
  }

  cleanupSubscriptions();

  if (web3 && web3.currentProvider) {
    // FIX CRUCIAL : On retire les écouteurs avant de couper
    // pour empêcher Web3 de spammer "error" ou "end" pendant la fermeture
    web3.currentProvider.removeAllListeners("error");
    web3.currentProvider.removeAllListeners("end");

    if (web3.currentProvider.disconnect) {
      web3.currentProvider.disconnect();
      log("🔴 WebSocket connection closed.");
    }
  }
}

// Lancement
startBot();

// Gestion de la fermeture propre (CTRL+C)
process.on("SIGINT", () => {
  stopBot();
  process.exit(0);
});
