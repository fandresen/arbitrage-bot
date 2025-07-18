// executeArbitrageFlashLoan.js

// CORRIGÉ: Ajout de la dépendance axios et conversion en CommonJS
const axios = require("axios");

/**
 * Construit, signe et envoie une transaction d'arbitrage privée via un RPC spécifique.
 *
 * @param {ethers.Contract} contract - L'instance du contrat.
 * @param {object} dependencies - Les fonctions et utilitaires nécessaires.
 * @param {function} dependencies.log - La fonction de logging.
 * @param {function} dependencies.sendEmailNotification - La fonction pour notifier par email.
 * @param {function} dependencies.parseUnits - L'utilitaire ethers.parseUnits.
 * @param {BigInt} loanAmountToken0 - Le montant de token0 à emprunter.
 * @param {BigInt} loanAmountToken1 - Le montant de token1 à emprunter.
 * @param {object} swap1Params - Les paramètres du premier swap.
 * @param {object} swap2Params - Les paramètres du second swap.
 */
async function executeFlashLoanArbitrage(
  contract,
  { log, sendEmailNotification, parseUnits },
  loanAmountToken0,
  loanAmountToken1,
  swap1Params,
  swap2Params
) {
  log("⚡ Preparing PRIVATE Flash Loan execution via 48.club...");

  try {
    // ADAPTÉ: Utilisation de contract.runner pour ethers v6
    const signer = contract.runner;
    const address = await signer.getAddress();

    // Encode les données de la fonction à appeler
    const encodedData = contract.interface.encodeFunctionData("executeArbitrage", [
      loanAmountToken0,
      loanAmountToken1,
      swap1Params,
      swap2Params,
    ]);

    // Récupération des informations nécessaires pour la transaction
    const nonce = await signer.provider.getTransactionCount(address);
    const chainId = (await signer.provider.getNetwork()).chainId;
    
    // ADAPTÉ: Utilisation de la fonction parseUnits injectée
    const gasPrice = parseUnits("15", "gwei"); // Prix du gaz requis par 48.club

    const gasEstimate = await contract.executeArbitrage.estimateGas(
      loanAmountToken0,
      loanAmountToken1,
      swap1Params,
      swap2Params
    );
    log(`⛽ Estimated Gas: ${gasEstimate.toString()}`);

    // Construction de l'objet de la transaction
    const tx = {
      to: await contract.getAddress(), // ADAPTÉ: contract.address est maintenant une promesse
      data: encodedData,
      gasPrice,
      // ADAPTÉ: Utilisation de l'opérateur BigInt natif pour ethers v6
      gasLimit: gasEstimate + BigInt(100000), 
      nonce,
      chainId,
      value: 0, // Pas de transfert de BNB natif
      type: 0,  // Transaction de type "legacy" souvent requise pour les RPC privés
    };

    const signedTx = await signer.signTransaction(tx);

    // Envoi de la transaction signée via une requête POST à 48.club
    log(`🔒 Sending raw private transaction to 48.club...`);
    const { data } = await axios.post("https://rpc.48.club", {
      jsonrpc: "2.0",
      method: "eth_sendRawPrivateTransaction",
      params: [signedTx],
      id: 1,
    });

    if (data.error) {
        throw new Error(data.error.message);
    }

    const txHash = data.result;
    log(`✅ PRIVATE Transaction sent via 48.club. Hash: ${txHash}`);

    sendEmailNotification(
      "Private TX Sent",
      `Arbitrage transaction sent via 48.club. Hash: ${txHash}`
    );

  } catch (error) {
    const errorMessage = error?.response?.data?.error?.message || error.message;
    log("❌ Error sending private transaction:", errorMessage);
    sendEmailNotification(
      "Private Arbitrage FAILED",
      `The private transaction failed. Reason: ${errorMessage}`
    );
  } finally {
    log("⏹️ End of private execution attempt.");
  }
}

// CORRIGÉ: Utilisation de module.exports
module.exports = { executeFlashLoanArbitrage };