import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteCarInterpolator } from './interpolation';

test('interpolator blends smoothly between sequential motion packets', () => {
  const interp = new RemoteCarInterpolator();
  interp.pushPacket(
    {
      id: 'friend-1',
      seq: 1,
      ts: 1000,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      vx: 10,
      vy: 0,
      vz: 0,
      steer: 0,
      wheelRpm: 100,
      nitro: false,
      braking: false,
      drifting: false,
      lap: 1,
      lapProgress: 0.1,
      finished: false,
      finishTimeMs: 0,
    },
    1000,
  );
  interp.pushPacket(
    {
      id: 'friend-1',
      seq: 2,
      ts: 1100,
      x: 10,
      y: 0,
      z: 20,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      vx: 10,
      vy: 0,
      vz: 0,
      steer: 0.4,
      wheelRpm: 200,
      nitro: true,
      braking: false,
      drifting: false,
      lap: 1,
      lapProgress: 0.2,
      finished: false,
      finishTimeMs: 0,
    },
    1100,
  );

  // At nowMs = 1115, renderTime = 1115 - 65 = 1050 (midpoint between 1000 and 1100)
  const pose = interp.sample('friend-1', 1115);
  assert.ok(pose !== null);
  assert.ok(Math.abs(pose.x - 5) < 0.01, `expected x near 5, got ${pose.x}`);
  assert.ok(Math.abs(pose.z - 10) < 0.01, `expected z near 10, got ${pose.z}`);
  assert.ok(Math.abs(pose.steer - 0.2) < 0.01);
});
