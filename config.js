require("dotenv").config();
// config.js
const WMATIC_ADDRESS = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"; // 18 décimales
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // 6 décimales

const TOKEN_DECIMALS = {
  [WMATIC_ADDRESS.toLowerCase()]: 18,
  [USDC_ADDRESS.toLowerCase()]: 6,
};

const QUICKSWAP_FACTORY = "0x5757371414417b8c6caad45baef941abc7d3ab32";
const SUSHISWAP_FACTORY = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";

// Frais des DEX (0.3% = 0.003)
const DEX_FEE = 0.003;
// Frais Aave Flash Loan (0.05% = 0.0005)
const AAVE_FLASH_LOAN_FEE = 0.0009;

// Le montant minimal d'USDC à tester pour le flash loan
const MIN_LOAN_AMOUNT_USDC = 1000;
// Le montant maximal d'USDC à tester pour le flash loan
const MAX_LOAN_AMOUNT_USDC = 500000;
const LOAN_AMOUNT_INCREMENT_USDC = 5000;

// Seuil de profit net minimum en USD pour déclencher l'alerte
const PROFIT_THRESHOLD_USD = 5; // Par exemple, 5 USD de profit net minimum

// Configuration pour l'envoi d'e-mails (pour Nodemailer)
const EMAIL_CONFIG = {
  SERVICE: "gmail", // ou 'Outlook365', etc.
  AUTH: {
    USER: process.env.EMAIL_USER, // Votre adresse e-mail
    PASS: process.env.EMAIL_PASS, // Mot de passe d'application ou mot de passe réel (moins sécurisé)
  },
  TO_EMAIL: process.env.EMAIL_RECEIVER, // L'adresse où envoyer les notifications
};



module.exports = {
  WMATIC_ADDRESS,
  USDC_ADDRESS,
  TOKEN_DECIMALS,
  QUICKSWAP_FACTORY,
  SUSHISWAP_FACTORY,
  DEX_FEE,
  AAVE_FLASH_LOAN_FEE,
  PROFIT_THRESHOLD_USD,
  EMAIL_CONFIG,
  MIN_LOAN_AMOUNT_USDC,
  MAX_LOAN_AMOUNT_USDC,
  LOAN_AMOUNT_INCREMENT_USDC
};
