// utils/v3contracts.js
const { Pool, TickMath, SqrtPriceMath, computePoolAddress } = require('@uniswap/v3-sdk');
const { Token } = require('@uniswap/sdk-core');
const { ethers } = require('ethers');
const JSBI = require('jsbi');
const IUniswapV3PoolABI = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json').abi;
const IUniswapV3FactoryABI = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json').abi;

/**
 * Récupère l'adresse d'une pool V3 à partir de la factory.
 * @param {string} factoryAddress - Adresse du contrat de la factory V3.
 * @param {object} tokenA - Instance du Token A (depuis @uniswap/sdk-core).
 * @param {object} tokenB - Instance du Token B (depuis @uniswap/sdk-core).
 * @param {number} feeTier - Le niveau de frais de la pool (ex: 500 pour 0.05%).
 * @param {object} provider - Instance d'ethers.js Provider.
 * @returns {Promise<string|null>} L'adresse de la pool ou null en cas d'erreur.
 */
async function getV3PoolAddress(factoryAddress, tokenA, tokenB, feeTier, provider) {
    try {
        console.log(`[DEBUG] Attempting to get V3 Pool Address for:`);
        console.log(`[DEBUG] Factory Address (param): ${factoryAddress}`);
        console.log(`[DEBUG] Token A Address: ${tokenA.address} (${tokenA.symbol})`);
        console.log(`[DEBUG] Token B Address: ${tokenB.address} (${tokenB.symbol})`);
        console.log(`[DEBUG] Fee Tier: ${feeTier}`);

        const factoryContract = new ethers.Contract(factoryAddress, IUniswapV3FactoryABI, provider);
        // Pour ethers v6, la propriété est 'target', pour v5 c'est 'address'
        console.log(`[DEBUG] factoryContract instantiated. Actual target: ${factoryContract.target || factoryContract.address}`);

        const poolAddress = await factoryContract.getPool(tokenA.address, tokenB.address, feeTier);
        
        console.log(`[DEBUG] Call to getPool returned: ${poolAddress}`);

        if (poolAddress === "0x0000000000000000000000000000000000000000") {
            console.warn(
                `⚠️ Pool V3 introuvable pour ${tokenA.symbol}/${tokenB.symbol} avec frais ${feeTier} sur la factory ${factoryAddress}`
            );
            return null;
        }
        return poolAddress;
    } catch (err) {
        console.error(`Erreur getV3PoolAddress (${factoryAddress}, ${tokenA.symbol}/${tokenB.symbol}, ${feeTier}):`, err.message);
        // Log plus de détails sur l'erreur si disponibles
        if (err.code) console.error(`[DEBUG] Error Code: ${err.code}`);
        if (err.data) console.error(`[DEBUG] Error Data (revert reason encoded): ${err.data}`);
        if (err.reason) console.error(`[DEBUG] Error Reason (decoded): ${err.reason}`);
        if (err.transaction) console.error(`[DEBUG] Error Transaction object: ${JSON.stringify(err.transaction, null, 2)}`);
        return null;
    }
}

/**
 * Récupère l'état d'une pool Uniswap V3 (slot0 et liquidité).
 * @param {string} poolAddress - Adresse du contrat de la pool V3.
 * @param {object} provider - Instance d'ethers.js Provider.
 * @returns {Promise<object|null>} Un objet contenant slot0 et liquidité, ou null.
 */
async function getV3PoolState(poolAddress, provider) {
    try {
        const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, provider);
        const [slot0, liquidity] = await Promise.all([
            poolContract.slot0(),
            poolContract.liquidity()
        ]);
        console.log("POOL V3 LIQUIDITY : ",liquidity)
        return {
            sqrtPriceX96: BigInt(slot0.sqrtPriceX96),
            tick: Number(slot0.tick),
            liquidity: BigInt(liquidity)
        };
    } catch (err) {
        console.error(`Erreur getV3PoolState pour ${poolAddress}:`, err.message);
        return null;
    }
}

/**
 * Construit une instance de Pool V3 pour les calculs SDK.
 * @param {object} tokenA - Instance du Token A (depuis @uniswap/sdk-core).
 * @param {object} tokenB - Instance du Token B (depuis @uniswap/sdk-core).
 * @param {number} feeTier - Le niveau de frais de la pool.
 * @param {BigInt} sqrtPriceX96 - Le prix actuel sqrtPriceX96 (sera un BigInt natif).
 * @param {number} tick - Le tick actuel.
 * @param {BigInt} liquidity - La liquidité actuelle de la pool (sera un BigInt natif).
 * @returns {Pool} Une instance de Pool V3.
 */
function createV3Pool(tokenA, tokenB, feeTier, sqrtPriceX96, tick, liquidity) {
    // Les tokens doivent être dans le bon ordre canonique pour le SDK
    const [token0, token1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];

    return new Pool(
        token0,
        token1,
        feeTier,
        JSBI.BigInt(sqrtPriceX96.toString()), // <-- CONVERTIS EN JSBI.BigInt
        JSBI.BigInt(liquidity.toString()),   // <-- CONVERTIS EN JSBI.BigInt
        tick
    );
}

module.exports = {
    getV3PoolAddress,
    getV3PoolState,
    createV3Pool,
};