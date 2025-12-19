// __tests__/calculations.test.js

const { getAmountOutV3, calculatePriceV3 } = require("../utils/calculations");
const ethers = require("ethers");
const { Token } = require("@uniswap/sdk-core");
const { Pool } = require("@uniswap/v3-sdk");

// Mocker le module ethers
jest.mock("ethers");

const WBNB_TOKEN = new Token(56, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 18, "WBNB");
const USDT_TOKEN = new Token(56, "0x55d398326f99059fF775485246999027B3197955", 6, "USDT");
const mockProvider = {};

describe("calculations.js", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // describe("getAmountOutV3", () => {
  //   const mockQuoterContract = {
  //     quoteExactInputSingle: {
  //       staticCall: jest.fn(),
  //     },
  //   };
  //   beforeEach(() => {
  //     ethers.Contract.mockReturnValue(mockQuoterContract);
  //   });

  //   it("devrait retourner le montant de sortie estimé", async () => {
  //     const amountIn = BigInt("1000000000000000000"); // 1 WBNB
  //     const expectedAmountOut = BigInt("500000000"); // 500 USDT
  //     mockQuoterContract.quoteExactInputSingle.staticCall.mockResolvedValue([expectedAmountOut]);

  //     const result = await getAmountOutV3(WBNB_TOKEN, USDT_TOKEN, 500, amountIn, mockProvider, "quoterAddr");
      
  //     expect(result).toBe(expectedAmountOut);
  //     expect(mockQuoterContract.quoteExactInputSingle.staticCall).toHaveBeenCalledWith({
  //       tokenIn: WBNB_TOKEN.address,
  //       tokenOut: USDT_TOKEN.address,
  //       fee: 500,
  //       amountIn: amountIn,
  //       sqrtPriceLimitX96: 0,
  //     });
  //   });

  //   it("devrait retourner null si amountIn est invalide", async () => {
  //       expect(await getAmountOutV3(WBNB_TOKEN, USDT_TOKEN, 500, 0n, mockProvider, "quoterAddr")).toBeNull();
  //       expect(await getAmountOutV3(WBNB_TOKEN, USDT_TOKEN, 500, 123, mockProvider, "quoterAddr")).toBeNull(); // Pas un BigInt
  //   });
  // });

  describe("calculatePriceV3", () => {
    it("devrait calculer le prix correctement quand token0 est WBNB (Legacy/Explicit)", () => {
        const mockPool = {
            token0: WBNB_TOKEN,
            token1: USDT_TOKEN,
            token0Price: { // Ce mock simule le comportement de Price.toSignificant()
                toSignificant: () => "550.123"
            },
        };
        // Test Explicit
        const priceExplicit = calculatePriceV3(mockPool, WBNB_TOKEN);
        expect(priceExplicit).toBeCloseTo(550.123);

        // Test Legacy (sans baseToken)
        const priceLegacy = calculatePriceV3(mockPool);
        expect(priceLegacy).toBeCloseTo(550.123);
    });

    it("devrait calculer le prix pour une paire générique avec baseToken explicite", () => {
        // Use valid random addresses
        const TOKEN_A = new Token(56, "0x0000000000000000000000000000000000000001", 18, "TKA");
        const TOKEN_B = new Token(56, "0x0000000000000000000000000000000000000002", 18, "TKB");
        
        const mockPool = {
            token0: TOKEN_A,
            token1: TOKEN_B,
            token0Price: {
                toSignificant: () => "10.5"
            },
            token1Price: {
                toSignificant: () => "0.095"
            }
        };

        // Si on veut le prix de A en B (combien de B pour 1 A), c'est token0Price (si token0 est A)
        const priceA = calculatePriceV3(mockPool, TOKEN_A);
        expect(priceA).toBeCloseTo(10.5); // 1 TKA = 10.5 TKB

        // Si on veut le prix de B en A
        const priceB = calculatePriceV3(mockPool, TOKEN_B);
        expect(priceB).toBeCloseTo(0.095); // 1 TKB = 0.095 TKA
    });

    it("devrait retourner 0 si le baseToken ne correspond pas", () => {
        const SOME_OTHER_TOKEN = new Token(56, "0x0000000000000000000000000000000000000003", 18, "OTHER");
        const mockPool = {
            token0: WBNB_TOKEN,
            token1: USDT_TOKEN,
        };
        const price = calculatePriceV3(mockPool, SOME_OTHER_TOKEN);
        expect(price).toBe(0);
    });
  });
});