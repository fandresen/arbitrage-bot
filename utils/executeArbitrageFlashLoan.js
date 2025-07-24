// executeArbitrageFlashLoan.js
const axios = require("axios");

async function executeFlashLoanArbitrage(
  contract,
  { log, sendEmailNotification, parseUnits, timer },
  loanAmountToken0,
  loanAmountToken1,
  swap1Params,
  swap2Params
) {
  log("⚡ Preparing PRIVATE Flash Loan execution via 48 Club...");

  try {
    const signer = contract.runner;
    const address = await signer.getAddress();

    const nonce = await signer.provider.getTransactionCount(address);
    const chainId = (await signer.provider.getNetwork()).chainId;

    const gasPrice = parseUnits("3", "gwei");

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

    console.log("SIGNED TRANSACTION: ", signedTx);

    //Arrêter le chronomètre
    const elapsedTimeInSeconds = timer.stop();
    log(
      `⏱️ Time from detection to submission: ${elapsedTimeInSeconds.toFixed(
        3
      )} seconds.`
    );

    log(`🔒 Sending raw private transaction to 48 Club...`);
    const { data } = await axios.post("https://rpc.48.club", {
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      params: [signedTx],
      id: 1,
    });

    if (data.error) {
      throw new Error(`48 Club API Error: ${data.error.message}`);
    }

    const txHash = data.result;
    const emailBody = `Arbitrage transaction successfully sent.

  Hash: ${txHash} 
  Time from detection to submission: ${elapsedTimeInSeconds.toFixed(
    3
  )} seconds.`;

    sendEmailNotification("Private TX Sent via 48 Club", emailBody);
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
