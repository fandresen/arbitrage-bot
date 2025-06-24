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
  PANCAKESWAP_V3_FACTORY,
  PANCAKESWAP_V3_FEE_TIERS,
  PANCAKESWAP_V3_QUOTER_V2, // Nouveau
  UNISWAP_V3_FACTORY, // Nouveau
  UNISWAP_V3_QUOTER_V2, // Nouveau
  UNISWAP_V3_FEE_TIERS, // Nouveau
} = config;

// Import des nouveaux utilitaires V3
const { getV3PoolAddress, getV3PoolState, createV3Pool } = require("./utils/v3contracts");
// Import des calculs mis à jour (seules les fonctions V3 restent)
const { getAmountOutV3, calculatePriceV3 } = require("./utils/calculations");
const { sendEmailNotification } = require("./utils/notifications");

// --- Configuration du Logger ---
function log(...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...args);
}

// --- Variables Globales pour les Instances et Souscriptions ---
let web3; // Déclaré avec let pour pouvoir être réassigné lors de la reconnexion
let ethersProvider; // Déclaré avec let
let subscriptionV3 = null; // Renommé pour clarté
let subscriptionUniswapV3_005 = null; // Nouvelle souscription
let subscriptionUniswapV3_03 = null; // Nouvelle souscription (si utilisée)

let pancakeswapV3PoolAddress = "";
// Corrected: Initialize to null so it's fetched dynamically
let uniswapUSDTBNB_005_PoolAddress = null; 
let uniswapUSDTBNB_03_PoolAddress = null; // Already correctly initialized to null

const pairsToMonitor = new Set();

// Instances de Token pour le SDK V3
const WBNB_TOKEN = new Token(56, WBNB_ADDRESS, TOKEN_DECIMALS[WBNB_ADDRESS.toLowerCase()], 'WBNB', 'Wrapped BNB');
const USDT_TOKEN = new Token(56, USDT_ADDRESS, TOKEN_DECIMALS[USDT_ADDRESS.toLowerCase()], 'USDT', 'Tether USD');

let pancakeswapV3Pool; // Pour stocker l'instance de pool V3
let uniswapUSDTBNB_005_Pool; // Pour stocker l'instance de pool Uniswap V3 0.05%
let uniswapUSDTBNB_03_Pool; // Pour stocker l'instance de pool Uniswap V3 0.3%

// --- Configuration des Logs CSV ---
const logDir = path.join(__dirname, "LOG");
const csvPath = path.join(logDir, "arbitrage_opportunities_v3_uni_v3.csv"); // Nouveau nom de fichier CSV

if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
if (!fs.existsSync(csvPath)) {
  // En-tête CSV mis à jour pour les scénarios V3-Uniswap V3
  fs.writeFileSync(csvPath, "timestamp,pancakeV3Price,uniswap005Price,uniswap03Price,profit_Uni005_to_PancakeV3,profit_PancakeV3_to_Uni005,loan_amount_usd\n", "utf8");
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
    if (subscriptionV3) {
      subscriptionV3.unsubscribe((error, success) => {
        if (success) log('✅ Unsubscribed des logs V3.');
        else console.error('❌ Erreur lors de l\'unsubscribe V3:', error);
      }).catch(err => {
        console.error("❌ Erreur lors de l'unsubscribe V3 (catch):", err);
      });
      subscriptionV3 = null;
    }
    if (subscriptionUniswapV3_005) {
      subscriptionUniswapV3_005.unsubscribe((error, success) => {
        if (success) log('✅ Unsubscribed des logs Uniswap V3 (0.05%).');
        else console.error('❌ Erreur lors de l\'unsubscribe Uniswap V3 (0.05%):', error);
      }).catch(err => {
        console.error("❌ Erreur lors de l'unsubscribe Uniswap V3 (0.05%) (catch):", err);
      });
      subscriptionUniswapV3_005 = null;
    }
    if (subscriptionUniswapV3_03) {
        subscriptionUniswapV3_03.unsubscribe((error, success) => {
          if (success) log('✅ Unsubscribed des logs Uniswap V3 (0.3%).');
          else console.error('❌ Erreur lors de l\'unsubscribe Uniswap V3 (0.3%):', error);
        }).catch(err => {
          console.error("❌ Erreur lors de l'unsubscribe Uniswap V3 (0.3%) (catch):", err);
        });
        subscriptionUniswapV3_03 = null;
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
 * Charge les adresses des pools BNB/USDT sur PancakeSwap V3 et Uniswap V3.
 * @throws {Error} Si l'une des adresses de pool est invalide.
 */
async function loadPairAddresses() {
  log("Chargement des adresses des pools BNB/USDT...");

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

  // Initialisation Uniswap V3 - USDT/BNB 0.05%
  // L'adresse a été fournie, mais nous la vérifions quand même via la factory
  // Removed hardcoded address, let it be fetched dynamically
  uniswapUSDTBNB_005_PoolAddress = await getV3PoolAddress(
    UNISWAP_V3_FACTORY,
    USDT_TOKEN,
    WBNB_TOKEN,
    UNISWAP_V3_FEE_TIERS.LOW, // 0.05%
    ethersProvider
  );
  
  if (uniswapUSDTBNB_005_PoolAddress) {
    pairsToMonitor.add(uniswapUSDTBNB_005_PoolAddress.toLowerCase());
    log(`✅ Uniswap V3 USDT/BNB 0.05% Pool Found: ${uniswapUSDTBNB_005_PoolAddress}`);
  } else {
    log(`❌ Uniswap V3 USDT/BNB 0.05% Pool introuvable. Vérifiez l'adresse ou la configuration.`);
  }

  // Si vous voulez aussi surveiller la pool 0.3% d'Uniswap V3
  uniswapUSDTBNB_03_PoolAddress = await getV3PoolAddress(
    UNISWAP_V3_FACTORY,
    USDT_TOKEN,
    WBNB_TOKEN,
    UNISWAP_V3_FEE_TIERS.MEDIUM, // 0.3%
    ethersProvider
  );
  if (uniswapUSDTBNB_03_PoolAddress) {
    pairsToMonitor.add(uniswapUSDTBNB_03_PoolAddress.toLowerCase());
    log(`✅ Uniswap V3 USDT/BNB 0.3% Pool Found: ${uniswapUSDTBNB_03_PoolAddress}`);
  } else {
    log(`❌ Uniswap V3 USDT/BNB 0.3% Pool introuvable.`);
  }
}

/**
 * Vérifie les opportunités d'arbitrage entre PancakeSwap V3 et Uniswap V3.
 */
async function checkArbitrageOpportunity() {
  const now = Date.now();
  if (now - lastCallTime < THROTTLE_INTERVAL_MS) {
    return; // Ne pas exécuter si l'intervalle n'est pas passé
  }
  lastCallTime = now;

  log("🔍 Vérification des opportunités d'arbitrage...");

  // --- Récupération de l'état pour V3 PancakeSwap ---
  const pancakeswapV3PoolState = await getV3PoolState(pancakeswapV3PoolAddress, ethersProvider);
  if (!pancakeswapV3PoolState) {
    log("⚠️ État PancakeSwap V3 pool manquant. Impossible de vérifier l'arbitrage.");
    return;
  }
  // Créer une instance de Pool V3 pour les calculs du SDK (en utilisant le V3_FEE_TIERS.LOW)
  const pancakeswapV3FeeTierForCalc = PANCAKESWAP_V3_FEE_TIERS.LOW;
  pancakeswapV3Pool = createV3Pool(
    WBNB_TOKEN,
    USDT_TOKEN,
    pancakeswapV3FeeTierForCalc, 
    pancakeswapV3PoolState.sqrtPriceX96,
    pancakeswapV3PoolState.tick,
    pancakeswapV3PoolState.liquidity
  );
  const pancakeswapV3PriceUSDTPerWBNB = calculatePriceV3(pancakeswapV3Pool);

  // --- Récupération de l'état pour V3 Uniswap (0.05%) ---
  let uniswap005PriceUSDTPerWBNB = null;
  if (uniswapUSDTBNB_005_PoolAddress) {
    const uniswap005PoolState = await getV3PoolState(uniswapUSDTBNB_005_PoolAddress, ethersProvider);
    if (uniswap005PoolState) {
      uniswapUSDTBNB_005_Pool = createV3Pool(
        USDT_TOKEN,
        WBNB_TOKEN,
        UNISWAP_V3_FEE_TIERS.LOW,
        uniswap005PoolState.sqrtPriceX96,
        uniswap005PoolState.tick,
        uniswap005PoolState.liquidity
      );
      if (uniswapUSDTBNB_005_Pool) { // Added defensive check
        uniswap005PriceUSDTPerWBNB = calculatePriceV3(uniswapUSDTBNB_005_Pool);
      } else {
        log("⚠️ Erreur: uniswapUSDTBNB_005_Pool n'a pas pu être créé.");
      }
    } else {
      log("⚠️ État Uniswap V3 (0.05%) pool manquant.");
    }
  }

  // --- Récupération de l'état pour V3 Uniswap (0.3%) ---
  let uniswap03PriceUSDTPerWBNB = null;
  if (uniswapUSDTBNB_03_PoolAddress) {
    const uniswap03PoolState = await getV3PoolState(uniswapUSDTBNB_03_PoolAddress, ethersProvider);
    if (uniswap03PoolState) {
      uniswapUSDTBNB_03_Pool = createV3Pool(
        USDT_TOKEN,
        WBNB_TOKEN,
        UNISWAP_V3_FEE_TIERS.MEDIUM,
        uniswap03PoolState.sqrtPriceX96,
        uniswap03PoolState.tick,
        uniswap03PoolState.liquidity
      );
      if (uniswapUSDTBNB_03_Pool) { // Added defensive check
          uniswap03PriceUSDTPerWBNB = calculatePriceV3(uniswapUSDTBNB_03_Pool);
      } else {
          log("⚠️ Erreur: uniswapUSDTBNB_03_Pool n'a pas pu être créé.");
      }
    } else {
      log("⚠️ État Uniswap V3 (0.3%) pool manquant.");
    }
  }


  if (!pancakeswapV3PriceUSDTPerWBNB) {
    log("❌ Erreur de calcul des prix (PancakeSwap V3). Impossible de vérifier l'arbitrage.");
    return;
  }

  log(`➡️ Prix PancakeSwap V3: ${pancakeswapV3PriceUSDTPerWBNB.toFixed(6)} USDT/BNB (frais: ${pancakeswapV3FeeTierForCalc / 100}%)`);
  if (uniswap005PriceUSDTPerWBNB) log(`➡️ Prix Uniswap V3 (0.05%): ${uniswap005PriceUSDTPerWBNB.toFixed(6)} USDT/BNB`);
  if (uniswap03PriceUSDTPerWBNB) log(`➡️ Prix Uniswap V3 (0.3%): ${uniswap03PriceUSDTPerWBNB.toFixed(6)} USDT/BNB`);


  // --- Initialisation des variables pour les meilleurs profits et montants ---
  let bestProfitUSD_Uni_to_PancakeV3 = -Infinity; // Acheter Uniswap V3 (0.05%) -> Vendre PancakeSwap V3
  let bestLoanAmount_Uni_to_PancakeV3_USDT = 0n;

  let bestProfitUSD_PancakeV3_to_Uni = -Infinity; // Acheter PancakeSwap V3 -> Vendre Uniswap V3 (0.05%)
  let bestLoanAmount_PancakeV3_to_Uni_USDT = 0n;

  const usdtDecimals = TOKEN_DECIMALS[USDT_ADDRESS.toLowerCase()];

  // --- Itération pour trouver le meilleur profit ---
  for (let loanAmountNum = MIN_LOAN_AMOUNT_USDT; loanAmountNum <= MAX_LOAN_AMOUNT_USDT; loanAmountNum += LOAN_AMOUNT_INCREMENT_USDT) {
    const currentLoanAmountUSDT = parseUnits(loanAmountNum.toString(), usdtDecimals);
    const flashLoanCost = (currentLoanAmountUSDT * BigInt(Math.round(VENUS_FLASH_LOAN_FEE * 1_000_000))) / 1_000_000n;

    // --- SCÉNARIO: Acheter BNB sur Uniswap V3 (0.05%), Vendre sur PancakeSwap V3 ---
    if (uniswap005PriceUSDTPerWBNB && pancakeswapV3PriceUSDTPerWBNB && uniswap005PriceUSDTPerWBNB < pancakeswapV3PriceUSDTPerWBNB) {
        const bnbAmountOutUniswap = await getAmountOutV3(
            USDT_TOKEN,
            WBNB_TOKEN,
            UNISWAP_V3_FEE_TIERS.LOW,
            currentLoanAmountUSDT,
            ethersProvider,
            UNISWAP_V3_QUOTER_V2 // Utilise le quoter Uniswap
        );

        if (bnbAmountOutUniswap) {
            const usdtAmountOutPancake = await getAmountOutV3(
                WBNB_TOKEN,
                USDT_TOKEN,
                pancakeswapV3FeeTierForCalc,
                bnbAmountOutUniswap,
                ethersProvider,
                PANCAKESWAP_V3_QUOTER_V2 // Utilise le quoter PancakeSwap
            );

            if (usdtAmountOutPancake) {
                const profitUSD_Current = (parseFloat(formatUnits(usdtAmountOutPancake, usdtDecimals)) - parseFloat(formatUnits(currentLoanAmountUSDT, usdtDecimals))) * (1 - VENUS_FLASH_LOAN_FEE);
                if (profitUSD_Current > bestProfitUSD_Uni_to_PancakeV3) {
                    bestProfitUSD_Uni_to_PancakeV3 = profitUSD_Current;
                    bestLoanAmount_Uni_to_PancakeV3_USDT = currentLoanAmountUSDT;
                }
            }
        }
    }

    // --- SCÉNARIO: Acheter BNB sur PancakeSwap V3, Vendre sur Uniswap V3 (0.05%) ---
    if (uniswap005PriceUSDTPerWBNB && pancakeswapV3PriceUSDTPerWBNB && pancakeswapV3PriceUSDTPerWBNB < uniswap005PriceUSDTPerWBNB) {
        const bnbAmountOutPancake = await getAmountOutV3(
            USDT_TOKEN,
            WBNB_TOKEN,
            pancakeswapV3FeeTierForCalc,
            currentLoanAmountUSDT,
            ethersProvider,
            PANCAKESWAP_V3_QUOTER_V2 // Utilise le quoter PancakeSwap
        );

        if (bnbAmountOutPancake) {
            const usdtAmountOutUniswap = await getAmountOutV3(
                WBNB_TOKEN,
                USDT_TOKEN,
                UNISWAP_V3_FEE_TIERS.LOW,
                bnbAmountOutPancake,
                ethersProvider,
                UNISWAP_V3_QUOTER_V2 // Utilise le quoter Uniswap
            );

            if (usdtAmountOutUniswap) {
                const profitUSD_Current = (parseFloat(formatUnits(usdtAmountOutUniswap, usdtDecimals)) - parseFloat(formatUnits(currentLoanAmountUSDT, usdtDecimals))) * (1 - VENUS_FLASH_LOAN_FEE);
                if (profitUSD_Current > bestProfitUSD_PancakeV3_to_Uni) {
                    bestProfitUSD_PancakeV3_to_Uni = profitUSD_Current;
                    bestLoanAmount_PancakeV3_to_Uni_USDT = currentLoanAmountUSDT;
                }
            }
        }
    }
  }

  // --- Enregistrement des données et Notification ---
  const timestampForCsv = new Date().toISOString(); 
  const csvRow = `${timestampForCsv},${pancakeswapV3PriceUSDTPerWBNB ? pancakeswapV3PriceUSDTPerWBNB.toFixed(6) : 'N/A'},${uniswap005PriceUSDTPerWBNB ? uniswap005PriceUSDTPerWBNB.toFixed(6) : 'N/A'},${uniswap03PriceUSDTPerWBNB ? uniswap03PriceUSDTPerWBNB.toFixed(6) : 'N/A'},${bestProfitUSD_Uni_to_PancakeV3.toFixed(4)},${bestProfitUSD_PancakeV3_to_Uni.toFixed(4)},${Number(formatUnits(bestLoanAmount_Uni_to_PancakeV3_USDT > bestLoanAmount_PancakeV3_to_Uni_USDT ? bestLoanAmount_Uni_to_PancakeV3_USDT : bestLoanAmount_PancakeV3_to_Uni_USDT, usdtDecimals)).toFixed(0)}\n`;
  
  fs.appendFile(csvPath, csvRow, (err) => {
    if (err) log("❌ Erreur lors de l'écriture CSV:", err);
  });

  // Logique de notification
  let opportunitiesFound = false;

  if (bestProfitUSD_Uni_to_PancakeV3 > PROFIT_THRESHOLD_USD) {
    const msg = `💰 OPPORTUNITÉ DÉTECTÉE: Acheter BNB sur Uniswap V3 (0.05%), Vendre sur PancakeSwap V3 | Profit Optimal: ${bestProfitUSD_Uni_to_PancakeV3.toFixed(4)} USDT | Montant du Prêt Optimal: ${Number(formatUnits(bestLoanAmount_Uni_to_PancakeV3_USDT.toString(), usdtDecimals)).toFixed(0)} USDT`;
    log(msg);
    sendEmailNotification("Arbitrage (Uniswap V3 to PancakeSwap V3) - Optimal", msg);
    opportunitiesFound = true;
    // executeArbitrage(USDT_ADDRESS, WBNB_ADDRESS, 'UNIV3_TO_PANCAKEV3', bestLoanAmount_Uni_to_PancakeV3_USDT);
  }

  if (bestProfitUSD_PancakeV3_to_Uni > PROFIT_THRESHOLD_USD) {
    const msg = `💰 OPPORTUNITÉ DÉTECTEÉ: Acheter BNB sur PancakeSwap V3, Vendre sur Uniswap V3 (0.05%) | Profit Optimal: ${bestProfitUSD_PancakeV3_to_Uni.toFixed(4)} USDT | Montant du Prêt Optimal: ${Number(formatUnits(bestLoanAmount_PancakeV3_to_Uni_USDT.toString(), usdtDecimals)).toFixed(0)} USDT`;
    log(msg);
    sendEmailNotification("Arbitrage (PancakeSwap V3 to Uniswap V3) - Optimal", msg);
    opportunitiesFound = true;
    // executeArbitrage(USDT_ADDRESS, WBNB_ADDRESS, 'PANCAKEV3_TO_UNIV3', bestLoanAmount_PancakeV3_to_Uni_USDT);
  }

  if (!opportunitiesFound) {
    log(`💤 Aucune opportunité d'arbitrage rentable (profit > $${PROFIT_THRESHOLD_USD}) après optimisation.`);
  }
}

/**
 * Démarre le bot en souscrivant aux événements de swap.
 */
async function startBot() {
  initializeProvidersAndSubscriptions(); // Initialise les providers et la logique de reconnexion

  // Définir les topics d'événements ICI après l'initialisation de 'web3'
  const SWAP_EVENT_TOPIC_V3 = web3.utils.sha3("Swap(address,address,int256,int256,uint160,uint128,int24)"); // Pour V3


  await loadPairAddresses();
  log("🚀 Bot lancé. Écoute des swaps sur les différents pools...");

  try {
    // Souscription aux événements PancakeSwap V3
    subscriptionV3 = await web3.eth.subscribe('logs', {
      topics: [SWAP_EVENT_TOPIC_V3],
      address: [pancakeswapV3PoolAddress]
    });

    subscriptionV3.on('data', async (logData) => {
      // log(`🔄 Swap V3 détecté sur ${logData.address} (bloc ${logData.blockNumber})`);
      await checkArbitrageOpportunity();
    });
    subscriptionV3.on('error', (error) => {
      log("❌ Erreur de souscription PancakeSwap V3:", error);
    });

    // Souscription aux événements Uniswap V3 (0.05%)
    if (uniswapUSDTBNB_005_PoolAddress) {
        subscriptionUniswapV3_005 = await web3.eth.subscribe('logs', {
            topics: [SWAP_EVENT_TOPIC_V3], // Le topic est le même que PancakeSwap V3 car c'est un fork
            address: [uniswapUSDTBNB_005_PoolAddress]
        });

        subscriptionUniswapV3_005.on('data', async (logData) => {
            // log(`🔄 Swap Uniswap V3 (0.05%) détecté sur ${logData.address} (bloc ${logData.blockNumber})`);
            await checkArbitrageOpportunity();
        });
        subscriptionUniswapV3_005.on('error', (error) => {
            log("❌ Erreur de souscription Uniswap V3 (0.05%):", error);
        });
    }

    // Souscription aux événements Uniswap V3 (0.3%) - Optionnel
    if (uniswapUSDTBNB_03_PoolAddress) {
        subscriptionUniswapV3_03 = await web3.eth.subscribe('logs', {
            topics: [SWAP_EVENT_TOPIC_V3],
            address: [uniswapUSDTBNB_03_PoolAddress]
        });

        subscriptionUniswapV3_03.on('data', async (logData) => {
            // log(`🔄 Swap Uniswap V3 (0.3%) détecté sur ${logData.address} (bloc ${logData.blockNumber})`);
            await checkArbitrageOpportunity();
        });
        subscriptionUniswapV3_03.on('error', (error) => {
            log("❌ Erreur de souscription Uniswap V3 (0.3%):", error);
        });
    }


  } catch (err) {
    log("❌ Erreur fatale lors du démarrage du bot:", err);
    setTimeout(() => startBot(), 10000);
  }
}

/**
 * Arrête la souscription WebSocket et ferme la connexion.
 */
function stopBot() {
  if (subscriptionV3) {
    subscriptionV3.unsubscribe((error, success) => {
      if (success) log('✅ Unsubscribed des logs V3.');
      else console.error('❌ Erreur lors de l\'unsubscribe V3:', error);
    }).catch(err => console.error("❌ Erreur lors de l'unsubscribe V3 (catch):", err));
  }
  if (subscriptionUniswapV3_005) {
    subscriptionUniswapV3_005.unsubscribe((error, success) => {
      if (success) log('✅ Unsubscribed des logs Uniswap V3 (0.05%).');
      else console.error('❌ Erreur lors de l\'unsubscribe Uniswap V3 (0.05%) (catch):', err);
    }).catch(err => console.error("❌ Erreur lors de l'unsubscribe Uniswap V3 (0.05%) (catch):", err));
  }
  if (subscriptionUniswapV3_03) {
    subscriptionUniswapV3_03.unsubscribe((error, success) => {
      if (success) log('✅ Unsubscribed des logs Uniswap V3 (0.3%).');
      else console.error('❌ Erreur lors de l\'unsubscribe Uniswap V3 (0.3%) (catch):', err);
    }).catch(err => console.error("❌ Erreur lors de l'unsubscribe Uniswap V3 (0.3%) (catch):", err));
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
  ethersProvider,
  startBot,
  stopBot,
  loadPairAddresses,
  checkArbitrageOpportunity,
  getAmountOutV3,
  calculatePriceV3,
  getPancakeSwapV3PoolAddress: () => pancakeswapV3PoolAddress,
  getUniswapUSDTBNB_005_PoolAddress: () => uniswapUSDTBNB_005_PoolAddress,
  getUniswapUSDTBNB_03_PoolAddress: () => uniswapUSDTBNB_03_PoolAddress,
};