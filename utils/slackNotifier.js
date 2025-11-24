// utils/slackNotifier.js
const axios = require('axios');
const config = require("../config");

/**
 * Envoie une notification d'alerte formatée à un canal Slack en utilisant les blocs de message.
 * @param {string} message Le message principal de l'alerte.
 * @param {string} type Le type de notification ('info', 'success', 'error').
 */
async function sendSlackNotification(message, type = "info") {
    const SLACK_WEBHOOK_URL = config.SLACK_WEBHOOK_URL;
    if (!SLACK_WEBHOOK_URL) {
        console.warn("⚠️ SLACK_WEBHOOK_URL n'est pas configuré. Alerte non envoyée.");
        return;
    }

    let emoji = "ℹ️";
    let title = "Notification Bot Arbitrage";

    if (type === "success") {
        emoji = "💰";
        title = "Succès Arbitrage";
    } else if (type === "error") {
        emoji = "🚨";
        title = "Erreur Critique";
    } else if (type === "warning") {
        emoji = "⚠️";
        title = "Attention";
    }

    try {
        const blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": `${emoji} ${title}`,
                    "emoji": true
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `*Message :*\n${message}`
                }
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": `*Timestamp:* ${new Date().toISOString()}`
                    }
                ]
            }
        ];

        const payload = { blocks };

        const response = await axios.post(SLACK_WEBHOOK_URL, payload);
        
        if (response.status !== 200) {
            throw new Error(`Le serveur Slack a renvoyé le statut ${response.status}.`);
        }
        
        // console.log("💬 Alerte Slack envoyée avec succès.");

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`❌ Échec de l'envoi de l'alerte à Slack (Axios) : ${error.message}`);
            if (error.response) {
                 console.error("Réponse de Slack:", error.response.data);
            }
        } else if (error instanceof Error) {
            console.error(`❌ Échec de l'envoi de l'alerte à Slack : ${error.message}`);
        } else {
            console.error("❌ Échec de l'envoi de l'alerte à Slack (erreur inconnue).", error);
        }
    }
}

module.exports = { sendSlackNotification };
