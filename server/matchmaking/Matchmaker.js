'use strict';

class Matchmaker {
  constructor(roomManager) {
    this.roomManager = roomManager;
    this.queue = [];
  }

  join(player) {
    if (this.queue.some(p => p.socketId === player.socketId)) return { queued: true, room: null };
    const opponentIndex = this.queue.findIndex(p => p.socketId !== player.socketId);
    if (opponentIndex === -1) {
      this.queue.push(player);
      return { queued: true, room: null };
    }

    const [opponent] = this.queue.splice(opponentIndex, 1);
    const room = this.roomManager.createMatch(opponent, player);
    return { queued: false, room };
  }

  leave(socketId) {
    const before = this.queue.length;
    this.queue = this.queue.filter(player => player.socketId !== socketId);
    return before !== this.queue.length;
  }

  size() {
    return this.queue.length;
  }
}

module.exports = Matchmaker;
