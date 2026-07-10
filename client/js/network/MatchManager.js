(function () {
  class MatchManager {
    constructor() {
      this.match = null;
      this.status = 'offline';
      this.serverStartTime = null;
      this.lastCountdown = null;
      this.result = null;
    }

    setQueued() {
      this.status = 'queued';
    }

    setFound(payload) {
      this.match = payload;
      this.status = 'found';
      this.result = null;
    }

    setCountdown(payload) {
      this.status = 'countdown';
      this.lastCountdown = payload.remaining;
    }

    setStarted(payload) {
      this.status = 'active';
      this.serverStartTime = payload.serverStartTime;
      if (this.match) this.match.serverStartTime = payload.serverStartTime;
    }

    setEnded(payload) {
      this.status = 'ended';
      this.result = payload;
    }

    officialElapsedSeconds() {
      if (!this.serverStartTime) return 0;
      return Math.max(0, (Date.now() - this.serverStartTime) / 1000);
    }

    isWinner(playerId) {
      return this.result && this.result.winnerPlayerId === playerId;
    }
  }

  window.LabyrinthOnline = window.LabyrinthOnline || {};
  window.LabyrinthOnline.MatchManager = MatchManager;
})();
