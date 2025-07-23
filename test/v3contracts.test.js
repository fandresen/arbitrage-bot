// __tests__/v3contracts.test.js

const { getV3PoolAddress, getV3PoolState, createV3Pool } = require("../utils/v3contracts");
const { Token } = require("@uniswap/sdk-core");
const { Pool } = require("@uniswap/v3-sdk");
const ethers = require("ethers");

// Mocker le module ethers
jest.mock("ethers");

// Mocker le SDK Uniswap V3 pour vérifier les instances
jest.mock("@uniswap/v3-sdk", () => ({
  ...jest.requireActual("@uniswap/v3-sdk"), // Importer les vraies fonctions
  Pool: jest.fn(), // Mocker le constructeur Pool
}));

const mockProvider = {}; // Objet factice pour le provider ethers
const WBNB = new Token(56, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 18, "WBNB");
const USDT = new Token(56, "0x55d398326f99059fF775485246999027B3197955", 6, "USDT");

describe("v3contracts.js", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getV3PoolAddress", () => {
    const mockFactoryContract = {
      getPool: jest.fn(),
    };
    beforeEach(() => {
      ethers.Contract.mockReturnValue(mockFactoryContract);
    });

    it("devrait retourner l'adresse de la pool V3", async () => {
      const poolAddress = "0xPoolAddress";
      mockFactoryContract.getPool.mockResolvedValue(poolAddress);

      const result = await getV3PoolAddress("factory", WBNB, USDT, 500, mockProvider);
      expect(result).toBe(poolAddress);
      expect(mockFactoryContract.getPool).toHaveBeenCalledWith(WBNB.address, USDT.address, 500);
    });

    it("devrait retourner null si la pool n'est pas trouvée (adresse zéro)", async () => {
      mockFactoryContract.getPool.mockResolvedValue("0x0000000000000000000000000000000000000000");
      const result = await getV3PoolAddress("factory", WBNB, USDT, 500, mockProvider);
      expect(result).toBeNull();
    });
  });

  describe("getV3PoolState", () => {
    const mockPoolContract = {
      slot0: jest.fn(),
      liquidity: jest.fn(),
    };
    beforeEach(() => {
      ethers.Contract.mockReturnValue(mockPoolContract);
    });

    it("devrait retourner l'état de la pool V3", async () => {
      const mockSlot0 = { sqrtPriceX96: "12345", tick: 123 };
      const mockLiquidity = "1000000";

      mockPoolContract.slot0.mockResolvedValue(mockSlot0);
      mockPoolContract.liquidity.mockResolvedValue(mockLiquidity);

      const result = await getV3PoolState("poolAddress", mockProvider);
      expect(result).toEqual({
        sqrtPriceX96: BigInt(mockSlot0.sqrtPriceX96),
        tick: Number(mockSlot0.tick),
        liquidity: BigInt(mockLiquidity),
      });
    });

    it("devrait retourner null en cas d'erreur", async () => {
      mockPoolContract.slot0.mockRejectedValue(new Error("Erreur de contrat"));
      const result = await getV3PoolState("poolAddress", mockProvider);
      expect(result).toBeNull();
    });
  });

  describe("createV3Pool", () => {
    it("devrait créer une instance de Pool V3 en ordonnant correctement les tokens", () => {
      createV3Pool(USDT, WBNB, 500, BigInt("123"), 10, BigInt("456"));
      const [token0, token1] = WBNB.sortsBefore(USDT) ? [WBNB, USDT] : [USDT, WBNB];
      
      // Vérifie que le constructeur Pool est appelé avec les bons arguments
      expect(Pool).toHaveBeenCalledWith(token0, token1, 500, expect.anything(), expect.anything(), 10);
    });
  });
});