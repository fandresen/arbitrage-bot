// utils/timer.js
const { performance } = require('perf_hooks');

/**
 * Un simple chronomètre pour mesurer les durées d'exécution.
 * Utilise performance.now() pour une haute précision.
 */
class Timer {
  constructor() {
    this.startTime = null;
  }

  /**
   * Démarre le chronomètre.
   */
  start() {
    this.startTime = performance.now();
    // console.log("[TIMER] Chronomètre démarré."); // Optionnel: pour le débogage
  }

  /**
   * Arrête le chronomètre et retourne la durée écoulée en secondes.
   * @returns {number|null} La durée en secondes, ou null si le chrono n'a pas été démarré.
   */
  stop() {
    if (this.startTime === null) {
      console.warn("[TIMER] stop() appelé sans que le chronomètre n'ait été démarré.");
      return null;
    }
    const endTime = performance.now();
    const durationInSeconds = (endTime - this.startTime) / 1000;
    this.startTime = null; // Réinitialise pour la prochaine utilisation
    // console.log(`[TIMER] Chronomètre arrêté. Durée: ${durationInSeconds.toFixed(3)}s.`); // Optionnel
    return durationInSeconds;
  }
}

// Exporte une instance unique (singleton) pour toute l'application
module.exports = new Timer();