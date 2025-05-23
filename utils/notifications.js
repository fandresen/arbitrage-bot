// utils/notifications.js
const nodemailer = require("nodemailer");
const config = require("../config"); // Pour importer EMAIL_CONFIG

const { AUTH, TO_EMAIL } = config.EMAIL_CONFIG;

const user = process.env.EMAIL_USER;
const pass = process.env.EMAIL_PASS;

// Configure le transporteur Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail", // Utilise le service Gmail
  auth: {
    user: user,
    pass: pass,
  },
});

/**
 * Envoie une notification par e-mail.
 * @param {string} subject - Le sujet de l'e-mail.
 * @param {string} text - Le corps du texte de l'e-mail.
 */
async function sendEmailNotification(subject, text) {
  if (!TO_EMAIL || !AUTH.USER || !AUTH.PASS) {
    console.warn(
      "❌ Configuration email incomplète. Notification email non envoyée."
    );
    console.warn(
      "Vérifiez EMAIL_USER, EMAIL_PASS, EMAIL_RECEIVER dans votre fichier .env et config.js."
    );
    return;
  }

  const mailOptions = {
    from: AUTH.USER,
    to: TO_EMAIL,
    subject: subject,
    text: text,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✉️ Notification email envoyée à ${TO_EMAIL} avec succès !`);
  } catch (error) {
    console.error(
      "❌ Erreur lors de l'envoi de l'email de notification:",
      error
    );
  }
}

module.exports = {
  sendEmailNotification,
};
