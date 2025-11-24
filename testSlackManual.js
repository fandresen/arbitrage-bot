const { sendSlackNotification } = require('./utils/slackNotifier');

async function test() {
    console.log("Testing Info Notification...");
    await sendSlackNotification("Ceci est un test d'information.", "info");

    console.log("Testing Success Notification...");
    await sendSlackNotification("Ceci est un test de succès.", "success");

    console.log("Testing Error Notification...");
    await sendSlackNotification("Ceci est un test d'erreur.", "error");
    
    console.log("Testing Warning Notification...");
    await sendSlackNotification("Ceci est un test d'avertissement.", "warning");
}

test();
