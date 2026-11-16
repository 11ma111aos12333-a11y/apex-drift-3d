import {
  CarCustomization,
  GameMode,
  LobbyPlayer,
  LobbyRoomState,
  PairingTransport,
  RemoteMotionPacket,
} from '../types/game';
import { bluetoothBridge } from './bluetoothBridge';

type RoomListener = (room: LobbyRoomState | null) => void;
type MotionListener = (packet: RemoteMotionPacket) => void;
type StartListener = (room: LobbyRoomState) => void;
type ErrorListener = (code: string) => void;

export class MultiplayerNetworkManager {
  private ws: WebSocket | null = null;
  private clientId: string = 'local_' + Math.random().toString(36).slice(2, 8);
  private transport: PairingTransport = 'internet';
  private room: LobbyRoomState | null = null;
  private pingMs = 14;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private lastPingSentAt = 0;

  private roomListeners = new Set<RoomListener>();
  private motionListeners = new Set<MotionListener>();
  private startListeners = new Set<StartListener>();
  private errorListeners = new Set<ErrorListener>();

  getClientId(): string {
    return this.clientId;
  }

  getPingMs(): number {
    return this.pingMs;
  }

  getCurrentRoom(): LobbyRoomState | null {
    return this.room;
  }

  getTransport(): PairingTransport {
    return this.transport;
  }

  onRoomChange(cb: RoomListener): () => void {
    this.roomListeners.add(cb);
    cb(this.room);
    return () => this.roomListeners.delete(cb);
  }

  onMotionPacket(cb: MotionListener): () => void {
    this.motionListeners.add(cb);
    return () => this.motionListeners.delete(cb);
  }

  onGameStarted(cb: StartListener): () => void {
    this.startListeners.add(cb);
    return () => this.startListeners.delete(cb);
  }

  onError(cb: ErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  async connectOnline(): Promise<void> {
    this.transport = 'internet';
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(url);
      this.ws = ws;

      const timeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 6000);

      ws.onopen = () => {
        window.clearTimeout(timeout);
        this.startPingLoop();
        resolve();
      };

      ws.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      };

      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'welcome') {
          this.clientId = msg.clientId;
        } else if (msg.type === 'pong') {
          this.pingMs = Math.max(1, Math.round(performance.now() - this.lastPingSentAt));
        } else if (msg.type === 'room_state') {
          this.room = msg.room;
          this.roomListeners.forEach((cb) => cb(this.room));
        } else if (msg.type === 'game_started') {
          this.room = msg.room;
          this.roomListeners.forEach((cb) => cb(this.room));
          this.startListeners.forEach((cb) => cb(msg.room));
        } else if (msg.type === 'motion_packet') {
          this.motionListeners.forEach((cb) => cb(msg.packet));
        } else if (msg.type === 'error') {
          this.errorListeners.forEach((cb) => cb(msg.code));
        }
      };

      ws.onclose = () => {
        this.stopPingLoop();
        if (this.room && this.transport === 'internet') {
          this.reconnectTimer = window.setTimeout(() => {
            this.connectOnline().catch(() => {});
          }, 2000);
        }
      };
    });
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSentAt = performance.now();
        this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now(), rtt: this.pingMs }));
      }
    }, 2500);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async createOnlineRoom(params: {
    playerName: string;
    carId: string;
    customization: CarCustomization;
    mode: GameMode;
    trackId: string;
    laps: number;
    fillWithAi: boolean;
    trafficEnabled: boolean;
  }): Promise<void> {
    await this.connectOnline();
    this.ws?.send(
      JSON.stringify({
        type: 'create_room',
        mode: params.mode,
        trackId: params.trackId,
        laps: params.laps,
        fillWithAi: params.fillWithAi,
        trafficEnabled: params.trafficEnabled,
        player: {
          name: params.playerName,
          carId: params.carId,
          customization: params.customization,
        },
      }),
    );
  }

  async joinOnlineRoom(
    code: string,
    playerName: string,
    carId: string,
    customization: CarCustomization,
  ): Promise<void> {
    await this.connectOnline();
    this.ws?.send(
      JSON.stringify({
        type: 'join_room',
        code: code.trim().toUpperCase(),
        player: { name: playerName, carId, customization },
      }),
    );
  }

  updatePlayerState(update: Partial<Pick<LobbyPlayer, 'carId' | 'customization' | 'ready' | 'name'>>): void {
    if (this.transport === 'internet' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'update_player', ...update }));
    } else if (this.transport === 'bluetooth' && this.room) {
      const me = this.room.players.find((p) => p.id === this.clientId);
      if (me) {
        Object.assign(me, update);
        this.roomListeners.forEach((cb) => cb(this.room));
        bluetoothBridge.send({ type: 'bt_player', player: me }).catch(() => {});
      }
    }
  }

  updateRoomSettings(settings: Partial<Pick<LobbyRoomState, 'trackId' | 'laps' | 'fillWithAi' | 'trafficEnabled'>>): void {
    if (this.transport === 'internet' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'update_room_settings', ...settings }));
    } else if (this.transport === 'bluetooth' && this.room) {
      Object.assign(this.room, settings);
      this.roomListeners.forEach((cb) => cb(this.room));
      bluetoothBridge.send({ type: 'bt_room', room: this.room }).catch(() => {});
    }
  }

  startMultiplayerGame(): void {
    if (this.transport === 'internet' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'start_game' }));
    } else if (this.transport === 'bluetooth' && this.room) {
      this.room.started = true;
      bluetoothBridge.send({ type: 'bt_start', room: this.room }).catch(() => {});
      this.startListeners.forEach((cb) => cb(this.room!));
    }
  }

  setupBluetoothLobby(params: {
    isHost: boolean;
    playerName: string;
    carId: string;
    customization: CarCustomization;
    mode: GameMode;
    trackId: string;
    laps: number;
    fillWithAi: boolean;
    trafficEnabled: boolean;
  }): LobbyRoomState {
    this.transport = 'bluetooth';
    const me: LobbyPlayer = {
      id: this.clientId,
      name: params.playerName,
      carId: params.carId,
      customization: params.customization,
      ready: params.isHost,
      isHost: params.isHost,
      pingMs: 8,
    };
    this.room = {
      code: 'BT-RFCOMM',
      mode: params.mode,
      transport: 'bluetooth',
      trackId: params.trackId,
      laps: params.laps,
      fillWithAi: params.fillWithAi,
      trafficEnabled: params.trafficEnabled,
      maxPlayers: 4,
      started: false,
      players: [me],
    };
    this.roomListeners.forEach((cb) => cb(this.room));
    return this.room;
  }

  handleBluetoothRawPacket(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'motion_packet') {
      this.motionListeners.forEach((cb) => cb(msg.packet));
    } else if (msg.type === 'bt_player' && this.room) {
      const incoming = msg.player as LobbyPlayer;
      const idx = this.room.players.findIndex((p) => p.id === incoming.id);
      if (idx >= 0) this.room.players[idx] = incoming;
      else this.room.players.push(incoming);
      this.roomListeners.forEach((cb) => cb({ ...this.room! }));
      bluetoothBridge.send({ type: 'bt_room', room: this.room }).catch(() => {});
    } else if (msg.type === 'bt_room') {
      this.room = msg.room;
      this.roomListeners.forEach((cb) => cb(this.room));
    } else if (msg.type === 'bt_start') {
      this.room = msg.room;
      this.startListeners.forEach((cb) => cb(msg.room));
    }
  }

  sendMotionPacket(packet: RemoteMotionPacket): void {
    if (this.transport === 'internet') {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'motion_packet', packet }));
      }
    } else {
      bluetoothBridge.send({ type: 'motion_packet', packet }).catch(() => {});
    }
  }

  leaveRoom(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'leave_room' }));
    }
    if (this.transport === 'bluetooth') {
      bluetoothBridge.disconnect().catch(() => {});
    }
    this.room = null;
    this.roomListeners.forEach((cb) => cb(null));
  }
}

export const networkManager = new MultiplayerNetworkManager();
