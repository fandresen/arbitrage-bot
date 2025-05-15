const { Web3 } = require("web3");
require("dotenv").config();

// Charger les ABIs
const IUniswapV2Pair = require("./contracts/IUniswapV2Pair.json");
const IUniswapV2Factory = require("./contracts/IUniswapV2Factory.json");

// Connexion au réseau Polygon via Infura
const web3 = new Web3(process.env.RPC_URL);

// Topics pour l'événement Swap
const SWAP_EVENT_TOPIC = web3.utils.sha3(
  "Swap(address,uint256,uint256,uint256,uint256,address)"
);

const axios = require("axios");

console.log("Bot d'arbitrage démarré...");

let lastBlockChecked = null;
let sushiPairAddress = "";
let quickswapPairAddress = "";

// Factory Contracts
const QUICKSWAP_FACTORY = "0x5757371414417b8c6caad45baef941abc7d3ab32";
const SUSHISWAP_FACTORY = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
/*  */
// Tokens à surveiller (exemple : USDC / WMATIC)
const WMATIC_TOKEN = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const USDC_TOKEN = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

// === Fonction pour récupérer l'adresse de la paire depuis le factory contract ===
async function getPairAddress(factoryAddress, tokenA, tokenB) {
  try {
    const factoryContract = new web3.eth.Contract(
      IUniswapV2Factory.abi,
      factoryAddress
    );
    const pairAddress = await factoryContract.methods
      .getPair(tokenA, tokenB)
      .call();
    return pairAddress;
  } catch (error) {
    console.error(
      `Erreur lors de la récupération de la paire ${factoryAddress}:`,
      error.message
    );
    return null;
  }
}

// === Chargement dynamique des adresses des paires ===
async function loadPairAddresses() {
  console.log("Chargement des adresses de paires...");

  sushiPairAddress = await getPairAddress(
    SUSHISWAP_FACTORY,
    USDC_TOKEN,
    WMATIC_TOKEN
  );
  quickswapPairAddress = await getPairAddress(
    QUICKSWAP_FACTORY,
    USDC_TOKEN,
    WMATIC_TOKEN
  );

  if (!sushiPairAddress || !quickswapPairAddress) {
    throw new Error("Impossible de charger une ou plusieurs paires");
  }

  console.log("Paire SushiSwap:", sushiPairAddress);
  console.log("Paire QuickSwap:", quickswapPairAddress);

  // Mise à jour des paires à surveiller
  pairsToMonitor.push(
    sushiPairAddress.toLowerCase(),
    quickswapPairAddress.toLowerCase()
  );
}

// Liste des paires à surveiller (remplie après chargement)
const pairsToMonitor = [];

// === Vérification des nouveaux blocs ===
async function checkNewBlocks() {
  try {
    const latestBlockNumber = Number(await web3.eth.getBlockNumber());

    if (lastBlockChecked && latestBlockNumber > lastBlockChecked) {
      console.log(`Nouveau bloc détecté : ${latestBlockNumber}`);

      const logs = await web3.eth.getPastLogs({
        fromBlock: lastBlockChecked + 1,
        toBlock: latestBlockNumber,
        topics: [SWAP_EVENT_TOPIC],
      });

      for (const log of logs) {
        if (pairsToMonitor.includes(log.address.toLowerCase())) {
          console.log(
            `[Opportunité détectée] Swap dans la paire : ${log.address}`
          );
        }
      }

      lastBlockChecked = latestBlockNumber;
    } else if (!lastBlockChecked) {
      lastBlockChecked = latestBlockNumber;
      console.log(`Démarrage du bot - Bloc initial : ${lastBlockChecked}`);
    }
  } catch (error) {
    console.error("Erreur lors de la vérification des blocs :", error);
  }
}

// === Récupère les réserves d'une paire ===
async function getReserves(pairAddress) {
  const pairContract = new web3.eth.Contract(IUniswapV2Pair.abi, pairAddress);
  const reserves = await pairContract.methods.getReserves().call();
  return reserves; // reserve0, reserve1, blockTimestampLast
}

// === Récupère le prix de MATIC en USD ===
let cachedWmaticPrice = null;
let lastPriceUpdate = 0;

async function getWmaticPriceInUSD() {
  const now = Date.now();
  const cacheDuration = 60 * 1000; // 1 minute

  if (cachedWmaticPrice && now - lastPriceUpdate < cacheDuration) {
    return cachedWmaticPrice;
  }

  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: {
          ids: "matic-network",
          vs_currencies: "usd",
        },
      }
    );

    cachedWmaticPrice = response.data["matic-network"].usd;
    lastPriceUpdate = now;

    return cachedWmaticPrice;
  } catch (error) {
    console.error("Erreur lors de la récupération du prix de MATIC :", error);
    return cachedWmaticPrice || null; // Retourne le dernier prix connu s'il existe
  }
}

// === Calcule le prix du token en USD ===
async function getTokenPriceInUSD(pairAddress, tokenIsToken0 = true) {
  const reserves = await getReserves(pairAddress);
  const wmaticPriceUSD = await getWmaticPriceInUSD();

  if (!wmaticPriceUSD) return null;

  const reserveToken = BigInt(tokenIsToken0 ? reserves.reserve0 : reserves.reserve1);
  const reserveWmatic = BigInt(tokenIsToken0 ? reserves.reserve1 : reserves.reserve0);

  if (reserveToken === "0n" || reserveWmatic === "0n") return null;

  const pricePerTokenInWmatic = Number(reserveWmatic) / Number(reserveToken);
  const pricePerTokenInUSD = pricePerTokenInWmatic * wmaticPriceUSD;

  console.log("TOEKEN PRICE",pricePerTokenInUSD);

  return pricePerTokenInUSD;
}

// === Compare les prix entre SushiSwap et QuickSwap ===
async function checkArbitrageOpportunity() {
  const priceOnSushi = await getTokenPriceInUSD(sushiPairAddress, true); // USDC est token0
  const priceOnQuickswap = await getTokenPriceInUSD(quickswapPairAddress, true);

  if (!priceOnSushi || !priceOnQuickswap) {
    console.log("Impossible de récupérer les prix");
    return;
  }

  console.log(`Prix sur SushiSwap : $${priceOnSushi.toFixed(6)}`);
  console.log(`Prix sur QuickSwap : $${priceOnQuickswap.toFixed(6)}`);

  const diff = Math.abs(priceOnSushi - priceOnQuickswap);
  const diffPercent = (diff / Math.min(priceOnSushi, priceOnQuickswap)) * 100;

  if (diffPercent > 1) {
    // seuil ajustable
    console.log(
      `🚨 Opportunité détectée ! Écart de ${diffPercent.toFixed(2)}%`
    );
  } else {
    console.log(`Aucune opportunité détectée (${diffPercent.toFixed(2)}%)`);
  }
}

// === Lancement du bot ===
async function startBot() {
  await loadPairAddresses();

  setInterval(async () => {
    await checkNewBlocks(); // vérifie les nouveaux blocs
    await checkArbitrageOpportunity(); // compare les prix
  }, 5000);

  console.log("Bot lancé !");
}

startBot();
