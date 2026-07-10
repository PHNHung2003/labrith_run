(function () {
  class SocketManager {
    constructor({ url = window.location.origin, playerId = null } = {}) {
      this.url = url;
      this.playerId = playerId || this._loadOrCreatePlayerId();
      this.socket = null;
    }

    async connect() {
      await this._ensureSocketIoClient();
      if (this.socket && this.socket.connected) return this.socket;
      this.socket = window.io(this.url, {
        auth: { playerId: this.playerId },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        timeout: 8000,
      });
      if (this.socket.connected) return this.socket;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timed out connecting to multiplayer server.'));
        }, 9000);
        const cleanup = () => {
          clearTimeout(timeout);
          this.socket.off('connect', onConnect);
          this.socket.off('connect_error', onError);
        };
        const onConnect = () => {
          cleanup();
          resolve(this.socket);
        };
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        this.socket.on('connect', onConnect);
        this.socket.on('connect_error', onError);
      });
    }

    on(event, handler) {
      if (!this.socket) return;
      this.socket.on(event, handler);
    }

    emit(event, payload) {
      if (!this.socket || !this.socket.connected) return false;
      this.socket.emit(event, payload);
      return true;
    }

    disconnect() {
      if (this.socket) this.socket.disconnect();
    }

    _loadOrCreatePlayerId() {
      // Each browser tab is a separate player for local 1v1 testing.
      // sessionStorage survives refresh in the same tab, but does not make two
      // tabs share the same identity like localStorage does.
      const key = 'labyrinth_run_tab_player_id';
      const existing = window.sessionStorage.getItem(key);
      if (existing) return existing;
      const id = `player_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
      window.sessionStorage.setItem(key, id);
      return id;
    }

    _ensureSocketIoClient() {
      if (window.io) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-socket-io-client]');
        if (existing) {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = '/socket.io/socket.io.js';
        script.async = true;
        script.dataset.socketIoClient = 'true';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Socket.IO client failed to load. Start the Node server and open the game through it.'));
        document.head.appendChild(script);
      });
    }
  }

  window.LabyrinthOnline = window.LabyrinthOnline || {};
  window.LabyrinthOnline.SocketManager = SocketManager;
})();
