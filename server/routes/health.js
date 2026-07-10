'use strict';

const express = require('express');

function healthRouter(roomManager, matchmaker) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      rooms: roomManager.rooms.size,
      queuedPlayers: matchmaker.size(),
      serverTime: Date.now(),
    });
  });

  return router;
}

module.exports = healthRouter;
