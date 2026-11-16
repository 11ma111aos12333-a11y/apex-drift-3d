import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS } from '../data/cars';
import { TRACKS, getTrackById } from '../data/tracks';
import { CollisionContact, VehicleTelemetry } from '../types/game';
import {
  enforceRaceTrackWalls,
  generateWorldLayout,
  projectPointOntoTrack,
  resolveStaticWorldCollisions,
  updateCheckpointsAndRecovery,
} from './colliders';
import { stepVehiclePhysics } from './physics';

function makeCar(id: string, x: number, z: number, yaw = 0): VehicleTelemetry {
  const car = CARS[0];
  return {
    id,
    name: id,
    isPlayer: id === 'p1',
    isAi: id !== 'p1',
    carId: car.id,
    customization: {
      paintColor: car.defaultPaint,
      rimColor: car.defaultRim,
      underglowColor: car.defaultUnderglow,
      windowTint: 0.45,
    },
    x,
    y: 0,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    pitch: 0,
    roll: 0,
    speedMs: 0,
    speedKmh: 0,
    rpm: 1100,
    gear: 1,
    steerAngle: 0,
    wheelRotation: 0,
    nitro: 100,
    isNitroActive: false,
    isDrifting: false,
    isBraking: false,
    grounded: true,
    lap: 1,
    lapProgress: 0,
    totalProgress: 0,
    rank: 1,
    finished: false,
    finishTimeMs: 0,
    bestLapMs: 0,
    lastLapStartMs: 0,
    nextCheckpointIdx: 1,
    lastValidCheckpointIdx: 0,
    isWrongWay: false,
    wrongWayTimer: 0,
    outOfBoundsTimer: 0,
  };
}

test('4 tracks have distinct envThemes and legacy track IDs resolve cleanly', () => {
  assert.equal(TRACKS.length, 4);
  const themes = new Set(TRACKS.map((t) => t.envTheme));
  assert.equal(themes.size, 4);
  assert.equal(getTrackById('coastal-horizon').envTheme, 'coastal');
  assert.equal(getTrackById('neon-grand-prix').envTheme, 'grand-prix');
});

test('car cannot penetrate solid building or tree colliders', () => {
  const track = TRACKS[0]; // Neon Night City
  const layout = generateWorldLayout(track);
  const building = layout.colliders.find((c) => c.kind === 'building');
  const tree = layout.colliders.find((c) => c.kind === 'tree');
  assert.ok(building, 'expected building collider in Night City');
  assert.ok(tree, 'expected tree collider in Night City');

  // Drive straight into building center
  const v = makeCar('p1', building.x, building.z + building.radius + 0.3, 0);
  v.vz = -35;
  const hit = resolveStaticWorldCollisions(v, layout.colliders, 2.65, 1.05);
  assert.ok(hit !== null, 'expected building collision contact');
  const distAfter = Math.hypot(v.x - building.x, v.z - building.z);
  assert.ok(distAfter >= building.radius + 0.5, `expected push-out from building, dist=${distAfter}`);

  // Drive into tree trunk
  const vt = makeCar('p1', tree.x, tree.z + tree.radius + 0.2, 0);
  vt.vz = -20;
  const treeHit = resolveStaticWorldCollisions(vt, layout.colliders, 2.65, 1.05);
  assert.ok(treeHit !== null, 'expected tree trunk collision contact');
});

test('Race Mode strictly clamps cars inside continuous track barriers even at 90 m/s', () => {
  const track = TRACKS[3]; // Grand Prix Circuit
  const car = CARS[0];
  const layout = generateWorldLayout(track);
  const wp0 = track.waypoints[0];
  const wp1 = track.waypoints[1];
  const startYaw = Math.atan2(-(wp1.x - wp0.x), -(wp1.z - wp0.z));
  // Aim sideways directly out of track wall at 90 m/s!
  const v = makeCar('p1', wp0.x, wp0.z, startYaw + Math.PI * 0.5);
  v.vx = -Math.sin(v.yaw) * 90;
  v.vz = -Math.cos(v.yaw) * 90;

  const contacts: CollisionContact[] = [];
  for (let i = 0; i < 30; i++) {
    stepVehiclePhysics(
      v,
      { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: true },
      car,
      track,
      0.016,
      i * 16,
      2,
      true,
      { mode: 'race', colliders: layout.colliders, contactsOut: contacts },
    );
  }

  const proj = projectPointOntoTrack(v.x, v.z, track.waypoints);
  assert.ok(
    proj.distFromCenter <= proj.roadHalfWidth + 0.1,
    `expected Race Mode car clamped within roadHalfWidth (${proj.roadHalfWidth}), got ${proj.distFromCenter}`,
  );
  assert.ok(contacts.length > 0, 'expected guardrail collision contact sparks');
});

test('sequential checkpoints prevent reverse lap cheat and trigger wrong-way + auto-respawn', () => {
  const track = TRACKS[1]; // Desert Canyon
  const wp0 = track.waypoints[0];
  const wp1 = track.waypoints[1];
  const fwdYaw = Math.atan2(-(wp1.x - wp0.x), -(wp1.z - wp0.z));

  // Spawn facing backwards and drive wrong way for > 3.8s
  const v = makeCar('p1', wp0.x, wp0.z, fwdYaw + Math.PI);
  const prevWp = track.waypoints[track.waypoints.length - 1];
  v.x = prevWp.x;
  v.z = prevWp.z;
  v.vx = -Math.sin(v.yaw) * 18;
  v.vz = -Math.cos(v.yaw) * 18;
  v.speedMs = 18;

  // Crossing backwards over start line must NOT increment lap
  updateCheckpointsAndRecovery(v, track, 'race', 0.2, 2000, 3);
  assert.equal(v.lap, 1);

  // Sustained wrong-way triggers warning first
  for (let i = 0; i < 4; i++) {
    updateCheckpointsAndRecovery(v, track, 'race', 0.25, 2500 + i * 250, 3);
  }
  assert.equal(v.isWrongWay, true, 'expected wrong-way banner flag active');

  // Continuing wrong way past recovery threshold teleports vehicle back facing forward
  for (let i = 0; i < 15; i++) {
    updateCheckpointsAndRecovery(v, track, 'race', 0.25, 4000 + i * 250, 3);
  }
  assert.equal(v.isWrongWay, false, 'expected auto-respawn to clear wrong-way flag');
  assert.equal(v.speedMs, 0);
  const distFromReset = Math.hypot(v.x - wp0.x, v.z - wp0.z);
  assert.ok(distFromReset < 2, 'expected vehicle respawned at last valid checkpoint');
});

test('enforceRaceTrackWalls directly bounds out-of-track coordinates', () => {
  const track = TRACKS[2]; // Coastal Mountain
  const wp2 = track.waypoints[2];
  const v = makeCar('p1', wp2.x + 80, wp2.z + 80);
  enforceRaceTrackWalls(v, track, 1.05);
  const proj = projectPointOntoTrack(v.x, v.z, track.waypoints);
  assert.ok(proj.distFromCenter <= proj.roadHalfWidth);
});
