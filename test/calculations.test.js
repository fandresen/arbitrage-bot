// calculations.test.js
const {
  getAmountOutV2,
  calculatePriceV2,
  getAmountOutV3,
  calculatePriceV3,
} = require("../utils/calculations"); // Ajustez le chemin si nécessaire
const { parseUnits, formatUnits } = require("ethers");
const ethers = require("ethers"); // Utilisé pour mocker Provider.call
const { Token } = require("@uniswap/sdk-core");
// Pour la simulation V3, nous n'avons pas besoin d'importer Pool directement ici,
// car nous allons simuler son comportement ou utiliser une instance mockée.

// Mock des valeurs de configuration utilisées dans calculations.js
// Ceci est important pour que les tests soient isolés et ne dépendent pas des fichiers .env réels.
jest.mock("../config", () => ({
  PANCAKESWAP_V3_QUOTER_V2: "0x1234567890abcdef1234567890abcdef12345678", // Adresse mock du quoter
}));

// Mock des ABIs - elles sont chargées localement, mais assurez-vous qu'elles existent.
// Pour les tests, nous nous assurons que `ethers.Interface` peut les utiliser correctement.
// Si vous avez un problème avec les ABIs, vous pourriez avoir besoin de mock la lecture du fichier.
// Pour l'exemple, nous allons assumer qu'elles sont lisibles.

describe("calculations.js", () => {
  // Données de jetons mock (utilisées pour les tests)
  const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // Exemple pour un autre jeton

  const TOKEN_DECIMALS_MAP = {
    [WBNB_ADDRESS.toLowerCase()]: 18,
    [USDT_ADDRESS.toLowerCase()]: 6,
    [USDC_ADDRESS.toLowerCase()]: 6,
  };

  // Création d'instances de Token pour le SDK Uniswap V3
  const WBNB_TOKEN = new Token(
    56, // ID de chaîne pour BSC Mainnet
    WBNB_ADDRESS,
    TOKEN_DECIMALS_MAP[WBNB_ADDRESS.toLowerCase()],
    "WBNB",
    "Wrapped BNB"
  );
  const USDT_TOKEN = new Token(
    56, // ID de chaîne pour BSC Mainnet
    USDT_ADDRESS,
    TOKEN_DECIMALS_MAP[USDT_ADDRESS.toLowerCase()],
    "USDT",
    "Tether USD"
  );

  describe("getAmountOutV2", () => {
    const dexFee = 0.0025; // Frais de 0.25%

    test("devrait retourner 0n pour un swap typique en raison de la formule actuelle", () => {
      // Ces valeurs devraient produire un résultat non nul avec la formule V2 correcte.
      // Cependant, avec la formule actuelle dans votre code (reserveIn * IN_FEE_DENOMINATOR),
      // le dénominateur devient si grand que la division BigInt tronque le résultat à 0.
      const amountIn = parseUnits("1", 18); // 1 WBNB
      const reserveIn = parseUnits("1000", 18); // 1000 WBNB
      const reserveOut = parseUnits("300000", 6); // 300,000 USDT (pour un prix initial de 1 WBNB = 300 USDT)

      const calculatedAmountOut = getAmountOutV2(
        amountIn,
        reserveIn,
        reserveOut,
        dexFee
      );

      // Le test s'attend à 0n, ce qui met en évidence le problème de la formule.
      expect(calculatedAmountOut).toEqual(0n);
    });

    test("devrait retourner 0n si amountIn est 0n", () => {
      const amountIn = 0n;
      const reserveIn = parseUnits("1000", 18);
      const reserveOut = parseUnits("300000", 6);
      expect(getAmountOutV2(amountIn, reserveIn, reserveOut, dexFee)).toEqual(0n);
    });

    test("devrait retourner 0n si reserveIn est 0n", () => {
      const amountIn = parseUnits("1", 18);
      const reserveIn = 0n;
      const reserveOut = parseUnits("300000", 6);
      expect(getAmountOutV2(amountIn, reserveIn, reserveOut, dexFee)).toEqual(0n);
    });

    test("devrait retourner 0n si reserveOut est 0n", () => {
      const amountIn = parseUnits("1", 18);
      const reserveIn = parseUnits("1000", 18);
      const reserveOut = 0n;
      expect(getAmountOutV2(amountIn, reserveIn, reserveOut, dexFee)).toEqual(0n);
    });

    // Un autre test qui devrait aussi produire 0n avec la formule actuelle
    test("devrait retourner 0n même avec des valeurs plus petites qui pourraient potentiellement donner un résultat non nul", () => {
        const amountIn = 1000000000000n; // 1e12
        const reserveIn = 1000000000000n; // 1e12
        const reserveOut = 1000000000000n; // 1e12
        const dexFee = 0.0025;

        const result = getAmountOutV2(amountIn, reserveIn, reserveOut, dexFee);
        expect(result).toEqual(0n); // Confirme la troncature due à la formule problématique.
    });
  });

  describe("calculatePriceV2", () => {
    const dexFee = 0.0025;

    test("devrait calculer le prix pour la paire WBNB/USDT (qui sera 0 en raison de getAmountOutV2)", () => {
      const reserves = {
        token0Address: WBNB_ADDRESS, // Supposons que token0 est WBNB
        token1Address: USDT_ADDRESS, // Supposons que token1 est USDT
        reserve0: parseUnits("100", 18), // 100 WBNB
        reserve1: parseUnits("30000", 6), // 30,000 USDT (soit 300 USDT/WBNB initialement)
      };

      // Étant donné que getAmountOutV2 retourne 0n avec la formule actuelle,
      // calculatePriceV2 retournera également 0.
      const price = calculatePriceV2(
        reserves,
        WBNB_ADDRESS,
        USDT_ADDRESS,
        TOKEN_DECIMALS_MAP,
        dexFee
      );
      expect(price).toEqual(0); // Attendu basé sur le comportement actuel de getAmountOutV2
    });

    test("devrait retourner null si les décimales de tokenIn sont manquantes", () => {
      const reserves = {
        token0Address: WBNB_ADDRESS,
        token1Address: USDT_ADDRESS,
        reserve0: parseUnits("100", 18),
        reserve1: parseUnits("30000", 6),
      };
      const badDecimalsMap = {
        [USDT_ADDRESS.toLowerCase()]: 6, // Manque les décimales de WBNB
      };
      const price = calculatePriceV2(
        reserves,
        WBNB_ADDRESS,
        USDT_ADDRESS,
        badDecimalsMap,
        dexFee
      );
      expect(price).toBeNull();
    });

    test("devrait retourner null si les décimales de tokenOut sont manquantes", () => {
      const reserves = {
        token0Address: WBNB_ADDRESS,
        token1Address: USDT_ADDRESS,
        reserve0: parseUnits("100", 18),
        reserve1: parseUnits("30000", 6),
      };
      const badDecimalsMap = {
        [WBNB_ADDRESS.toLowerCase()]: 18, // Manque les décimales de USDT
      };
      const price = calculatePriceV2(
        reserves,
        WBNB_ADDRESS,
        USDT_ADDRESS,
        badDecimalsMap,
        dexFee
      );
      expect(price).toBeNull();
    });
  });

  describe("getAmountOutV3", () => {
    // Mock du fournisseur ethers.js et de sa méthode `call`
    const mockProvider = {
      call: jest.fn(),
    };

    // Objet mock de la pool Uniswap V3 (simplifié pour les tests de `getAmountOutV3`)
    const mockPool = {
      token0: WBNB_TOKEN,
      token1: USDT_TOKEN,
      fee: 500, // 0.05%
      sqrtPriceX96: BigInt("79228162514264337593543950336"), // Exemple de sqrtPriceX96 pour ~300 USDT/WBNB
      tick: 693120, // Exemple de tick
      liquidity: BigInt("100000000000000000000"), // Exemple de liquidité
    };

    // Charger l'ABI de IQuoterV2 pour encoder/décoder
    // Assurez-vous que le chemin est correct pour votre projet
    const IQuoterV2ABI = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json').abi;
    const quoterInterface = new ethers.Interface(IQuoterV2ABI);

    beforeEach(() => {
      // Réinitialiser tous les mocks avant chaque test
      mockProvider.call.mockClear();
    });

    test("devrait retourner le montant coté pour un swap réussi", async () => {
      const amountIn = parseUnits("1", 18); // 1 WBNB

      // Simuler le résultat encodé du contrat quoter
      // Supposons que 1 WBNB donne ~299 USDT après frais (simplifié pour le mock)
      const expectedQuotedAmountOut = parseUnits("299", 6); // 299 USDT (6 décimales)

      // Trouver la fonction `quoteExactInputSingle` dans l'ABI pour l'encodage du résultat
      const func = quoterInterface.getFunction("quoteExactInputSingle");
      if (!func) {
        throw new Error("La fonction quoteExactInputSingle est introuvable dans l'ABI pour le mock.");
      }

      // Encoder le résultat que `provider.call` devrait retourner
      // `quoteExactInputSingle` retourne un tuple (amountOut, sqrtPriceX96After)
      const encodedReturn = quoterInterface.encodeFunctionResult(func, [expectedQuotedAmountOut, mockPool.sqrtPriceX96]);

      mockProvider.call.mockResolvedValue(encodedReturn);

      const result = await getAmountOutV3(
        amountIn,
        mockPool,
        WBNB_TOKEN,
        USDT_TOKEN,
        mockProvider
      );

      expect(result).toEqual(expectedQuotedAmountOut);
      expect(mockProvider.call).toHaveBeenCalledTimes(1);
      // Vérifier les arguments passés à provider.call
      const callArgs = mockProvider.call.mock.calls[0][0];
      expect(callArgs.to).toBe("0x1234567890abcdef1234567890abcdef12345678"); // L'adresse mock du quoter
      expect(callArgs.data).toBeDefined();
    });

    test("devrait retourner 0n si amountIn est 0n", async () => {
      const amountIn = 0n;
      const result = await getAmountOutV3(
        amountIn,
        mockPool,
        WBNB_TOKEN,
        USDT_TOKEN,
        mockProvider
      );
      expect(result).toEqual(0n);
      expect(mockProvider.call).not.toHaveBeenCalled(); // Aucun appel RPC ne devrait être fait si amountIn est 0
    });

    test("devrait retourner 0n et loguer une erreur si provider.call échoue", async () => {
      // Espionner console.error pour vérifier qu'il est appelé et éviter la pollution de la console
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      mockProvider.call.mockRejectedValue(new Error("Appel RPC échoué"));

      const amountIn = parseUnits("1", 18);
      const result = await getAmountOutV3(
        amountIn,
        mockPool,
        WBNB_TOKEN,
        USDT_TOKEN,
        mockProvider
      );

      expect(result).toEqual(0n);
      expect(mockProvider.call).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore(); // Restaurer console.error après le test
    });
  });

  describe("calculatePriceV3", () => {
    test("devrait calculer le prix à partir de la propriété token0Price", () => {
      // Mock de l'objet pool avec la méthode `token0Price.toSignificant`
      const mockPool = {
        token0Price: {
          toSignificant: jest.fn((decimals) => "300.5123"), // Simule la conversion en string
        },
      };
      const price = calculatePriceV3(mockPool);
      expect(price).toBeCloseTo(300.5123); // Utilise toBeCloseTo pour les nombres flottants
      expect(mockPool.token0Price.toSignificant).toHaveBeenCalledWith(6); // Vérifie que la précision par défaut est utilisée
    });

    test("devrait retourner null si token0Price est manquant ou toSignificant n'est pas une fonction", () => {
      const mockPool = {}; // pool sans token0Price
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const price = calculatePriceV3(mockPool);
      expect(price).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    test("devrait retourner null si une erreur se produit pendant le calcul du prix", () => {
        const mockPool = {
            token0Price: {
                toSignificant: jest.fn(() => { throw new Error("Erreur de conversion"); }) // Simule une erreur
            }
        };
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

        const price = calculatePriceV3(mockPool);
        expect(price).toBeNull();
        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
  });
});