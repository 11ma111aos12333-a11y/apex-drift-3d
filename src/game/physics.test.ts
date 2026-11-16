import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS } from '../data/cars';
import { TRACKS } from '../data/tracks';
import { VehicleTelemetry } from '../types/game';
import {
  resolveVehicleCollisions,
  sampleSurfaceAt,
  stepFixedChaseCamera,
  stepVehiclePhysics,
  updateRaceStandings,
} from './physics';

function makeTestVehicle(id: string, x = 0, z = 0): VehicleTelemetry {
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
    yaw: 0,
    pitch: 0,
    roll: 0,
    speedMs: 0,
    speedKmh: 0,
    rpm: 1000,
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
  };
}

test('vehicle accelerates forward and engages nitro boost', () => {
  const car = CARS[0];
  const track = TRACKS[0];
  const v = makeTestVehicle('p1', 0, 0);

  for (let i = 0; i < 60; i++) {
    stepVehiclePhysics(
      v,
      { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: true },
      car,
      track,
      0.016,
      i * 16,
      2,
      true,
    );
  }

  assert.ok(v.speedKmh > 120, `expected speed > 120 km/h, got ${v.speedKmh}`);
  assert.ok(v.z < -10, 'expected vehicle to move forward along -Z');
  assert.ok(v.nitro < 100, 'expected nitro to drain while active');
  assert.ok(v.wheelRotation > 0, 'expected wheels to spin');
});

test('handbrake + steering triggers drift state', () => {
  const car = CARS[1]; // Phantom V8 Drift
  const track = TRACKS[0];
  const v = makeTestVehicle('p1', 0, 0);
  v.vz = -28; // already moving fast along -Z

  for (let i = 0; i < 20; i++) {
    stepVehiclePhysics(
      v,
      { throttle: 1, brake: 0, steer: 1, handbrake: true, nitro: false },
      car,
      track,
      0.016,
      i * 16,
      2,
      true,
    );
  }

  assert.equal(v.isDrifting, true);
  assert.ok(Math.abs(v.roll) > 0.01, 'expected body roll during turn');
});

test('stunt ramp raises groundY and launches airborne', () => {
  const track = TRACKS[0];
  const ramp = track.ramps[0];
  const onRampSample = sampleSurfaceAt(ramp.x, ramp.z, track);
  assert.equal(onRampSample.onRamp, true);
  assert.ok(onRampSample.groundY > 0.5);
});

test('collision resolution separates overlapping cars', () => {
  const a = makeTestVehicle('p1', 0, 0);
  const b = makeTestVehicle('p2', 0.8, 0);
  a.vx = 10;
  b.vx = -10;

  const impact = resolveVehicleCollisions([a, b]);
  assert.ok(impact > 0);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > 1.5);
});

test('race standings rank finished players by time and unfinished by progress', () => {
  const a = makeTestVehicle('p1');
  const b = makeTestVehicle('p2');
  const c = makeTestVehicle('p3');

  a.finished = true;
  a.finishTimeMs = 45000;
  b.finished = true;
  b.finishTimeMs = 42000;
  c.finished = false;
  c.totalProgress = 1.9;

  updateRaceStandings([a, b, c]);
  assert.equal(b.rank, 1);
  assert.equal(a.rank, 2);
  assert.equal(c.rank, 3);
});

test('left steering (steer = +1) turns toward -X and right steering (steer = -1) turns toward +X', () => {
  const car = CARS[0];
  const track = TRACKS[0];

  const leftCar = makeTestVehicle('p1', 0, 0);
  leftCar.vz = -25;
  for (let i = 0; i < 20; i++) {
    stepVehiclePhysics(
      leftCar,
      { throttle: 1, brake: 0, steer: 1, handbrake: false, nitro: false },
      car,
      track,
      0.016,
      i * 16,
      0,
      true,
      { mode: 'open-world' },
    );
  }
  assert.ok(leftCar.x < -0.5, `expected left turn (steer=+1) to move toward -X, got x=${leftCar.x}`);
  assert.ok(leftCar.yaw > 0, `expected positive yaw for left turn, got yaw=${leftCar.yaw}`);

  const rightCar = makeTestVehicle('p1', 0, 0);
  rightCar.vz = -25;
  for (let i = 0; i < 20; i++) {
    stepVehiclePhysics(
      rightCar,
      { throttle: 1, brake: 0, steer: -1, handbrake: false, nitro: false },
      car,
      track,
      0.016,
      i * 16,
      0,
      true,
      { mode: 'open-world' },
    );
  }
  assert.ok(rightCar.x > 0.5, `expected right turn (steer=-1) to move toward +X, got x=${rightCar.x}`);
  assert.ok(rightCar.yaw < 0, `expected negative yaw for right turn, got yaw=${rightCar.yaw}`);
});

test('car-vs-car collision transfers more velocity impulse to lighter car', () => {
  const light = makeTestVehicle('p1', 0, 0);
  const heavy = makeTestVehicle('p2', 1.4, 0);
  light.carId = CARS[0].id; // lighter supercar
  heavy.carId = CARS[4].id; // heavier SUV
  light.vx = 18;
  heavy.vx = 0;

  const contacts: Array<{ x: number; y: number; z: number; intensity: number }> = [];
  const impact = resolveVehicleCollisions(
    [light, heavy],
    (id) => (id === CARS[4].id ? 2600 : 1200),
    contacts,
  );
  assert.ok(impact > 10);
  assert.ok(contacts.length > 0, 'expected collision contact for spark emission');
  assert.ok(light.vx < 5, `expected heavy SUV to bounce light car back, got light.vx=${light.vx}`);
  assert.ok(heavy.vx > 1, `expected momentum transferred to heavy car, got heavy.vx=${heavy.vx}`);
});

test('fixed medium chase camera keeps exact 5.6m radius and 2.2m height even at 380 km/h', () => {
  const car = CARS[0];
  const track = TRACKS[0];
  const v = makeTestVehicle('p1', 0, 0);

  let chaseYaw = 0;
  for (let i = 0; i < 90; i++) {
    stepVehiclePhysics(
      v,
      { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: true },
      car,
      track,
      0.016,
      i * 16,
      0,
      true,
      { mode: 'open-world' },
    );
    const pose = stepFixedChaseCamera(v.x, v.y, v.z, v.yaw, chaseYaw, 0.016);
    chaseYaw = pose.chaseYaw;
    const horizDist = Math.hypot(pose.camX - v.x, pose.camZ - v.z);
    assert.ok(
      Math.abs(horizDist - 5.6) < 1e-6,
      `expected fixed 5.6m trailing distance, got ${horizDist}`,
    );
    assert.ok(
      Math.abs(pose.camY - (v.y + 2.2)) < 1e-6,
      `expected fixed +2.2m camera height, got ${pose.camY - v.y}`,
    );
  }
  assert.ok(v.speedKmh > 150, `expected high speed during nitro test, got ${v.speedKmh}`);
});

test('fixed chase camera smoothly interpolates lateral yaw without longitudinal lag', () => {
  const pose = stepFixedChaseCamera(10, 0, -40, 0.6, 0, 0.016);
  assert.ok(pose.chaseYaw > 0 && pose.chaseYaw < 0.6, 'expected damped lateral yaw');
  const dist = Math.hypot(pose.camX - 10, pose.camZ - -40);
  assert.ok(Math.abs(dist - 5.6) < 1e-6, 'radius stays locked at 5.6m during yaw turn');
});


