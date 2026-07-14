'use strict';

const crypto = require('crypto');
const { MATCH_STATUS, MATCH_END_REASON } = require('../../shared/events');

const RECONNECT_GRACE_MS = 30_000;
const MAZE_THEME_IDS = Object.freeze(['alien', 'cyberpunk', 'forest']);

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.playerToRoom = new Map();
  }

  createMatch(playerA, playerB) {
    const roomId = `room_${crypto.randomUUID()}`;
    const matchId = `match_${crypto.randomUUID()}`;
    const seed = crypto.randomInt(1, 2 ** 31 - 1);
    const difficulty = this._pickDifficulty();
    const mazeSize = this._mazeSizeForDifficulty(difficulty);
    const themeId = MAZE_THEME_IDS[crypto.randomInt(0, MAZE_THEME_IDS.length)];
    const now = Date.now();

    const room = {
      roomId,
      matchId,
      players: [this._roomPlayer(playerA), this._roomPlayer(playerB)],
      seed,
      difficulty,
      mazeSize,
      themeId,
      status: MATCH_STATUS.CREATED,
      winnerSocketId: null,
      winnerPlayerId: null,
      startTime: null,
      createdAt: now,
      countdownTimer: null,
      disconnectTimers: new Map(),
    };

    this.rooms.set(roomId, room);
    this.playerToRoom.set(playerA.socketId, roomId);
    this.playerToRoom.set(playerB.socketId, roomId);
    return room;
  }

  startCountdown(room, emitCountdown) {
    if (!room || room.status !== MATCH_STATUS.CREATED) return;
    room.status = MATCH_STATUS.COUNTDOWN;
    let remaining = 3;
    emitCountdown(remaining);
    room.countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        emitCountdown(remaining);
        return;
      }
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      room.status = MATCH_STATUS.ACTIVE;
      room.startTime = Date.now();
      this.io.to(room.roomId).emit('MATCH_START', {
        roomId: room.roomId,
        matchId: room.matchId,
        serverStartTime: room.startTime,
      });
    }, 1000);
  }

  getRoomBySocket(socketId) {
    const roomId = this.playerToRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  getOpponent(room, socketId) {
    return room.players.find(player => player.socketId !== socketId) || null;
  }

  validateEscape(socket, payload = {}) {
    const room = this.getRoomBySocket(socket.id);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.status !== MATCH_STATUS.ACTIVE) return { ok: false, error: 'MATCH_NOT_ACTIVE' };
    if (room.winnerSocketId) return { ok: false, error: 'MATCH_ALREADY_WON' };
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return { ok: false, error: 'PLAYER_NOT_IN_ROOM' };
    if (payload.matchId && payload.matchId !== room.matchId) return { ok: false, error: 'MATCH_ID_MISMATCH' };

    const elapsedMs = Date.now() - room.startTime;
    if (elapsedMs < this._minimumPlausibleEscapeMs(room)) {
      return { ok: false, error: 'ESCAPE_TOO_FAST' };
    }

    return { ok: true, room, player, elapsedMs };
  }

  endMatch(room, winnerSocketId, reason = MATCH_END_REASON.ESCAPED) {
    if (!room || room.status === MATCH_STATUS.ENDED || room.winnerSocketId) return null;
    const winner = room.players.find(player => player.socketId === winnerSocketId);
    if (!winner) return null;

    room.status = MATCH_STATUS.ENDED;
    room.winnerSocketId = winner.socketId;
    room.winnerPlayerId = winner.playerId;
    const elapsedMs = room.startTime ? Date.now() - room.startTime : 0;

    const result = {
      roomId: room.roomId,
      matchId: room.matchId,
      winnerPlayerId: room.winnerPlayerId,
      winnerSocketId: room.winnerSocketId,
      elapsedMs,
      reason,
    };

    this.io.to(room.roomId).emit('MATCH_END', result);
    this._cleanupRoomLater(room.roomId);
    return result;
  }

  handleDisconnect(socket) {
    const room = this.getRoomBySocket(socket.id);
    if (!room || room.status === MATCH_STATUS.ENDED) return;
    const player = room.players.find(p => p.socketId === socket.id);
    const opponent = this.getOpponent(room, socket.id);
    if (!player) return;

    player.connected = false;
    player.disconnectedAt = Date.now();
    if (opponent) this.io.to(opponent.socketId).emit('OPPONENT_DISCONNECTED', { graceMs: RECONNECT_GRACE_MS });

    const timer = setTimeout(() => {
      const latestRoom = this.rooms.get(room.roomId);
      if (!latestRoom || latestRoom.status === MATCH_STATUS.ENDED) return;
      const latestPlayer = latestRoom.players.find(p => p.playerId === player.playerId);
      if (latestPlayer && !latestPlayer.connected && opponent) {
        this.endMatch(latestRoom, opponent.socketId, MATCH_END_REASON.DISCONNECT_TIMEOUT);
      }
    }, RECONNECT_GRACE_MS);
    room.disconnectTimers.set(player.playerId, timer);
  }

  reconnect(socket, playerId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find(p => p.playerId === playerId);
      if (!player || room.status === MATCH_STATUS.ENDED) continue;
      this.playerToRoom.delete(player.socketId);
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      this.playerToRoom.set(socket.id, room.roomId);
      socket.join(room.roomId);
      const timer = room.disconnectTimers.get(player.playerId);
      if (timer) clearTimeout(timer);
      room.disconnectTimers.delete(player.playerId);
      const opponent = this.getOpponent(room, socket.id);
      if (opponent) this.io.to(opponent.socketId).emit('OPPONENT_RECONNECTED');
      return room;
    }
    return null;
  }

  forwardItem(socket, itemPayload) {
    const room = this.getRoomBySocket(socket.id);
    if (!room || room.status !== MATCH_STATUS.ACTIVE) return false;
    const opponent = this.getOpponent(room, socket.id);
    if (!opponent || !opponent.connected) return false;
    this.io.to(opponent.socketId).emit('OPPONENT_USED_ITEM', {
      matchId: room.matchId,
      fromPlayerId: this._playerId(room, socket.id),
      item: itemPayload,
      serverTime: Date.now(),
    });
    return true;
  }

  _roomPlayer(player) {
    return {
      socketId: player.socketId,
      playerId: player.playerId,
      connected: true,
      disconnectedAt: null,
      ready: false,
    };
  }

  _playerId(room, socketId) {
    const player = room.players.find(p => p.socketId === socketId);
    return player ? player.playerId : null;
  }

  _pickDifficulty() {
    const roll = Math.random();
    if (roll < 0.7) return 'standard';
    if (roll < 0.93) return 'hard';
    return 'expert';
  }

  _mazeSizeForDifficulty(difficulty) {
    if (difficulty === 'expert') return { width: 35, height: 35 };
    if (difficulty === 'hard') return { width: 30, height: 30 };
    return { width: 25, height: 25 };
  }

  _minimumPlausibleEscapeMs(room) {
    const cells = room.mazeSize.width * room.mazeSize.height;
    return Math.min(8000, Math.max(2500, cells * 2));
  }

  _cleanupRoomLater(roomId) {
    setTimeout(() => {
      const room = this.rooms.get(roomId);
      if (!room) return;
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
      for (const player of room.players) this.playerToRoom.delete(player.socketId);
      this.rooms.delete(roomId);
    }, 10_000);
  }
}

module.exports = RoomManager;
