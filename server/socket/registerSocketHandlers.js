'use strict';

const crypto = require('crypto');
const {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  MATCH_END_REASON,
  SABOTAGE_ITEMS,
} = require('../../shared/events');

function registerSocketHandlers(io, { matchmaker, roomManager }) {
  io.on('connection', (socket) => {
    const playerId = socket.handshake.auth?.playerId || `guest_${crypto.randomUUID()}`;
    socket.data.playerId = playerId;

    const resumedRoom = roomManager.reconnect(socket, playerId);
    if (resumedRoom) {
      socket.emit(SERVER_EVENTS.MATCH_FOUND, matchPayloadFor(resumedRoom, socket.id));
    }

    socket.on(CLIENT_EVENTS.JOIN_QUEUE, () => {
      const result = matchmaker.join({ socketId: socket.id, playerId });
      if (!result.room) {
        socket.emit(SERVER_EVENTS.QUEUE_JOINED, {
          playerId,
          estimatedWaitMs: estimateWait(matchmaker.size()),
        });
        return;
      }

      const room = result.room;
      for (const player of room.players) {
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (!playerSocket) continue;
        playerSocket.join(room.roomId);
        playerSocket.emit(SERVER_EVENTS.MATCH_FOUND, matchPayloadFor(room, player.socketId));
      }

      roomManager.startCountdown(room, (remaining) => {
        io.to(room.roomId).emit(SERVER_EVENTS.COUNTDOWN, { remaining });
      });
    });

    socket.on(CLIENT_EVENTS.LEAVE_QUEUE, () => {
      matchmaker.leave(socket.id);
    });

    socket.on(CLIENT_EVENTS.READY, () => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) return;
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) player.ready = true;
    });

    socket.on(CLIENT_EVENTS.PLAYER_ESCAPED, (payload = {}) => {
      const validation = roomManager.validateEscape(socket, payload);
      if (!validation.ok) {
        socket.emit(SERVER_EVENTS.ERROR, { code: validation.error });
        return;
      }
      roomManager.endMatch(validation.room, socket.id, MATCH_END_REASON.ESCAPED);
    });

    socket.on(CLIENT_EVENTS.ITEM_USED, (payload = {}) => {
      if (!isForwardedItem(payload.type)) return;
      roomManager.forwardItem(socket, payload);
    });

    socket.on(CLIENT_EVENTS.PING, (payload = {}) => {
      socket.emit(SERVER_EVENTS.PONG, { clientTime: payload.clientTime, serverTime: Date.now() });
    });

    socket.on('disconnect', () => {
      matchmaker.leave(socket.id);
      roomManager.handleDisconnect(socket);
    });
  });
}

function matchPayloadFor(room, socketId) {
  const player = room.players.find(p => p.socketId === socketId);
  const opponent = room.players.find(p => p.socketId !== socketId);
  return {
    roomId: room.roomId,
    matchId: room.matchId,
    playerId: player?.playerId || null,
    opponentPlayerId: opponent?.playerId || null,
    seed: room.seed,
    difficulty: room.difficulty,
    mazeSize: room.mazeSize,
    serverTime: Date.now(),
  };
}

function estimateWait(queueSize) {
  return queueSize > 0 ? 1000 : 5000;
}

function isForwardedItem(type) {
  return Object.values(SABOTAGE_ITEMS).includes(type);
}

module.exports = registerSocketHandlers;
