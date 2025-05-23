const fs = require("fs");
const path = require("path");

// Chemin vers ton fichier CSV
const filePath = path.join(__dirname, "price_differences.csv");

// Lecture du fichier
fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
        console.error("Erreur de lecture du fichier :", err);
        return;
    }

    const lines = data.trim().split("\n");
    const headers = lines[0].split(",");

    // Indices des colonnes
    const diffSushiIndex = headers.indexOf("diff_sushi_over_quick");
    const diffQuickIndex = headers.indexOf("diff_quick_over_sushi");

    let maxSushiOverQuick = -Infinity;
    let maxQuickOverSushi = -Infinity;

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(",");

        const diffSushi = parseFloat(row[diffSushiIndex]);
        const diffQuick = parseFloat(row[diffQuickIndex]);

        if (!isNaN(diffSushi)) maxSushiOverQuick = Math.max(maxSushiOverQuick, diffSushi);
        if (!isNaN(diffQuick)) maxQuickOverSushi = Math.max(maxQuickOverSushi, diffQuick);
    }

    console.log("💡 Max diff_sushi_over_quick:", maxSushiOverQuick.toFixed(4));
    console.log("💡 Max diff_quick_over_sushi:", maxQuickOverSushi.toFixed(4));
});

