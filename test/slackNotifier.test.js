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

  it("should send a notification to Slack with correct payload", async () => {
    axios.post.mockResolvedValue({ status: 200 });

    await sendSlackNotification("Test Message", "info");

    expect(axios.post).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/TEST/WEBHOOK",
      { text: "ℹ️ Test Message" }
    );
  });

  it("should use correct icon for error", async () => {
    axios.post.mockResolvedValue({ status: 200 });

    await sendSlackNotification("Error Message", "error");

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      { text: "❌ Error Message" }
    );
  });

  it("should use correct icon for success", async () => {
    axios.post.mockResolvedValue({ status: 200 });

    await sendSlackNotification("Success Message", "success");

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      { text: "✅ Success Message" }
    );
  });

  it("should log error if axios fails", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    axios.post.mockRejectedValue(new Error("Network Error"));

    await sendSlackNotification("Test", "info");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "❌ Error sending Slack notification:",
      "Network Error"
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
      "⚠️ SLACK_WEBHOOK_URL not configured. Slack notification skipped."
    );

    config.SLACK_WEBHOOK_URL = originalUrl;
    consoleWarnSpy.mockRestore();
  });
});
