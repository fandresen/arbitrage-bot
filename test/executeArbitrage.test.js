// __tests__/executeArbitrage.test.js

const { executeFlashLoanArbitrage } = require("../utils/executeArbitrageFlashLoan");
const axios = require("axios");
const ethers = require("ethers");

// Mocker les dépendances externes
jest.mock("axios");

// Variables d'environnement
process.env.BLOXROUTE_AUTH_HEADER = "fake-auth-header";

describe("executeFlashLoanArbitrage", () => {
  let mockContract, mockSigner, dependencies;

  beforeEach(() => {
    // Mocker le signer ethers
    mockSigner = {
      getAddress: jest.fn().mockResolvedValue("0xSignerAddress"),
      provider: {
        getTransactionCount: jest.fn().mockResolvedValue(10),
        getNetwork: jest.fn().mockResolvedValue({ chainId: 56 }),
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
      parseUnits: ethers.parseUnits, // Utiliser le vrai parseUnits
    };

    // Nettoyer les mocks d'axios
    axios.post.mockClear();
  });

  it("devrait construire et envoyer une transaction privée via bloXroute", async () => {
    axios.post.mockResolvedValue({ data: { result: "0xtxHash" } });

    await executeFlashLoanArbitrage(
      mockContract,
      dependencies,
      BigInt(1000), // loanAmountToken0
      BigInt(0),   // loanAmountToken1
      {},          // swap1Params
      {}           // swap2Params
    );

    // Vérifier l'estimation de gaz
    expect(mockContract.executeArbitrage.estimateGas).toHaveBeenCalled();
    
    // Vérifier la signature de la transaction
    expect(mockSigner.signTransaction).toHaveBeenCalled();
    
    // Vérifier l'appel à bloXroute
    expect(axios.post).toHaveBeenCalledWith(
      "https://api.blxrbdn.com/",
      expect.objectContaining({
        method: "bsc_private_tx",
        params: { transaction: "signedTransaction" }, // "0x" est enlevé par la fonction
      }),
      expect.objectContaining({
        headers: {
          "Authorization": "fake-auth-header",
          "Content-Type": "application/json",
        },
      })
    );

    // Vérifier les notifications
    expect(dependencies.log).toHaveBeenCalledWith("✅ PRIVATE Transaction sent via bloXroute. Hash: 0xtxHash");
    expect(dependencies.sendEmailNotification).toHaveBeenCalledWith(
        "Private TX Sent via bloXroute",
        "Arbitrage transaction successfully sent. Hash: 0xtxHash"
    );
  });

  it("devrait gérer une erreur de l'API bloXroute", async () => {
    const error = { response: { data: { error: { message: "bloXroute error" } } } };
    axios.post.mockRejectedValue(error);

    await executeFlashLoanArbitrage(mockContract, dependencies, BigInt(1000), 0n, {}, {});
    
    expect(dependencies.log).toHaveBeenCalledWith(
        "❌ Error sending private transaction to bloXroute:", "bloXroute error"
    );
    expect(dependencies.sendEmailNotification).toHaveBeenCalledWith(
        "Private Arbitrage FAILED",
        "The private transaction via bloXroute failed. Reason: bloXroute error"
    );
  });

  it("ne devrait rien faire si BLOXROUTE_AUTH_HEADER n'est pas défini", async () => {
    delete process.env.BLOXROUTE_AUTH_HEADER;

    await executeFlashLoanArbitrage(mockContract, dependencies, BigInt(1000), 0n, {}, {});

    expect(axios.post).not.toHaveBeenCalled();
    expect(dependencies.sendEmailNotification).toHaveBeenCalledWith(
        "Private Arbitrage FAILED",
        "The private transaction failed because the BLOXROUTE_AUTH_HEADER is missing."
    );

    // Rétablir pour les autres tests
    process.env.BLOXROUTE_AUTH_HEADER = "fake-auth-header";
  });
});