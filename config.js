// config.js
require("dotenv").config();
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

const TOKEN_DECIMALS = {
  [WBNB_ADDRESS.toLowerCase()]: 18,
  [USDT_ADDRESS.toLowerCase()]: 18,
};

//Adress du contrat déployé
const FLASH_LOAN_CONTRACT_ADDRESS =
  "0x1Fa2419E56698d5D3D1Bf79Df996Ef048B8a60d5";

const PANCAKESWAP_V3_QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";

const UNISWAP_V3_ROUTER = "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2";
const UNISWAP_V3_QUOTER_V2 = "0x78D78E420Da98ad378D7799bE8f4AF69033EB077"; // Quoter V2 pour Uniswap V3
const UNISWAP_V3_FACTORY = "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7";

// Adresses PancakeSwap V3
const PANCAKESWAP_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const PANCAKESWAP_V3_ROUTER = "0x1b02dA8Cb0d097e5387A0955B00D866aE53f05A1"; // SwapRouter V3

// Tiers de frais de PancakeSwap V3 (en centièmes de pourcent)
const PANCAKESWAP_V3_FEE_TIERS = {
  LOWEST: 100, // 0.01%
  LOW: 500, // 0.05%
  MEDIUM: 2500, // 0.25% (équivalent V2)
  HIGH: 10000, // 1.00%
};

// Tiers de frais de Uniswap V3 (en centièmes de pourcent)
const UNISWAP_V3_FEE_TIERS = {
  LOWEST: 100, // 0.01%
  LOW: 500, // 0.05%
  MEDIUM: 3000, // 0.3%
  HIGH: 10000, // 1.00%
};

const RPC_ENDPOINTS = [
  {
    name: "Fandresena Alchemy RPC",
    http: "https://bnb-mainnet.g.alchemy.com/v2/V32WNKvP7Geb6Oh9Zl8Sq41Zd3ciglTe",
    ws: "wss://bnb-mainnet.g.alchemy.com/v2/V32WNKvP7Geb6Oh9Zl8Sq41Zd3ciglTe",
    priority: 2,
  },
  {
    name: "GetBlock RPC",
    http: "https://go.getblock.us/6cce03c521d64f2e8fdd93cc6b7cb25a",
    ws: "wss://go.getblock.us/d4e31013c632424183997fef89762cdf",
    priority: 5,
  },
  {
    name: "Eliot Alchemy RPC",
    http: "https://bnb-mainnet.g.alchemy.com/v2/14Gw9w9XdifwLSUg_JPKj", // ← change avec ton vrai endpoint
    ws: "wss://bnb-mainnet.g.alchemy.com/v2/14Gw9w9XdifwLSUg_JPKj", // ← si le provider supporte WS
    priority: 2,
  },
  {
    name: "NodeReal RPC",
    http: "https://bsc-mainnet.nodereal.io/v1/f8d0a3bdcbef47388cd3777086e0e4b5",
    ws: "wss://bsc-mainnet.nodereal.io/ws/v1/f8d0a3bdcbef47388cd3777086e0e4b5",
    priority: 1,
  },
  {
    name: "Chainstack RPC",
    http: "https://bsc-mainnet.core.chainstack.com/609717acc329b17e29745c0317ccf0ef",
    ws: "wss://bsc-mainnet.core.chainstack.com/609717acc329b17e29745c0317ccf0ef", // certains drpc supportent WS
    priority: 3,
  },
];

// Frais flashloan = 0.001%
const FLASH_LOAN_FEE = 0.0;

// Montants de prêt pour la simulation
const MIN_LOAN_AMOUNT_USDT = 1000;
const MAX_LOAN_AMOUNT_USDT = 26000;
const LOAN_AMOUNT_INCREMENT_USDT = 5000;

// Seuil de profit net minimum en USD pour déclencher l'alerte
const PROFIT_THRESHOLD_USD = 5;

// const SLIPPAGE_TOLERANCE = 0.005; // 0.5% de tolérance au slippage

// Configuration pour l'envoi d'e-mails (pour Nodemailer)
const EMAIL_CONFIG = {
  SERVICE: "gmail",
  AUTH: {
    USER: process.env.EMAIL_USER,
    PASS: process.env.EMAIL_PASS,
  },
  TO_EMAIL: process.env.EMAIL_RECEIVER,
};

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

module.exports = {
  WBNB_ADDRESS,
  USDT_ADDRESS,
  TOKEN_DECIMALS,
  UNISWAP_V3_ROUTER,
  UNISWAP_V3_QUOTER_V2,
  UNISWAP_V3_FEE_TIERS,

  PANCAKESWAP_V3_ROUTER, // Exporté
  PANCAKESWAP_V3_FEE_TIERS, // Exporté
  PANCAKESWAP_V3_FACTORY,
  UNISWAP_V3_FACTORY,

  VENUS_FLASH_LOAN_FEE: FLASH_LOAN_FEE,
  PROFIT_THRESHOLD_USD,
  EMAIL_CONFIG,
  MIN_LOAN_AMOUNT_USDT,
  MAX_LOAN_AMOUNT_USDT,
  LOAN_AMOUNT_INCREMENT_USDT,

  PANCAKESWAP_V3_QUOTER_V2,
  // SLIPPAGE_TOLERANCE,
  FLASH_LOAN_CONTRACT_ADDRESS,
  SLACK_WEBHOOK_URL,

  RPC_ENDPOINTS,
};
