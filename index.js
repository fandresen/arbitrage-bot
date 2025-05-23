// main.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");

const config = require("./config");
const { WMATIC_ADDRESS, USDC_ADDRESS, TOKEN_DECIMALS, PROFIT_THRESHOLD_USD, AAVE_FLASH_LOAN_FEE } = config;

const { getPairAddress, getReserves } = require("./utils/contracts");
const { getAmountOut, calculatePrice } = require("./utils/calculations");
const { sendEmailNotification } = require("./utils/notifications");
const { parseUnits, formatUnits } = require("ethers");

// Logger allégé avec timestamp
function log(...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...args);
}

if (!process.env.RPC_URL) {
  throw new Error("RPC_URL non définie dans le fichier .env.");
}
const web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.RPC_URL));

const SWAP_EVENT_TOPIC = web3.utils.sha3("Swap(address,uint256,uint256,uint256,uint256,address)");

let sushiPairAddress = "";
let quickswapPairAddress = "";
const pairsToMonitor = new Set();
let subscription = null;

const logDir = path.join(__dirname, "LOG");
const csvPath = path.join(logDir, "price_differences.csv");

if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
if (!fs.existsSync(csvPath)) {
  fs.writeFileSync(csvPath, "timestamp,quickswapPrice,sushiswapPrice,diff_sushi_over_quick,diff_quick_over_sushi,net_profit_usd_scenario1,net_profit_usd_scenario2\n", "utf8");
}

async function loadPairAddresses() {
  log("Chargement des adresses des paires...");
  sushiPairAddress = await getPairAddress(config.SUSHISWAP_FACTORY, USDC_ADDRESS, WMATIC_ADDRESS, web3);
  quickswapPairAddress = await getPairAddress(config.QUICKSWAP_FACTORY, USDC_ADDRESS, WMATIC_ADDRESS, web3);

  if (!sushiPairAddress || !quickswapPairAddress) {
    throw new Error("Erreur : une des paires est invalide.");
  }

  pairsToMonitor.add(sushiPairAddress.toLowerCase());
  pairsToMonitor.add(quickswapPairAddress.toLowerCase());

  log("SushiSwap:", sushiPairAddress);
  log("QuickSwap:", quickswapPairAddress);
}

async function checkArbitrageOpportunity() {
  log("Vérification arbitrage...");

  const quickswapReserves = await getReserves(quickswapPairAddress, web3);
  const sushiReserves = await getReserves(sushiPairAddress, web3);

  if (!quickswapReserves || !sushiReserves) {
    log("Réserves manquantes.");
    return;
  }

  const quickswapPriceUSDCPerWMATIC = calculatePrice(quickswapReserves, WMATIC_ADDRESS, USDC_ADDRESS, TOKEN_DECIMALS);
  const sushiPriceUSDCPerWMATIC = calculatePrice(sushiReserves, WMATIC_ADDRESS, USDC_ADDRESS, TOKEN_DECIMALS);

  if (!quickswapPriceUSDCPerWMATIC || !sushiPriceUSDCPerWMATIC) {
    log("Erreur de calcul des prix.");
    return;
  }

  log(`Prix QuickSwap: ${quickswapPriceUSDCPerWMATIC.toFixed(6)} USDC`);
  log(`Prix SushiSwap: ${sushiPriceUSDCPerWMATIC.toFixed(6)} USDC`);

  const initialUSDCForLoan = parseUnits("1000000", TOKEN_DECIMALS[USDC_ADDRESS.toLowerCase()]);
  const flashLoanCost = initialUSDCForLoan * BigInt(Math.round(AAVE_FLASH_LOAN_FEE * 1e6)) / 1_000_000n;

  let wmaticReceivedFromQuickswap = getAmountOut(
    initialUSDCForLoan,
    quickswapReserves.token0Address.toLowerCase() === USDC_ADDRESS.toLowerCase() ? quickswapReserves.reserve0 : quickswapReserves.reserve1,
    quickswapReserves.token0Address.toLowerCase() === WMATIC_ADDRESS.toLowerCase() ? quickswapReserves.reserve0 : quickswapReserves.reserve1
  );
  let finalUSDCFromSushi = getAmountOut(
    wmaticReceivedFromQuickswap,
    sushiReserves.token0Address.toLowerCase() === WMATIC_ADDRESS.toLowerCase() ? sushiReserves.reserve0 : sushiReserves.reserve1,
    sushiReserves.token0Address.toLowerCase() === USDC_ADDRESS.toLowerCase() ? sushiReserves.reserve0 : sushiReserves.reserve1
  );
  const netProfitUSDC_Scenario1 = finalUSDCFromSushi - initialUSDCForLoan - flashLoanCost;
  const netProfitUSD_Scenario1 = Number(formatUnits(netProfitUSDC_Scenario1.toString(), TOKEN_DECIMALS[USDC_ADDRESS.toLowerCase()]));

  let wmaticReceivedFromSushi = getAmountOut(
    initialUSDCForLoan,
    sushiReserves.token0Address.toLowerCase() === USDC_ADDRESS.toLowerCase() ? sushiReserves.reserve0 : sushiReserves.reserve1,
    sushiReserves.token0Address.toLowerCase() === WMATIC_ADDRESS.toLowerCase() ? sushiReserves.reserve0 : sushiReserves.reserve1
  );
  let finalUSDCFromQuickswap = getAmountOut(
    wmaticReceivedFromSushi,
    quickswapReserves.token0Address.toLowerCase() === WMATIC_ADDRESS.toLowerCase() ? quickswapReserves.reserve0 : quickswapReserves.reserve1,
    quickswapReserves.token0Address.toLowerCase() === USDC_ADDRESS.toLowerCase() ? quickswapReserves.reserve0 : quickswapReserves.reserve1
  );
  const netProfitUSDC_Scenario2 = finalUSDCFromQuickswap - initialUSDCForLoan - flashLoanCost;
  const netProfitUSD_Scenario2 = Number(formatUnits(netProfitUSDC_Scenario2.toString(), TOKEN_DECIMALS[USDC_ADDRESS.toLowerCase()]));

  const now = new Date().toISOString();
  const diffSushiOverQuick = ((sushiPriceUSDCPerWMATIC - quickswapPriceUSDCPerWMATIC) / quickswapPriceUSDCPerWMATIC) * 100;
  const diffQuickOverSushi = ((quickswapPriceUSDCPerWMATIC - sushiPriceUSDCPerWMATIC) / sushiPriceUSDCPerWMATIC) * 100;

  const csvRow = `${now},${quickswapPriceUSDCPerWMATIC.toFixed(6)},${sushiPriceUSDCPerWMATIC.toFixed(6)},${diffSushiOverQuick.toFixed(4)},${diffQuickOverSushi.toFixed(4)},${netProfitUSD_Scenario1.toFixed(4)},${netProfitUSD_Scenario2.toFixed(4)}\n`;
  fs.appendFile(csvPath, csvRow, (err) => {
    if (err) log("Erreur CSV:", err);
  });

  if (netProfitUSD_Scenario1 > PROFIT_THRESHOLD_USD) {
    const msg = `OPPORTUNITÉ: QuickSwap → Sushi | Profit: ${netProfitUSD_Scenario1.toFixed(4)} USD`;
    log(msg);
    sendEmailNotification("Arbitrage (Scenario 1)", msg);
  }

  if (netProfitUSD_Scenario2 > PROFIT_THRESHOLD_USD) {
    const msg = `OPPORTUNITÉ: Sushi → QuickSwap | Profit: ${netProfitUSD_Scenario2.toFixed(4)} USD`;
    log(msg);
    sendEmailNotification("Arbitrage (Scenario 2)", msg);
  }

  if (netProfitUSD_Scenario1 <= PROFIT_THRESHOLD_USD && netProfitUSD_Scenario2 <= PROFIT_THRESHOLD_USD) {
    log(`Aucune opportunité > $${PROFIT_THRESHOLD_USD}`);
  }
}

async function startBot() {
  await loadPairAddresses();
  log("Bot lancé. Écoute des swaps...");

  try {
    subscription = await web3.eth.subscribe('logs', {
      topics: [SWAP_EVENT_TOPIC],
      address: Array.from(pairsToMonitor)
    });

    subscription.on('data', async (logData) => {
      log(`Swap détecté sur ${logData.address} (bloc ${logData.blockNumber})`);
      await checkArbitrageOpportunity();
    });

    subscription.on('error', (error) => {
      log("Erreur de souscription:", error);
      setTimeout(() => {
        if (!web3.currentProvider || !web3.currentProvider.connected) {
          web3.setProvider(new Web3.providers.WebsocketProvider(process.env.RPC_URL));
        }
        startBot();
      }, 5000);
    });

    web3.currentProvider.on('end', async (event) => {
      log(`WebSocket terminé. Code: ${event.code}`);
      if (subscription) {
        subscription.unsubscribe((err) => {
          if (err) log("Erreur unsubscribe:", err);
        });
        subscription = null;
      }
      setTimeout(() => {
        web3.setProvider(new Web3.providers.WebsocketProvider(process.env.RPC_URL));
        startBot();
      }, 5000);
    });

    web3.currentProvider.on('error', (error) => {
      log("Erreur WebSocket:", error);
    });

  } catch (err) {
    log("Erreur de souscription:", err);
    setTimeout(() => startBot(), 10000);
  }
}

function stopBot() {
  if (subscription) {
    subscription.unsubscribe((error, success) => {
      if (success) log('Unsubscribed des logs.');
      else log('Erreur unsubscribe:', error);
    });
  }
  if (web3.currentProvider && web3.currentProvider.connected) {
    web3.currentProvider.disconnect();
    log('WebSocket fermé.');
  }
}

startBot();

module.exports = {
  web3,
  startBot,
  stopBot,
  loadPairAddresses,
  checkArbitrageOpportunity,
  getAmountOut,
  calculatePrice,
  getQuickswapPairAddress: () => quickswapPairAddress,
  getSushiPairAddress: () => sushiPairAddress,
};
