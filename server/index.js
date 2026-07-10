'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const RoomManager = require('./rooms/RoomManager');
const Matchmaker = require('./matchmaking/Matchmaker');
const registerSocketHandlers = require('./socket/registerSocketHandlers');
const healthRouter = require('./routes/health');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

const roomManager = new RoomManager(io);
const matchmaker = new Matchmaker(roomManager);

app.use(express.json());
app.use('/api', healthRouter(roomManager, matchmaker));
app.use(express.static(path.resolve(__dirname, '..')));

registerSocketHandlers(io, { matchmaker, roomManager });

server.listen(PORT, () => {
  console.log(`Labyrinth Run server listening on http://localhost:${PORT}`);
});
