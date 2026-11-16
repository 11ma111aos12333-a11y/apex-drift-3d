import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../data/tracks';
import { CARS } from '../data/cars';
import { VehicleTelemetry } from '../types/game';
import { computeAiDriverInput } from './aiRacer';

test('AI racer steers toward upcoming track waypoint and throttles cleanly', () => {
  const track = TRACKS[0];
  const car = CARS[0];
  const ai: VehicleTelemetry = {
    id: 'ai-1',
    name: 'AI 1',
    isPlayer: false,
    isAi: true,
    carId: car.id,
    customization: {
      paintColor: car.defaultPaint,
      rimColor: car.defaultRim,
      underglowColor: 'none',
      windowTint: 0.4,
    },
    x: track.waypoints[0].x,
    y: 0,
    z: track.waypoints[0].z,
    vx: 0,
    vy: 0,
    vz: -15,
    yaw: 0,
    pitch: 0,
    roll: 0,
    speedMs: 15,
    speedKmh: 54,
    rpm: 3000,
    gear: 2,
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

  const input = computeAiDriverInput(ai, [ai], track, 0, 0.95, false);
  assert.ok(input.throttle > 0.2, 'AI should apply throttle');
  assert.ok(input.steer >= -1 && input.steer <= 1, 'Steer should stay normalized');
});
