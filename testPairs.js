// testConnection.js
require("dotenv").config(); // Pour charger les variables d'environnement si tu les utilises

const { JsonRpcProvider } = require("ethers");

// Configure l'URL RPC. Assure-toi que cela correspond à comment tu la charges dans config.js/index.js
// Pour ce test, nous allons la charger directement à partir des variables d'environnement.
// Si tu as défini RPC_URL directement dans config.js, remplace process.env.RPC_URL par la valeur directe.
const RPC_URL = process.env.RPC_URL || "https://bnb-mainnet.g.alchemy.com/v2/V32WNKvP7Geb6Oh9Zl8Sq41Zd3ciglTe"; // Remplace par ta véritable URL si différente

async function testEthersProviderConnectivity() {
    console.log(`[DEBUG] Tentative de connexion à l'URL RPC: ${RPC_URL}`);
    const provider = new JsonRpcProvider(RPC_URL);

    try {
        const network = await provider.getNetwork();
        console.log(`[DEBUG] Connecté au réseau:`);
        console.log(`[DEBUG]   Nom: ${network.name}`);
        console.log(`[DEBUG]   Chain ID: ${network.chainId}`);

        const blockNumber = await provider.getBlockNumber();
        console.log(`[DEBUG] ethersProvider connecté avec succès. Numéro de bloc actuel: ${blockNumber}`);

        // Vérifie l'adresse d'un compte pour un test RPC plus avancé
        const balance = await provider.getBalance("0x000000000000000000000000000000000000dead"); // Un compte aléatoire connu avec une balance (adresse brûlée souvent utilisée)
        console.log(`[DEBUG] Balance de 0x...dead: ${balance.toString()} wei (test de getBalance réussi)`);

        console.log(`✅ Test de connexion réussi.`);
    } catch (error) {
        console.error(`❌ Erreur lors du test de connectivité de ethersProvider:`);
        console.error(`[DEBUG] Message d'erreur: ${error.message}`);
        if (error.code) console.error(`[DEBUG] Code d'erreur ethers: ${error.code}`);
        if (error.reason) console.error(`[DEBUG] Raison de l'erreur: ${error.reason}`);
        console.error(`[DEBUG] Stack trace de l'erreur:`);
        console.error(error.stack);
        console.error(`🔴 Test de connexion échoué.`);
    }
}

testEthersProviderConnectivity();