// executeArbitrageFlashLoan.js
const axios = require("axios");

async function executeFlashLoanArbitrage(
  contract,
  { log, sendEmailNotification, sendSlackNotification, parseUnits },
  loanAmountToken0,
  loanAmountToken1,
  swap1Params,
  swap2Params,
  expectedProfit
) {
  log("⚡ Preparing PRIVATE Flash Loan execution via 48 Club...");

  try {
    log(`[Monitor] En attente de la confirmation de la transaction... (Timeout: 2 minutes)`);
    const signer = contract.runner;
    const address = await signer.getAddress();

    const nonce = await signer.provider.getTransactionCount(address);
    const chainId = (await signer.provider.getNetwork()).chainId;

    const gasPrice = parseUnits("3", "gwei");

    log("⛽ Estimating gas for the arbitrage transaction...");
    const estimatedGas = await contract.executeArbitrage.estimateGas(
      loanAmountToken0,
      loanAmountToken1,
      swap1Params,
      swap2Params
    );
    log(`   -> Gas estimated: ${estimatedGas.toString()}`);

    const gasLimit = (estimatedGas * 120n) / 100n;
    log(`   -> Gas limit with 20% margin: ${gasLimit.toString()}`);

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

    log(`🔒 Sending raw private transaction to 48 Club...`);
    const { data } = await axios.post(
      "https://rpc.48.club",
      {
        jsonrpc: "2.0",
        method: "eth_sendRawTransaction",
        params: [signedTx],
        id: 1,
      }
    );

    if (data.error) {
      throw new Error(`48 Club API Error: ${data.error.message}`);
    }

    const txHash = data.result;
    log(`✅ PRIVATE Transaction sent via 48 Club. Hash: ${txHash}`);

    sendSlackNotification(
      `Arbitrage TX Sent via 48 Club. Hash: ${txHash}`,
      "info"
    );

    // Wait for confirmation
    log(`⏳ Waiting for transaction confirmation...`);
    const receipt = await signer.provider.waitForTransaction(txHash, 1, 120000); // 1 confirmation, 2 min timeout

    if (receipt && receipt.status === 1) {
        log(`✅ Transaction Confirmed! Profit realized.`);
        sendEmailNotification(
            "💰 Arbitrage PROFIT Confirmed!",
            `Transaction ${txHash} was successful.\n\nExpected Profit: ${expectedProfit.profit.toFixed(4)} USD\nPath: ${expectedProfit.path}`
        );
        sendSlackNotification(`💰 Arbitrage PROFIT Confirmed! Hash: ${txHash}`, "success");
    } else {
        log(`❌ Transaction Reverted or Failed.`);
        sendSlackNotification(`❌ Arbitrage Transaction Failed/Reverted. Hash: ${txHash}`, "error");
    }

  } catch (error) {
    const errorMessage = error?.response?.data?.error?.message || error.message;
    log("❌ Error sending private transaction to 48 Club:", errorMessage);
    sendSlackNotification(
      `❌ Private Arbitrage FAILED. Reason: ${errorMessage}`,
      "error"
    );
  } finally {
    log("⏹️ End of 48 Club execution attempt.");
  }
}

module.exports = { executeFlashLoanArbitrage };
