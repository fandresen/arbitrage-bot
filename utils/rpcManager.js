// utils/rpcManager.js
const { JsonRpcProvider } = require("ethers");
const { Web3 } = require("web3");
const { sendSlackNotification } = require("./slackNotifier");

let currentIndex = 0;
let rpcList = [];
let isSwitching = false;

function log(...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...args);
}

function initRpcList(listFromConfig) {
  rpcList = [...listFromConfig];
  log(`🔄 RPC Manager initialisé avec ${rpcList.length} endpoints`);
}

function getCurrentRpc() {
  return rpcList[currentIndex];
}

function getNextRpc() {
  currentIndex = (currentIndex + 1) % rpcList.length;
  const rpc = getCurrentRpc();
  log(`🔄 Switch vers le prochain RPC → ${rpc.name} (index ${currentIndex})`);
  return rpc;
}

function createHttpProvider() {
  const rpc = getCurrentRpc();
  return new JsonRpcProvider(rpc.http);
}

function createWsProvider() {
  const rpc = getCurrentRpc();

  return new Web3.providers.WebsocketProvider(rpc.ws, {
    reconnect: {
      // FIX : On passe ça à false ! C'est ton code qui gère le changement de RPC,
      // pas le module Web3.
      auto: false,
    },
    clientConfig: {
      keepalive: true,
      keepaliveInterval: 30000,
    },
  });
}

function switchToNextRpc() {
  if (isSwitching) {
    log("⏳ Switch RPC déjà en cours, ignoré...");
    return getCurrentRpc();
  }

  isSwitching = true;

  const oldIndex = currentIndex;
  const newRpc = getNextRpc();

  log(`🔄 Début du switch vers ${newRpc.name}...`);
  sendSlackNotification(`Switch RPC vers ${newRpc.name}` ,"warning")
  if (typeof global.stopBot === "function") global.stopBot();

  // Augmente le délai pour laisser le temps au nouveau provider de se stabiliser
  setTimeout(() => {
    log(`🚀 Redémarrage du bot avec le nouveau RPC : ${newRpc.name}`);
    if (typeof global.startBot === "function") global.startBot();
    isSwitching = false;
  }, 4500); // ← passe de 1500 à 3000ms

  return newRpc;
}

// Pour détecter les 429 / rate limit dans les erreurs ethers
function isRateLimitError(error) {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  return (
    error.statusCode === 429 ||
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota exceeded") ||
    msg.includes("monthly capacity")
  );
}

module.exports = {
  initRpcList,
  createHttpProvider,
  createWsProvider,
  switchToNextRpc,
  getCurrentRpc,
  isRateLimitError,
};
