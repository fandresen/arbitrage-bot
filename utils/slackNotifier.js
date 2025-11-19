const axios = require("axios");
const config = require("../config");

/**
 * Sends a notification to Slack.
 * @param {string} message - The message to send.
 * @param {string} type - The type of message (info, error, success).
 */
async function sendSlackNotification(message, type = "info") {
  if (!config.SLACK_WEBHOOK_URL) {
    console.warn("⚠️ SLACK_WEBHOOK_URL not configured. Slack notification skipped.");
    return;
  }

  const icon = type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";
  const payload = {
    text: `${icon} ${message}`,
  };

  try {
    await axios.post(config.SLACK_WEBHOOK_URL, payload);
    console.log("💬 Slack notification sent.");
  } catch (error) {
    console.error("❌ Error sending Slack notification:", error.message);
  }
}

module.exports = {
  sendSlackNotification,
};
