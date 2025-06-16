// config.js
require("dotenv").config();
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

const TOKEN_DECIMALS = {
  [WBNB_ADDRESS.toLowerCase()]: 18,
  [USDT_ADDRESS.toLowerCase()]: 6,
};

const PANCAKESWAP_V3_QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";

// Adresses PancakeSwap V2
const PANCAKESWAP_V2_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const PANCAKESWAP_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // Ajouté pour les swaps V2

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

// Frais des DEX (en décimal, ex: 0.3% = 0.003)
const PANCAKESWAP_V2_FEE = 0.0025; // PancakeSwap V2 (0.25%)

// Frais Venus Protocol Flash Loan (0.09% = 0.0009)
const VENUS_FLASH_LOAN_FEE = 0.0009;

// Montants de prêt pour la simulation
const MIN_LOAN_AMOUNT_USDT = 1000;
const MAX_LOAN_AMOUNT_USDT = 500000;
const LOAN_AMOUNT_INCREMENT_USDT = 100000;

// Seuil de profit net minimum en USD pour déclencher l'alerte
const PROFIT_THRESHOLD_USD = 5;

// Configuration pour l'envoi d'e-mails (pour Nodemailer)
const EMAIL_CONFIG = {
  SERVICE: "gmail",
  AUTH: {
    USER: process.env.EMAIL_USER,
    PASS: process.env.EMAIL_PASS,
  },
  TO_EMAIL: process.env.EMAIL_RECEIVER,
};

module.exports = {
  WBNB_ADDRESS,
  USDT_ADDRESS,
  TOKEN_DECIMALS,

  PANCAKESWAP_V2_FACTORY,
  PANCAKESWAP_V2_ROUTER, // Exporté
  PANCAKESWAP_V2_FEE,

  PANCAKESWAP_V3_FACTORY,
  PANCAKESWAP_V3_ROUTER, // Exporté
  PANCAKESWAP_V3_FEE_TIERS, // Exporté

  VENUS_FLASH_LOAN_FEE,
  PROFIT_THRESHOLD_USD,
  EMAIL_CONFIG,
  MIN_LOAN_AMOUNT_USDT,
  MAX_LOAN_AMOUNT_USDT,
  LOAN_AMOUNT_INCREMENT_USDT,

  PANCAKESWAP_V3_QUOTER_V2,
};
