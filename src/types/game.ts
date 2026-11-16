export type Language = 'ar' | 'en';

export type ScreenState =
  | 'title'
  | 'garage'
  | 'mode-select'
  | 'lobby'
  | 'playing'
  | 'paused'
  | 'gameover';

export type GameMode = 'open-world' | 'race';
export type RaceOpponentMode = 'ai' | 'friends';
export type PairingTransport = 'internet' | 'bluetooth';
export type SteeringControlMode = 'buttons' | 'wheel' | 'gyro';
export type CameraAngle = 'chase' | 'hood' | 'overhead';
export type GraphicsQuality = 'low' | 'medium' | 'high';

export type CarCategory =
  | 'supercar'
  | 'muscle'
  | 'suv'
  | 'rally'
  | 'tuner'
  | 'hypercar';

export interface CarStats {
  topSpeedKmh: number;     // e.g. 210 - 360
  acceleration: number;    // 0 - 100 rating
  handling: number;        // 0 - 100 rating
  braking: number;         // 0 - 100 rating
  driftControl: number;    // 0 - 100 rating
  offroadGrip: number;     // 0 - 100 rating
}

export interface CarPhysicsProfile {
  maxSpeedMs: number;
  accelForce: number;
  reverseSpeedMs: number;
  brakeForce: number;
  turnSpeed: number;
  lateralGrip: number;
  driftGrip: number;
  offroadMultiplier: number;
  massKg: number;
  suspensionStiffness: number;
  suspensionDamping: number;
  rideHeight: number;
  wheelRadius: number;
  wheelBase: number;
  trackWidth: number;
  nitroPower: number;
  nitroDrainPerSec: number;
  nitroRegenPerSec: number;
}

export interface CarSpec {
  id: string;
  category: CarCategory;
  nameAr: string;
  nameEn: string;
  taglineAr: string;
  taglineEn: string;
  glbModel?: string; // Local path under /assets/models/*.glb if GLB-hybrid
  defaultPaint: string;
  defaultRim: string;
  defaultUnderglow: string;
  stats: CarStats;
  physics: CarPhysicsProfile;
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
}

export interface CarCustomization {
  paintColor: string;
  rimColor: string;
  underglowColor: string; // 'none' or hex
  windowTint: number;     // 0.15 to 0.85
}

export type TrackEnvTheme = 'night-city' | 'desert' | 'coastal' | 'grand-prix';

export interface TrackWaypoint {
  x: number;
  y: number;
  z: number;
  width: number;
  surface: 'asphalt' | 'desert' | 'coastal';
}

export interface StuntRamp {
  x: number;
  y: number;
  z: number;
  rotY: number;
  width: number;
  length: number;
  height: number;
}

export interface TrackSpec {
  id: string;
  nameAr: string;
  nameEn: string;
  envType: 'city' | 'desert' | 'coastal';
  envTheme: TrackEnvTheme;
  roadWidth: number;
  defaultLaps: number;
  waypoints: TrackWaypoint[];
  ramps: StuntRamp[];
}

export type StaticColliderKind =
  | 'building'
  | 'tree'
  | 'rock'
  | 'pole'
  | 'fuel-pillar'
  | 'grandstand'
  | 'barrier';

export interface StaticCollider {
  id: string;
  kind: StaticColliderKind;
  x: number;
  z: number;
  radius: number;
  height: number;
  restitution: number;
}

export interface CollisionContact {
  x: number;
  y: number;
  z: number;
  intensity: number;
}

export interface VehicleInput {
  throttle: number; // 0..1
  brake: number;    // 0..1
  steer: number;    // -1..1 (+1 = left, -1 = right)
  handbrake: boolean;
  nitro: boolean;
}

export interface VehicleTelemetry {
  id: string;
  name: string;
  isPlayer: boolean;
  isAi: boolean;
  carId: string;
  customization: CarCustomization;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  roll: number;
  speedMs: number;
  speedKmh: number;
  rpm: number; // 900 - 8500
  gear: number; // 1 - 6 (0 = R)
  steerAngle: number;
  wheelRotation: number;
  nitro: number; // 0..100
  isNitroActive: boolean;
  isDrifting: boolean;
  isBraking: boolean;
  grounded: boolean;
  lap: number;          // 1-indexed current lap
  lapProgress: number;  // 0..1 along spline
  totalProgress: number;// lap + lapProgress
  rank: number;         // 1..N
  finished: boolean;
  finishTimeMs: number;
  bestLapMs: number;
  lastLapStartMs: number;
  // Checkpoint, Wrong-Way & Recovery state
  nextCheckpointIdx?: number;
  lastValidCheckpointIdx?: number;
  isWrongWay?: boolean;
  wrongWayTimer?: number;
  outOfBoundsTimer?: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  carId: string;
  customization: CarCustomization;
  ready: boolean;
  isHost: boolean;
  pingMs: number;
}

export interface LobbyRoomState {
  code: string;
  mode: GameMode;
  transport: PairingTransport;
  trackId: string;
  laps: number;
  fillWithAi: boolean;
  trafficEnabled: boolean;
  maxPlayers: number;
  started: boolean;
  players: LobbyPlayer[];
}

export interface RemoteMotionPacket {
  id: string;
  seq: number;
  ts: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  steer: number;
  wheelRpm: number;
  nitro: boolean;
  braking: boolean;
  drifting: boolean;
  lap: number;
  lapProgress: number;
  finished: boolean;
  finishTimeMs: number;
}

export interface BluetoothDiscoveredDevice {
  address: string;
  name: string;
  rssi: number;
  bonded: boolean;
}

export interface RaceResultEntry {
  id: string;
  name: string;
  carId: string;
  isPlayer: boolean;
  isAi: boolean;
  rank: number;
  finishTimeMs: number;
  finished: boolean;
}
