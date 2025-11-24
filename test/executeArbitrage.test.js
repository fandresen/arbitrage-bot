// __tests__/executeArbitrage.test.js

const { executeFlashLoanArbitrage } = require("../utils/executeArbitrageFlashLoan");
const axios = require("axios");
const ethers = require("ethers");

// Mocker les dépendances externes
jest.mock("axios");

describe("executeFlashLoanArbitrage", () => {
  let mockContract, mockSigner, dependencies;

  beforeEach(() => {
    // Mocker le signer ethers
    mockSigner = {
      getAddress: jest.fn().mockResolvedValue("0xSignerAddress"),
      provider: {
        getTransactionCount: jest.fn().mockResolvedValue(10),
        getNetwork: jest.fn().mockResolvedValue({ chainId: 56 }),
        waitForTransaction: jest.fn().mockResolvedValue({ status: 1 }), // Default success
      },
      signTransaction: jest.fn().mockResolvedValue("0xsignedTransaction"),
    };
    
    // Mocker le contrat ethers
    mockContract = {
      runner: mockSigner,
      getAddress: jest.fn().mockResolvedValue("0xContractAddress"),
      interface: {
        encodeFunctionData: jest.fn().mockReturnValue("0xencodedData"),
      },
      executeArbitrage: {
        estimateGas: jest.fn().mockResolvedValue(BigInt(200000)),
      },
    };

    // Mocker les dépendances injectées
    dependencies = {
      log: jest.fn(),
      sendEmailNotification: jest.fn(),
      sendSlackNotification: jest.fn(),
      parseUnits: ethers.parseUnits, // Utiliser le vrai parseUnits
    };

    // Nettoyer les mocks d'axios
    axios.post.mockClear();
  });

  it("devrait construire et envoyer une transaction privée via 48 Club", async () => {
    axios.post.mockResolvedValue({ data: { result: "0xtxHash" } });

    const expectedProfit = { profit: 10.5, path: "Uni -> Pancake" };

    await executeFlashLoanArbitrage(
      mockContract,
      dependencies,
      BigInt(1000), // loanAmountToken0
      BigInt(0),   // loanAmountToken1
      {},          // swap1Params
      {},          // swap2Params
      expectedProfit
    );

    // Vérifier l'estimation de gaz
    expect(mockContract.executeArbitrage.estimateGas).toHaveBeenCalled();
    
    // Vérifier la signature de la transaction
    expect(mockSigner.signTransaction).toHaveBeenCalled();
    
    // Vérifier l'appel à 48 Club
    expect(axios.post).toHaveBeenCalledWith(
      "https://rpc.48.club",
      expect.objectContaining({
        method: "eth_sendRawTransaction",
        params: ["0xsignedTransaction"],
        id: 1,
      })
    );

    // Vérifier les notifications
    expect(dependencies.log).toHaveBeenCalledWith(expect.stringContaining("Transaction sent via 48 Club"));
    expect(dependencies.sendSlackNotification).toHaveBeenCalledWith(
        expect.stringContaining("Arbitrage TX Sent via 48 Club"),
        "info"
    );

    // Vérifier la confirmation et le succès
    expect(dependencies.sendEmailNotification).toHaveBeenCalledWith(
        "💰 Arbitrage PROFIT Confirmed!",
        expect.stringContaining("Transaction 0xtxHash was successful")
    );
    expect(dependencies.sendSlackNotification).toHaveBeenCalledWith(
        expect.stringContaining("Arbitrage PROFIT Confirmed"),
        "success"
    );
  });

  it("devrait gérer une erreur de l'API 48 Club", async () => {
    const error = { response: { data: { error: { message: "48 Club error" } } } };
    axios.post.mockRejectedValue(error);

    await executeFlashLoanArbitrage(mockContract, dependencies, BigInt(1000), 0n, {}, {}, {});
    
    expect(dependencies.log).toHaveBeenCalledWith(
        "❌ Error sending private transaction to 48 Club:", "48 Club error"
    );
    expect(dependencies.sendSlackNotification).toHaveBeenCalledWith(
        expect.stringContaining("Private Arbitrage FAILED"),
        "error"
    );
  });
});