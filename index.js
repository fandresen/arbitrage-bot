require("dotenv").config();
const { Web3 } = require("web3");
const axios = require("axios");
const { formatUnits } = require("ethers");

// Vérifie que l'URL RPC est bien définie
if (!process.env.RPC_URL) {
  throw new Error("RPC_URL non définie dans le fichier .env");
}

// Connexion au réseau
const web3 = new Web3(process.env.RPC_URL);

// ABIs des contrats
const IUniswapV2Pair = require("./contracts/IUniswapV2Pair.json");
const IUniswapV2Factory = require("./contracts/IUniswapV2Factory.json");

// Event topic pour `Swap(...)`
const SWAP_EVENT_TOPIC = web3.utils.sha3(
  "Swap(address,uint256,uint256,uint256,uint256,address)"
);

// Factories des DEX
const QUICKSWAP_FACTORY = "0x5757371414417b8c6caad45baef941abc7d3ab32";
const SUSHISWAP_FACTORY = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";

// Adresses des tokens
const WMATIC = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

// Variables d'état
let sushiPairAddress = "";
let quickswapPairAddress = "";
let lastBlockChecked = null;
const pairsToMonitor = [];

/**
 * Récupère l'adresse d'une paire
 */
async function getPairAddress(factoryAddress, tokenA, tokenB) {
  try {
    const factory = new web3.eth.Contract(
      IUniswapV2Factory.abi,
      factoryAddress
    );
    return await factory.methods.getPair(tokenA, tokenB).call();
  } catch (err) {
    console.error("Erreur getPairAddress:", err.message);
    return null;
  }
}

/**
 * Charge les adresses des paires Sushi et QuickSwap
 */
async function loadPairAddresses() {
  console.log("🔄 Chargement des paires...");
  sushiPairAddress = await getPairAddress(SUSHISWAP_FACTORY, USDC, WMATIC);
  quickswapPairAddress = await getPairAddress(QUICKSWAP_FACTORY, USDC, WMATIC);

  if (!sushiPairAddress || !quickswapPairAddress) {
    throw new Error("Erreur : une des paires n’a pas pu être chargée.");
  }

  pairsToMonitor.push(
    sushiPairAddress.toLowerCase(),
    quickswapPairAddress.toLowerCase()
  );
  console.log("✅ SushiSwap Pair :", sushiPairAddress);
  console.log("✅ QuickSwap Pair:", quickswapPairAddress);
}

/**
 * Vérifie les nouveaux blocs et détecte les swaps
 */
async function checkNewBlocks() {
  try {
    const latest = Number(await web3.eth.getBlockNumber());

    if (!lastBlockChecked) {
      lastBlockChecked = latest;
      console.log(`⛓️ Démarrage au bloc : ${latest}`);
      return;
    }

    if (latest > lastBlockChecked) {
      console.log(`🔍 Bloc ${latest} analysé...`);

      const logs = await web3.eth.getPastLogs({
        fromBlock: lastBlockChecked + 1,
        toBlock: latest,
        topics: [SWAP_EVENT_TOPIC],
      });

      let swapDetected = false;

      for (const log of logs) {
        if (pairsToMonitor.includes(log.address.toLowerCase())) {
          console.log(`💱 Swap détecté sur : ${log.address}`);
          swapDetected = true;
        }
      }

      if (swapDetected) {
        await checkArbitrageOpportunity(); // Appel ici uniquement quand swap détecté
      }

      lastBlockChecked = latest;
    }
  } catch (err) {
    console.error("Erreur checkNewBlocks :", err.message);
  }
}

/**
 * Récupère les réserves d’une paire
 */
async function getReserves(pairAddr) {
  const contract = new web3.eth.Contract(IUniswapV2Pair.abi, pairAddr);
  return await contract.methods.getReserves().call();
}

// Cache du prix WMATIC
let cachedWmaticPrice = null;
let lastPriceUpdate = 0;

/**
 * Récupère le prix USD de WMATIC (via CoinGecko)
 */
async function getWmaticPriceInUSD() {
  const now = Date.now();
  const CACHE_DURATION = 60_000; // 1 min

  if (cachedWmaticPrice && now - lastPriceUpdate < CACHE_DURATION) {
    return cachedWmaticPrice;
  }

  try {
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: { ids: "matic-network", vs_currencies: "usd" },
      }
    );
    cachedWmaticPrice = res.data["matic-network"].usd;
    lastPriceUpdate = now;
    return cachedWmaticPrice;
  } catch (err) {
    console.error("Erreur CoinGecko :", err.message);
    return cachedWmaticPrice || null;
  }
}

/**
 * Calcule le prix d’un token en USD via les réserves de la paire
 */

// async function getTokenPriceInUSD(pairAddress, tokenIsToken0 = true, tokenDecimals = 6) {
//   const reserves = await getReserves(pairAddress);
//   const reserve0 = BigInt(reserves.reserve0);
//   const reserve1 = BigInt(reserves.reserve1);

//   const reserveToken = tokenIsToken0 ? reserve0 : reserve1;
//   const reserveWmatic = tokenIsToken0 ? reserve1 : reserve0;

//   if (reserveToken === 0n || reserveWmatic === 0n) return null;

//   const tokenAmount = Number(formatUnits(reserveToken.toString(), tokenDecimals));
//   const wmaticAmount = Number(formatUnits(reserveWmatic.toString(), 18));

//   if (wmaticAmount <= 0) return null;

//   // Calcul du prix de 1 WMATIC en USD
//   const pricePerWmaticInToken = tokenAmount / wmaticAmount;

//   // Si le token est un stablecoin, on suppose que son prix = $1
//   const pricePerWmaticInUSD = pricePerWmaticInToken;

//   return pricePerWmaticInUSD;
// }

async function getSellPrice(
  pairAddress,
  tokenIsToken0 = true,
  tokenDecimals = 6
) {
  const reserves = await getReserves(pairAddress);
  const reserve0 = BigInt(reserves.reserve0);
  const reserve1 = BigInt(reserves.reserve1);

  const reserveToken = tokenIsToken0 ? reserve0 : reserve1;
  const reserveWmatic = tokenIsToken0 ? reserve1 : reserve0;

  if (reserveToken === 0n || reserveWmatic === 0n) return null;

  const tokenAmount = Number(
    formatUnits(reserveToken.toString(), tokenDecimals)
  );
  const wmaticAmount = Number(formatUnits(reserveWmatic.toString(), 18));

  if (wmaticAmount <= 0) return null;

  // Prix 1 WMATIC en Token (ex: USDC)
  const priceWmaticInToken = tokenAmount / wmaticAmount;

  // On suppose que Token est USDC (stablecoin)
  const priceWmaticInUSD = priceWmaticInToken * 1; // USDC = $1

  return priceWmaticInUSD;
}

async function getBuyPrice(
  pairAddress,
  tokenIsToken0 = true,
  tokenDecimals = 6
) {
  const reserves = await getReserves(pairAddress);
  const reserve0 = BigInt(reserves.reserve0);
  const reserve1 = BigInt(reserves.reserve1);

  const reserveToken = tokenIsToken0 ? reserve0 : reserve1;
  const reserveWmatic = tokenIsToken0 ? reserve1 : reserve0;

  if (reserveToken === 0n || reserveWmatic === 0n) return null;

  const tokenAmount = Number(
    formatUnits(reserveToken.toString(), tokenDecimals)
  );
  const wmaticAmount = Number(formatUnits(reserveWmatic.toString(), 18));

  if (tokenAmount <= 0) return null;

  // Prix d'achat de 1 Token (ex: USDC) en WMATIC
  const buyPrice = wmaticAmount / tokenAmount;

  return buyPrice;
}

/**
 * Vérifie les opportunités d’arbitrage
 */
async function checkArbitrageOpportunity() {
  // Paire SushiSwap (USDC/WMATIC)
  const sushiSellPrice = await getSellPrice(sushiPairAddress, true, 6); // USDC = token0
  const quickBuyPrice = await getSellPrice(quickswapPairAddress, true, 6); // USDC = token0

  if (!sushiSellPrice || !quickBuyPrice) {
    console.log("⛔ Prix non disponibles");
    return;
  }

  console.log(
    `💹 SushiSwap (Sell): $${sushiSellPrice.toFixed(
      6
    )} | QuickSwap (Buy): $${quickBuyPrice.toFixed(6)}`
  );

  // Calcul de l'écart
  const diff = Math.abs(sushiSellPrice - quickBuyPrice);
  const diffPercent = (diff / Math.min(sushiSellPrice, quickBuyPrice)) * 100;

  console.log(`Diff: ${diffPercent.toFixed(2)}%`);

  if (diffPercent > 1) {
    console.log(
      `🚨 Opportunité d’arbitrage : écart de ${diffPercent.toFixed(2)}%`
    );
  }
}

/**
 * Démarre le bot
 */
async function startBot() {
  await loadPairAddresses();

  setInterval(async () => {
    await checkNewBlocks();
  }, 5000);

  console.log("🚀 Bot lancé !");
}

startBot();
