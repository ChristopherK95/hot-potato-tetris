import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import type { ClientToServerEvents, ServerToClientEvents } from '@tetris/shared';
import roomManager from './RoomManager';
import GameRoom from './game/GameRoom';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

const app = express();
app.use(cors());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Serve the built React client in production
// __dirname = packages/server/src → ../../client/dist = packages/client/dist
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  console.log(`Serving client from ${clientDist}`);
}

const httpServer = createServer(app);

const io: IoServer = new Server(httpServer, {
  cors: { origin: '*' },
});

function wireRoom(room: GameRoom) {
  if ((room as any)._wired) return;
  (room as any)._wired = true;

  room.on('roomState', (roomCode, state) => {
    io.to(roomCode).emit('room:state', state);
  });

  room.on('gameState', (roomCode, state) => {
    io.to(roomCode).emit('game:state', state);
  });

  room.on('pieceUpdate', (roomCode, piece) => {
    io.to(roomCode).emit('game:pieceUpdate', piece);
  });

  room.on('timerTick', (roomCode, seconds) => {
    io.to(roomCode).emit('game:timerTick', seconds);
  });

  room.on('gameOver', (roomCode, state) => {
    io.to(roomCode).emit('game:over', state);
  });

  room.on('powerUpUsed', (roomCode, playerId, type, targetId) => {
    io.to(roomCode).emit('game:powerUpUsed', playerId, type, targetId);
  });
}

io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  socket.on('room:create', (playerName, cb) => {
    const room = roomManager.createRoom(socket.id, playerName);
    socket.join(room.roomCode);
    wireRoom(room);
    socket.emit('room:state', room.buildRoomState());
    cb(room.roomCode);
    console.log(`[room] ${playerName} created ${room.roomCode}`);
  });

  socket.on('room:join', (roomCode, playerName, cb) => {
    const room = roomManager.joinRoom(socket.id, roomCode, playerName);
    if (!room) {
      cb(false, 'Room not found or full');
      return;
    }
    socket.join(room.roomCode);
    wireRoom(room);
    socket.emit('room:state', room.buildRoomState());
    cb(true);
    console.log(`[room] ${playerName} joined ${room.roomCode}`);
  });

  socket.on('room:start', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    const ok = room.startGame(socket.id);
    if (ok) {
      io.to(room.roomCode).emit('game:state', room.buildGameState());
    } else {
      socket.emit('error', 'Only the host can start the game');
    }
  });

  socket.on('game:move', dir =>
    roomManager.getRoomForSocket(socket.id)?.handleMove(socket.id, dir),
  );

  socket.on('game:rotate', dir =>
    roomManager.getRoomForSocket(socket.id)?.handleRotate(socket.id, dir),
  );

  socket.on('game:softDrop', () =>
    roomManager.getRoomForSocket(socket.id)?.handleSoftDrop(socket.id),
  );

  socket.on('game:hardDrop', () =>
    roomManager.getRoomForSocket(socket.id)?.handleHardDrop(socket.id),
  );

  socket.on('game:usePowerUp', slot =>
    roomManager.getRoomForSocket(socket.id)?.handleUsePowerUp(socket.id, slot),
  );

  socket.on('game:leave', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (room) {
      socket.leave(room.roomCode);
      console.log(`[leave] ${socket.id} left ${room.roomCode}`);
    }
    roomManager.removeSocket(socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    roomManager.removeSocket(socket.id);
  });
});

const PORT = Number(process.env.PORT ?? 3000);
httpServer.listen(PORT, () =>
  console.log(`Tetris server → http://localhost:${PORT}`),
);
