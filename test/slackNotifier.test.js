const axios = require("axios");
const { sendSlackNotification } = require("../utils/slackNotifier");
const config = require("../config");

jest.mock("axios");
jest.mock("../config", () => ({
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/TEST/WEBHOOK",
}));

describe("slackNotifier.js", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should send a notification to Slack with correct payload (info)", async () => {
    axios.post.mockResolvedValue({ status: 200 });

    await sendSlackNotification("Test Message", "info");

    expect(axios.post).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/TEST/WEBHOOK",
      expect.objectContaining({
        blocks: expect.arrayContaining([
            expect.objectContaining({
                type: "header",
                text: expect.objectContaining({ text: "ℹ️ Notification Bot Arbitrage" })
            }),
            expect.objectContaining({
                type: "section",
                text: expect.objectContaining({ text: "*Message :*\nTest Message" })
            })
        ])
      })
    );
  });

  it("should use correct icon for error", async () => {
    axios.post.mockResolvedValue({ status: 200 });

    await sendSlackNotification("Error Message", "error");

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        blocks: expect.arrayContaining([
            expect.objectContaining({
                type: "header",
                text: expect.objectContaining({ text: "🚨 Erreur Critique" })
            })
        ])
      })
    );
  });

  it("should use correct icon for success", async () => {
    axios.post.mockResolvedValue({ status: 200 });

    await sendSlackNotification("Success Message", "success");

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        blocks: expect.arrayContaining([
            expect.objectContaining({
                type: "header",
                text: expect.objectContaining({ text: "💰 Succès Arbitrage" })
            })
        ])
      })
    );
  });

  it("should log error if axios fails", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    axios.post.mockRejectedValue(new Error("Network Error"));

    await sendSlackNotification("Test", "info");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("❌ Échec de l'envoi de l'alerte à Slack")
    );
    consoleErrorSpy.mockRestore();
  });

  it("should skip notification if webhook url is missing", async () => {
    const originalUrl = config.SLACK_WEBHOOK_URL;
    config.SLACK_WEBHOOK_URL = null;
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await sendSlackNotification("Test", "info");

    expect(axios.post).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "⚠️ SLACK_WEBHOOK_URL n'est pas configuré. Alerte non envoyée."
    );

    config.SLACK_WEBHOOK_URL = originalUrl;
    consoleWarnSpy.mockRestore();
  });
});
