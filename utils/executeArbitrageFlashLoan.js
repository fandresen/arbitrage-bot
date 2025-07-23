// executeArbitrageFlashLoan.js
const axios = require("axios");

/**
 * Construit, signe et envoie une transaction d'arbitrage privée via l'API bloXroute.
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
  log("⚡ Preparing PRIVATE Flash Loan execution via bloXroute...");

  // Assurez-vous que votre clé d'autorisation bloXroute est définie dans vos variables d'environnement
  if (!process.env.BLOXROUTE_AUTH_HEADER) {
    log("❌ Error: BLOXROUTE_AUTH_HEADER environment variable not set.");
    sendEmailNotification(
      "Private Arbitrage FAILED",
      "The private transaction failed because the BLOXROUTE_AUTH_HEADER is missing."
    );
    return;
  }

  try {
    const signer = contract.runner;
    const address = await signer.getAddress();
    const nonce = await signer.provider.getTransactionCount(address);
    const chainId = (await signer.provider.getNetwork()).chainId;
    const gasPrice = parseUnits("15", "gwei"); // Un prix du gaz compétitif

    // Estimation du gaz
    // const gasEstimate = await contract.executeArbitrage.estimateGas(
    //   loanAmountToken0,
    //   loanAmountToken1,
    //   swap1Params,
    //   swap2Params
    // );
    // log(`⛽ Estimated Gas: ${gasEstimate.toString()}`);

    const gasLimit = BigInt(750000);

    // Construction de l'objet de la transaction
    const tx = {
      to: await contract.getAddress(),
      data: contract.interface.encodeFunctionData("executeArbitrage", [
        loanAmountToken0,
        loanAmountToken1,
        swap1Params,
        swap2Params,
      ]),
      gasPrice,
      gasLimit: gasLimit, // Ajout d'une marge de sécurité
      nonce,
      chainId,
      value: 0,
      type: 0, // Transaction Legacy
    };

    // Signature de la transaction
    const signedTx = await signer.signTransaction(tx);
    
    // La documentation de bloXroute spécifie "Raw transactions bytes without 0x prefix"
    const transactionWithoutPrefix = signedTx.substring(2);

    // Envoi de la transaction signée via une requête POST à bloXroute
    log(`🔒 Sending raw private transaction to bloXroute...`);
    const { data } = await axios.post(
      "https://api.blxrbdn.com/", // Endpoint de l'API bloXroute
      {
        jsonrpc: "2.0",
        method: "bsc_private_tx", // Méthode pour la BSC
        params: {
          transaction: transactionWithoutPrefix, // Transaction signée sans le préfixe "0x"
        },
        id: "1",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": process.env.BLOXROUTE_AUTH_HEADER, // Votre clé d'autorisation
        },
      }
    );

    if (data.error) {
      throw new Error(`bloXroute Error: ${data.error.message}`);
    }

    const txHash = data.result.txHash;
    log(`✅ PRIVATE Transaction sent via bloXroute. Hash: ${txHash}`);

    sendEmailNotification(
      "Private TX Sent via bloXroute",
      `Arbitrage transaction successfully sent. Hash: ${txHash}`
    );

  } catch (error) {
    const errorMessage = error?.response?.data?.error?.message || error.message;
    log("❌ Error sending private transaction to bloXroute:", errorMessage);
    sendEmailNotification(
      "Private Arbitrage FAILED",
      `The private transaction via bloXroute failed. Reason: ${errorMessage}`
    );
  } finally {
    log("⏹️ End of bloXroute execution attempt.");
  }
}

module.exports = { executeFlashLoanArbitrage };