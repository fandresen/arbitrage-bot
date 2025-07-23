// __tests__/notifications.test.js

const { sendEmailNotification } = require("../utils/notifications");
const nodemailer = require("nodemailer");
const config = require("../config");

// Mocker nodemailer pour ne pas envoyer de vrais emails
jest.mock("nodemailer");
// Mocker le module config pour contrôler les variables
jest.mock("../config", () => ({
  EMAIL_CONFIG: {
    AUTH: {
      USER: "test@example.com",
      PASS: "password",
    },
    TO_EMAIL: "receiver@example.com",
  },
}));

describe("notifications.js", () => {
  const mockSendMail = jest.fn();

  beforeEach(() => {
    nodemailer.createTransport.mockReturnValue({
      sendMail: mockSendMail,
    });
    jest.clearAllMocks();
  });

  it("devrait appeler sendMail avec les bonnes options", async () => {
    mockSendMail.mockResolvedValue(true);
    await sendEmailNotification("Sujet du test", "Corps du message");

    expect(mockSendMail).toHaveBeenCalledWith({
      from: "test@example.com",
      to: "receiver@example.com",
      subject: "Sujet du test",
      text: "Corps du message",
    });
  });

  it("ne devrait pas envoyer d'email si la configuration est incomplète", async () => {
    // Simuler une configuration manquante
    config.EMAIL_CONFIG.TO_EMAIL = null;

    await sendEmailNotification("Sujet", "Message");
    expect(mockSendMail).not.toHaveBeenCalled();

    // Rétablir la configuration pour d'autres tests
    config.EMAIL_CONFIG.TO_EMAIL = "receiver@example.com";
  });

  it("devrait logger une erreur si sendMail échoue", async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSendMail.mockRejectedValue(new Error("Erreur SMTP"));

    await sendEmailNotification("Sujet", "Message");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "❌ Erreur lors de l'envoi de l'email de notification:",
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});