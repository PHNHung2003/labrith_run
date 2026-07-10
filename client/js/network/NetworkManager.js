(function () {
  const { CLIENT_EVENTS, SERVER_EVENTS } = window.LabyrinthOnline;

  class NetworkManager {
    constructor({ onStatus, onMatchFound, onCountdown, onMatchStart, onMatchEnd, onOpponentItem, onDisconnectState, onError } = {}) {
      this.socketManager = new window.LabyrinthOnline.SocketManager();
      this.matchManager = new window.LabyrinthOnline.MatchManager();
      this.itemSync = new window.LabyrinthOnline.ItemSync(this);
      this.handlers = { onStatus, onMatchFound, onCountdown, onMatchStart, onMatchEnd, onOpponentItem, onDisconnectState, onError };
    }

    get playerId() {
      return this.socketManager.playerId;
    }

    get match() {
      return this.matchManager.match;
    }

    async joinQueue() {
      const socket = await this.socketManager.connect();
      this._bind(socket);
      this.emit(CLIENT_EVENTS.JOIN_QUEUE);
    }

    leaveQueue() {
      this.emit(CLIENT_EVENTS.LEAVE_QUEUE);
    }

    playerEscaped(stats) {
      if (!this.match) return false;
      return this.emit(CLIENT_EVENTS.PLAYER_ESCAPED, {
        matchId: this.match.matchId,
        roomId: this.match.roomId,
        stats,
        clientTime: Date.now(),
      });
    }

    emit(event, payload) {
      return this.socketManager.emit(event, payload);
    }

    officialElapsedSeconds() {
      return this.matchManager.officialElapsedSeconds();
    }

    _bind(socket) {
      if (this._bound) return;
      this._bound = true;

      socket.on('connect', () => this.handlers.onStatus?.('Connected'));
      socket.on('disconnect', () => this.handlers.onStatus?.('Disconnected'));

      socket.on(SERVER_EVENTS.QUEUE_JOINED, (payload) => {
        this.matchManager.setQueued();
        this.handlers.onStatus?.(`Searching... estimated ${(payload.estimatedWaitMs / 1000).toFixed(0)}s`);
      });

      socket.on(SERVER_EVENTS.MATCH_FOUND, (payload) => {
        this.matchManager.setFound(payload);
        this.handlers.onMatchFound?.(payload);
      });

      socket.on(SERVER_EVENTS.COUNTDOWN, (payload) => {
        this.matchManager.setCountdown(payload);
        this.handlers.onCountdown?.(payload.remaining);
      });

      socket.on(SERVER_EVENTS.MATCH_START, (payload) => {
        this.matchManager.setStarted(payload);
        this.handlers.onMatchStart?.(payload);
      });

      socket.on(SERVER_EVENTS.MATCH_END, (payload) => {
        this.matchManager.setEnded(payload);
        this.handlers.onMatchEnd?.(payload);
      });

      socket.on(SERVER_EVENTS.OPPONENT_USED_ITEM, (payload) => this.handlers.onOpponentItem?.(payload));
      socket.on(SERVER_EVENTS.OPPONENT_DISCONNECTED, (payload) => this.handlers.onDisconnectState?.('Opponent disconnected', payload));
      socket.on(SERVER_EVENTS.OPPONENT_RECONNECTED, () => this.handlers.onDisconnectState?.('Opponent reconnected'));
      socket.on(SERVER_EVENTS.ERROR, (payload) => this.handlers.onError?.(payload));
    }
  }

  window.LabyrinthOnline = window.LabyrinthOnline || {};
  window.LabyrinthOnline.NetworkManager = NetworkManager;
})();
