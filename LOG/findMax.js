const fs = require("fs");
const path = require("path");

// Chemin vers ton fichier CSV
const filePath = path.join(__dirname, "arbitrage_opportunities_v2_v3.csv");

// Lecture du fichier
fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
        console.error("Erreur de lecture du fichier :", err);
        return;
    }

    const lines = data.trim().split("\n");
    const headers = lines[0].split(",");

    // Indices des colonnes utiles
    const diffV3OverV2Index = headers.indexOf("diff_V3_over_V2");
    const diffV2OverV3Index = headers.indexOf("diff_V2_over_V3");

    let maxV3OverV2 = -Infinity;
    let maxV2OverV3 = -Infinity;

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(",");

        const diffV3OverV2 = parseFloat(row[diffV3OverV2Index]);
        const diffV2OverV3 = parseFloat(row[diffV2OverV3Index]);

        if (!isNaN(diffV3OverV2)) {
            maxV3OverV2 = Math.max(maxV3OverV2, diffV3OverV2);
        }

        if (!isNaN(diffV2OverV3)) {
            maxV2OverV3 = Math.max(maxV2OverV3, diffV2OverV3);
        }
    }

    console.log("💹 Max diff_V3_over_V2:", maxV3OverV2.toFixed(4));
    console.log("💹 Max diff_V2_over_V3:", maxV2OverV3.toFixed(4));
});
