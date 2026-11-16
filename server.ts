import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import type { LobbyPlayer, LobbyRoomState, RemoteMotionPacket } from './src/types/game';

interface ConnectedClient {
  ws: WebSocket;
  id: string;
  roomCode: string | null;
}

interface ServerRoom {
  state: LobbyRoomState;
  clients: Map<string, ConnectedClient>;
}

const rooms = new Map<string, ServerRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoomState(room: ServerRoom): void {
  const msg = JSON.stringify({ type: 'room_state', room: room.state });
  for (const client of room.clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

function removeClientFromRoom(client: ConnectedClient): void {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;

  room.clients.delete(client.id);
  room.state.players = room.state.players.filter((p) => p.id !== client.id);

  if (room.state.players.length === 0) {
    rooms.delete(room.state.code);
    return;
  }

  // Promote next player to host if host left
  if (!room.state.players.some((p) => p.isHost)) {
    room.state.players[0].isHost = true;
  }

  broadcastRoomState(room);
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', activeRooms: rooms.size });
  });

  app.get('/api/rooms', (_req, res) => {
    const publicRooms = Array.from(rooms.values())
      .filter((r) => !r.state.started && r.state.players.length < r.state.maxPlayers)
      .map((r) => ({
        code: r.state.code,
        mode: r.state.mode,
        trackId: r.state.trackId,
        playerCount: r.state.players.length,
        maxPlayers: r.state.maxPlayers,
        hostName: r.state.players.find((p) => p.isHost)?.name ?? 'Host',
      }));
    res.json({ rooms: publicRooms });
  });

  wss.on('connection', (ws) => {
    const clientId = 'drv_' + Math.random().toString(36).slice(2, 10);
    const client: ConnectedClient = { ws, id: clientId, roomCode: null };
    sendJson(ws, { type: 'welcome', clientId });

    ws.on('message', (raw) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'ping': {
          sendJson(ws, { type: 'pong', ts: msg.ts });
          if (typeof msg.rtt === 'number' && client.roomCode) {
            const room = rooms.get(client.roomCode);
            const player = room?.state.players.find((p) => p.id === client.id);
            if (player) {
              player.pingMs = Math.max(1, Math.round(msg.rtt));
            }
          }
          break;
        }

        case 'create_room': {
          removeClientFromRoom(client);
          const code = generateRoomCode();
          const player: LobbyPlayer = {
            id: client.id,
            name: String(msg.player?.name || 'Driver 1').slice(0, 24),
            carId: String(msg.player?.carId || 'apex-gt'),
            customization: msg.player?.customization,
            ready: true,
            isHost: true,
            pingMs: 12,
          };
          const roomState: LobbyRoomState = {
            code,
            mode: msg.mode === 'open-world' ? 'open-world' : 'race',
            transport: 'internet',
            trackId: String(msg.trackId || 'coastal-horizon'),
            laps: Math.max(1, Math.min(5, Number(msg.laps || 2))),
            fillWithAi: Boolean(msg.fillWithAi ?? true),
            trafficEnabled: Boolean(msg.trafficEnabled ?? true),
            maxPlayers: 8,
            started: false,
            players: [player],
          };
          const room: ServerRoom = { state: roomState, clients: new Map([[client.id, client]]) };
          rooms.set(code, room);
          client.roomCode = code;
          broadcastRoomState(room);
          break;
        }

        case 'join_room': {
          const code = String(msg.code || '').trim().toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            sendJson(ws, { type: 'error', code: 'ROOM_NOT_FOUND' });
            return;
          }
          if (room.state.players.length >= room.state.maxPlayers) {
            sendJson(ws, { type: 'error', code: 'ROOM_FULL' });
            return;
          }
          removeClientFromRoom(client);
          const player: LobbyPlayer = {
            id: client.id,
            name: String(msg.player?.name || `Driver ${room.state.players.length + 1}`).slice(0, 24),
            carId: String(msg.player?.carId || 'apex-gt'),
            customization: msg.player?.customization,
            ready: false,
            isHost: false,
            pingMs: 18,
          };
          room.state.players.push(player);
          room.clients.set(client.id, client);
          client.roomCode = code;
          broadcastRoomState(room);
          break;
        }

        case 'leave_room': {
          removeClientFromRoom(client);
          break;
        }

        case 'update_player': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room) return;
          const p = room.state.players.find((pl) => pl.id === client.id);
          if (!p) return;
          if (msg.carId) p.carId = String(msg.carId);
          if (msg.customization) p.customization = msg.customization;
          if (typeof msg.ready === 'boolean') p.ready = msg.ready;
          if (msg.name) p.name = String(msg.name).slice(0, 24);
          broadcastRoomState(room);
          break;
        }

        case 'update_room_settings': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room) return;
          const p = room.state.players.find((pl) => pl.id === client.id);
          if (!p || !p.isHost) return;
          if (msg.trackId) room.state.trackId = String(msg.trackId);
          if (typeof msg.laps === 'number') room.state.laps = Math.max(1, Math.min(5, msg.laps));
          if (typeof msg.fillWithAi === 'boolean') room.state.fillWithAi = msg.fillWithAi;
          if (typeof msg.trafficEnabled === 'boolean') room.state.trafficEnabled = msg.trafficEnabled;
          broadcastRoomState(room);
          break;
        }

        case 'start_game': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room) return;
          const p = room.state.players.find((pl) => pl.id === client.id);
          if (!p || !p.isHost) return;
          room.state.started = true;
          const startPayload = JSON.stringify({
            type: 'game_started',
            room: room.state,
            serverStartTs: Date.now(),
          });
          for (const c of room.clients.values()) {
            if (c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(startPayload);
            }
          }
          break;
        }

        case 'motion_packet': {
          if (!client.roomCode) return;
          const room = rooms.get(client.roomCode);
          if (!room) return;
          const packet = msg.packet as RemoteMotionPacket;
          if (!packet) return;
          packet.id = client.id;
          const relay = JSON.stringify({ type: 'motion_packet', packet });
          for (const [peerId, peer] of room.clients.entries()) {
            if (peerId !== client.id && peer.ws.readyState === WebSocket.OPEN) {
              peer.ws.send(relay);
            }
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      removeClientFromRoom(client);
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Apex Drift 3D server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
