// executeArbitrageFlashLoan.js
const axios = require("axios");

async function executeFlashLoanArbitrage(
  contract,
  { log, sendEmailNotification, parseUnits },
  loanAmountToken0,
  loanAmountToken1,
  swap1Params,
  swap2Params
) {
  log("⚡ Preparing PRIVATE Flash Loan execution via 48 Club...");

  // SUPPRIMÉ : Le check pour l'en-tête d'autorisation de bloXroute n'est plus nécessaire.

  try {
    const signer = contract.runner;
    const address = await signer.getAddress();
    
    // CORRIGÉ : Le nonce doit être exact. N'ajoutez pas +2, cela bloquerait vos transactions.
    const nonce = await signer.provider.getTransactionCount(address);
    const chainId = (await signer.provider.getNetwork()).chainId;
    
    // NOTE : Ce gasPrice est compétitif, vous pouvez le garder.
    const gasPrice = parseUnits("3", "gwei"); 

    // ATTENTION : 40,000 est beaucoup trop bas. J'ai remis une valeur sûre de 750,000.
    const gasLimit = BigInt(250000); 
    log(`⛽ Using manual gas limit: ${gasLimit.toString()}`);

    const tx = {
      to: await contract.getAddress(),
      data: contract.interface.encodeFunctionData("executeArbitrage", [
        loanAmountToken0,
        loanAmountToken1,
        swap1Params,
        swap2Params,
      ]),
      gasPrice,
      gasLimit: gasLimit,
      nonce,
      chainId,
      value: 0,
      type: 0, 
    };

    const signedTx = await signer.signTransaction(tx);
    
    // SUPPRIMÉ : On ne retire plus le "0x". La méthode eth_sendRawTransaction en a besoin.
    console.log("SIGNED TRANSACTION: ", signedTx);

    // CHANGÉ : Envoi de la transaction à l'endpoint de 48 Club avec le format standard.
    log(`🔒 Sending raw private transaction to 48 Club...`);
    const { data } = await axios.post(
      "https://rpc.48.club", // NOUVELLE URL
      {
        jsonrpc: "2.0",
        method: "eth_sendRawTransaction", // NOUVELLE MÉTHODE
        params: [signedTx], // NOUVEAU FORMAT DE PARAMÈTRES (un tableau avec la tx signée)
        id: 1,
      },
      // SUPPRIMÉ : L'en-tête d'autorisation n'est plus nécessaire.
    );

    if (data.error) {
      throw new Error(`48 Club API Error: ${data.error.message}`);
    }

    // CORRIGÉ : La réponse standard renvoie le hash directement dans "result".
    const txHash = data.result;
    log(`✅ PRIVATE Transaction sent via 48 Club. Hash: ${txHash}`);

    sendEmailNotification(
      "Private TX Sent via 48 Club",
      `Arbitrage transaction successfully sent. Hash: ${txHash}`
    );

  } catch (error) {
    const errorMessage = error?.response?.data?.error?.message || error.message;
    log("❌ Error sending private transaction to 48 Club:", errorMessage);
    sendEmailNotification(
      "Private Arbitrage FAILED",
      `The private transaction via 48 Club failed. Reason: ${errorMessage}`
    );
  } finally {
    log("⏹️ End of 48 Club execution attempt.");
  }
}

module.exports = { executeFlashLoanArbitrage };