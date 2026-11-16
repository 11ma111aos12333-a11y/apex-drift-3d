import {
  CarSpec,
  CollisionContact,
  GameMode,
  StaticCollider,
  StuntRamp,
  TrackSpec,
  TrackWaypoint,
  VehicleInput,
  VehicleTelemetry,
} from '../types/game';
import {
  enforceRaceTrackWalls,
  projectPointOntoTrack,
  resolveStaticWorldCollisions,
  updateCheckpointsAndRecovery,
} from './colliders';

export interface SurfaceSample {
  groundY: number;
  onRoad: boolean;
  surface: 'asphalt' | 'desert' | 'coastal';
  nearestWaypointIdx: number;
  distToRoad: number;
  onRamp: boolean;
}

/**
 * Evaluate ground elevation and surface type under (x, z), including stunt ramps.
 */
export function sampleSurfaceAt(
  x: number,
  z: number,
  track: TrackSpec,
): SurfaceSample {
  const proj = projectPointOntoTrack(x, z, track.waypoints);
  const nearestIdx = proj.segIdx;
  const distToRoad = proj.distFromCenter;
  const wp = track.waypoints[nearestIdx];
  const halfRoad = proj.roadHalfWidth;
  const onRoad = distToRoad <= halfRoad;
  const surface = onRoad
    ? wp?.surface ?? 'asphalt'
    : track.envType === 'desert'
      ? 'desert'
      : track.envType === 'coastal'
        ? 'coastal'
        : 'asphalt';

  // Theme-tailored off-road terrain elevation
  let groundY = 0;
  if (!onRoad && distToRoad > halfRoad + 4) {
    const blend = Math.min(1, (distToRoad - halfRoad - 4) / 24);
    if (track.envTheme === 'desert') {
      groundY =
        blend *
        (Math.sin(x * 0.032) * Math.cos(z * 0.032) * 2.8 +
          Math.sin(x * 0.016 + z * 0.022) * 1.9);
      if (groundY < 0) groundY *= 0.2;
    } else if (track.envTheme === 'coastal') {
      const mountainBoost = x < 40 ? 1.85 : 0.65;
      groundY =
        blend *
        mountainBoost *
        (Math.sin(x * 0.028) * Math.cos(z * 0.028) * 2.4 +
          Math.cos(x * 0.015 - z * 0.018) * 1.4);
      if (groundY < 0) groundY = 0;
    }
  }

  // Check stunt ramps
  let onRamp = false;
  for (let i = 0; i < track.ramps.length; i++) {
    const r: StuntRamp = track.ramps[i];
    const dx = x - r.x;
    const dz = z - r.z;
    const cos = Math.cos(-r.rotY);
    const sin = Math.sin(-r.rotY);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const halfW = r.width * 0.5;
    const halfL = r.length * 0.5;
    if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfL) {
      // Ramp rises from +halfL (entry) toward -halfL (launch lip)
      const progress = (halfL - localZ) / r.length; // 0..1
      const rampH = Math.max(0, progress) * r.height;
      if (rampH > groundY) {
        groundY = rampH;
        onRamp = true;
      }
    }
  }

  return {
    groundY,
    onRoad,
    surface,
    nearestWaypointIdx: nearestIdx,
    distToRoad,
    onRamp,
  };
}

/**
 * Compute continuous lap progress [0, 1) along closed track waypoints.
 */
export function computeTrackProgress(
  x: number,
  z: number,
  waypoints: TrackWaypoint[],
): { waypointIdx: number; progress: number } {
  const n = waypoints.length;
  if (n === 0) return { waypointIdx: 0, progress: 0 };

  let bestIdx = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = x - waypoints[i].x;
    const dz = z - waypoints[i].z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestIdx = i;
    }
  }

  const nextIdx = (bestIdx + 1) % n;
  const pA = waypoints[bestIdx];
  const pB = waypoints[nextIdx];
  const segX = pB.x - pA.x;
  const segZ = pB.z - pA.z;
  const segLenSq = segX * segX + segZ * segZ || 1;
  const relX = x - pA.x;
  const relZ = z - pA.z;
  const t = Math.max(0, Math.min(1, (relX * segX + relZ * segZ) / segLenSq));

  return {
    waypointIdx: bestIdx,
    progress: (bestIdx + t) / n,
  };
}

export interface PhysicsStepOptions {
  mode?: GameMode;
  colliders?: StaticCollider[];
  contactsOut?: CollisionContact[];
}

/**
 * Step a single vehicle's physics & lap state deterministically for dt seconds.
 */
export function stepVehiclePhysics(
  v: VehicleTelemetry,
  input: VehicleInput,
  car: CarSpec,
  track: TrackSpec,
  dt: number,
  raceElapsedMs: number,
  totalLaps: number,
  allowMovement = true,
  options?: PhysicsStepOptions,
): void {
  const safeDt = Math.min(Math.max(dt, 0.001), 0.05);
  const p = car.physics;
  const mode: GameMode = options?.mode ?? (totalLaps > 0 ? 'race' : 'open-world');

  const surface = sampleSurfaceAt(v.x, v.z, track);

  // Nitro logic
  const wantsNitro = allowMovement && input.nitro && v.nitro > 1 && input.throttle > 0.1;
  v.isNitroActive = wantsNitro;
  if (wantsNitro) {
    v.nitro = Math.max(0, v.nitro - p.nitroDrainPerSec * safeDt);
  } else {
    const regenBoost = v.isDrifting ? 1.8 : 1.0;
    v.nitro = Math.min(100, v.nitro + p.nitroRegenPerSec * regenBoost * safeDt);
  }
  const surfaceFactor = surface.onRoad ? 1.0 : p.offroadMultiplier;

  // Direction vectors before steering update (yaw = 0 faces -Z)
  const prevFwdX = -Math.sin(v.yaw);
  const prevFwdZ = -Math.cos(v.yaw);
  const preFwdSpeed = v.vx * prevFwdX + v.vz * prevFwdZ;

  // Steering & yaw update
  const targetSteer = allowMovement ? input.steer * 0.48 : 0;
  v.steerAngle += (targetSteer - v.steerAngle) * Math.min(1, safeDt * 12);

  const maxSpeedPre = p.maxSpeedMs * surfaceFactor * (wantsNitro ? p.nitroPower : 1.0);
  const speedRatio = Math.min(1, Math.abs(preFwdSpeed) / 14);
  const reverseSign = preFwdSpeed >= -0.2 ? 1 : -1;
  if (v.grounded && allowMovement && Math.abs(preFwdSpeed) > 0.6) {
    const yawRate =
      v.steerAngle *
      p.turnSpeed *
      (1.15 - 0.35 * Math.min(1, Math.abs(preFwdSpeed) / maxSpeedPre)) *
      speedRatio *
      reverseSign *
      (input.handbrake ? 1.38 : 1.0);
    v.yaw += yawRate * safeDt;
  }

  // Decompose existing world velocity onto the NEW chassis axes -> authentic lateral slip!
  const newFwdX = -Math.sin(v.yaw);
  const newFwdZ = -Math.cos(v.yaw);
  const newRightX = Math.cos(v.yaw);
  const newRightZ = -Math.sin(v.yaw);

  let fwdSpeed = v.vx * newFwdX + v.vz * newFwdZ;
  let latSpeed = v.vx * newRightX + v.vz * newRightZ;

  const maxSpeed = maxSpeedPre;

  if (allowMovement && v.grounded) {
    // Acceleration
    if (input.throttle > 0) {
      const accel = p.accelForce * input.throttle * (wantsNitro ? p.nitroPower : 1.0);
      fwdSpeed += accel * safeDt;
    }

    // Braking / Reverse
    if (input.brake > 0) {
      if (fwdSpeed > 1.2) {
        fwdSpeed -= p.brakeForce * input.brake * safeDt;
        if (fwdSpeed < 0) fwdSpeed = 0;
      } else {
        fwdSpeed -= p.accelForce * 0.65 * input.brake * safeDt;
        if (fwdSpeed < -p.reverseSpeedMs) fwdSpeed = -p.reverseSpeedMs;
      }
    }

    // Natural rolling resistance + aerodynamic drag
    if (input.throttle <= 0.02 && input.brake <= 0.02) {
      const coastDrag = Math.exp(-1.15 * safeDt);
      fwdSpeed *= coastDrag;
    }
    const aeroDrag = 1 - Math.min(0.35, (Math.abs(fwdSpeed) / maxSpeed) * 0.08 * safeDt);
    fwdSpeed *= aeroDrag;
    if (fwdSpeed > maxSpeed) {
      fwdSpeed += (maxSpeed - fwdSpeed) * Math.min(1, safeDt * 6);
    }

    // Handbrake slows forward slightly while loosening rear lateral grip
    if (input.handbrake) {
      fwdSpeed *= Math.exp(-1.3 * safeDt);
    }
  } else if (!allowMovement) {
    fwdSpeed *= Math.exp(-5 * safeDt);
    latSpeed *= Math.exp(-8 * safeDt);
  }

  // Lateral tire friction (lowers during handbrake or high-speed cornering -> real drift!)
  if (v.grounded) {
    const grip = input.handbrake
      ? p.driftGrip
      : Math.abs(latSpeed) > 7.5
        ? p.driftGrip * 1.45
        : p.lateralGrip;
    latSpeed *= Math.exp(-grip * surfaceFactor * safeDt);
  }

  v.isDrifting =
    v.grounded &&
    Math.abs(fwdSpeed) > 10 &&
    (Math.abs(latSpeed) > 3.6 || (input.handbrake && Math.abs(v.steerAngle) > 0.12));
  v.isBraking = allowMovement && input.brake > 0.1 && fwdSpeed > 0.5;

  // Recombine world horizontal velocity
  v.vx = newFwdX * fwdSpeed + newRightX * latSpeed;
  v.vz = newFwdZ * fwdSpeed + newRightZ * latSpeed;

  // Move horizontally
  v.x += v.vx * safeDt;
  v.z += v.vz * safeDt;

  // 1. Strict Race Track Wall Barriers (Race Mode) OR Open-World Perimeter
  const carHalfW = Math.max(0.95, car.dimensions.width * 0.52);
  if (mode === 'race') {
    const wallHit = enforceRaceTrackWalls(v, track, carHalfW);
    if (wallHit && options?.contactsOut) {
      options.contactsOut.push(wallHit);
    }
  } else {
    const maxRadius = 330;
    const distCenter = Math.hypot(v.x, v.z);
    if (distCenter > maxRadius) {
      const nx = v.x / distCenter;
      const nz = v.z / distCenter;
      v.x = nx * maxRadius;
      v.z = nz * maxRadius;
      const radialVel = v.vx * nx + v.vz * nz;
      if (radialVel > 0) {
        v.vx -= 1.4 * radialVel * nx;
        v.vz -= 1.4 * radialVel * nz;
      }
    }
  }

  // 2. Solid World Static Colliders (Buildings, Trees, Rocks, Grandstands, Light Poles, Fuel Station)
  if (options?.colliders && options.colliders.length > 0) {
    const staticHit = resolveStaticWorldCollisions(v, options.colliders, p.wheelBase, carHalfW);
    if (staticHit && options.contactsOut) {
      options.contactsOut.push(staticHit);
    }
  }

  // Vertical physics (ramps + gravity + suspension)
  const nextSurface = sampleSurfaceAt(v.x, v.z, track);
  const targetY = nextSurface.groundY;

  if (v.y > targetY + 0.06 || v.vy > 0.5) {
    v.vy -= 21.5 * safeDt; // Gravity
    v.y += v.vy * safeDt;
    if (v.y <= targetY) {
      v.y = targetY;
      v.vy = 0;
      v.grounded = true;
    } else {
      v.grounded = false;
    }
  } else {
    // Launch upward if leaving a ramp lip with forward speed
    const prevGround = surface.groundY;
    if (surface.onRamp && !nextSurface.onRamp && fwdSpeed > 14 && prevGround > 0.6) {
      v.vy = Math.min(11, fwdSpeed * 0.21);
      v.grounded = false;
    } else {
      v.y = targetY;
      v.vy = 0;
      v.grounded = true;
    }
  }

  // Suspension body roll & squat/dive pitch
  const accelPitch = allowMovement
    ? (input.brake > 0.1 && fwdSpeed > 2 ? -0.055 : input.throttle * -0.03 * -1) // squat back on accel, dive forward on brake
    : 0;
  const targetPitch = v.grounded
    ? (input.throttle > 0.1 ? 0.032 * input.throttle : 0) +
      (input.brake > 0.1 && fwdSpeed > 2 ? -0.055 : 0) +
      (wantsNitro ? 0.025 : 0)
    : THREE_CLAMP(v.vy * 0.025, -0.25, 0.25);
  void accelPitch;
  const targetRoll = THREE_CLAMP(-latSpeed * 0.011 - v.steerAngle * (fwdSpeed / 70) * 0.06, -0.14, 0.14);

  v.pitch += (targetPitch - v.pitch) * Math.min(1, safeDt * p.suspensionStiffness);
  v.roll += (targetRoll - v.roll) * Math.min(1, safeDt * p.suspensionStiffness);

  // Speed, RPM, Gear & Wheel rotation
  v.speedMs = Math.hypot(v.vx, v.vz);
  v.speedKmh = Math.round(v.speedMs * 3.6);
  v.wheelRotation += (fwdSpeed / p.wheelRadius) * safeDt;

  if (fwdSpeed < -0.5) {
    v.gear = 0; // Reverse
    v.rpm = Math.round(1200 + Math.min(1, Math.abs(fwdSpeed) / p.reverseSpeedMs) * 4500);
  } else {
    const ratio = Math.min(0.999, v.speedMs / p.maxSpeedMs);
    const gearFloat = ratio * 6;
    v.gear = Math.max(1, Math.min(6, Math.floor(gearFloat) + 1));
    const gearProgress = gearFloat - Math.floor(gearFloat);
    v.rpm = Math.round(1100 + gearProgress * 6200 + (wantsNitro ? 900 : 0));
  }

  // Sequential Checkpoints, Anti-Cheat Lap Validation, Wrong-Way Warning & Auto-Respawn
  updateCheckpointsAndRecovery(v, track, mode, safeDt, raceElapsedMs, totalLaps);
}

function THREE_CLAMP(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Resolve solid dual-capsule (front + rear sphere) collisions between all active vehicles
 * with mass-weighted momentum transfer, speed damping, and contact spark events.
 */
export function resolveVehicleCollisions(
  vehicles: VehicleTelemetry[],
  getMassKg?: (carId: string) => number,
  contactsOut?: CollisionContact[],
): number {
  let maxImpact = 0;
  const sphereRadius = 1.08;
  const minDist = sphereRadius * 2;
  const minDistSq = minDist * minDist;

  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      if (Math.abs(a.y - b.y) > 1.8) continue;

      // Quick broadphase center check
      if (Math.hypot(b.x - a.x, b.z - a.z) > 6.5) continue;

      const massA = getMassKg ? getMassKg(a.carId) : 1500;
      const massB = getMassKg ? getMassKg(b.carId) : 1500;
      const invMassA = 1 / Math.max(400, massA);
      const invMassB = 1 / Math.max(400, massB);
      const invMassSum = invMassA + invMassB;

      const fwdAx = -Math.sin(a.yaw);
      const fwdAz = -Math.cos(a.yaw);
      const fwdBx = -Math.sin(b.yaw);
      const fwdBz = -Math.cos(b.yaw);
      const off = 0.92;

      const spheresA = [
        { x: a.x + fwdAx * off, z: a.z + fwdAz * off },
        { x: a.x - fwdAx * off, z: a.z - fwdAz * off },
      ];
      const spheresB = [
        { x: b.x + fwdBx * off, z: b.z + fwdBz * off },
        { x: b.x - fwdBx * off, z: b.z - fwdBz * off },
      ];

      let bestPush = 0;
      let bestNx = 0;
      let bestNz = 0;
      let hitX = 0;
      let hitZ = 0;

      for (let sa = 0; sa < 2; sa++) {
        for (let sb = 0; sb < 2; sb++) {
          const dx = spheresB[sb].x - spheresA[sa].x;
          const dz = spheresB[sb].z - spheresA[sa].z;
          const dSq = dx * dx + dz * dz;
          if (dSq > 0.0001 && dSq < minDistSq) {
            const d = Math.sqrt(dSq);
            const push = minDist - d;
            if (push > bestPush) {
              bestPush = push;
              bestNx = dx / d;
              bestNz = dz / d;
              hitX = (spheresA[sa].x + spheresB[sb].x) * 0.5;
              hitZ = (spheresA[sa].z + spheresB[sb].z) * 0.5;
            }
          }
        }
      }

      if (bestPush > 0) {
        const shareA = invMassA / invMassSum;
        const shareB = invMassB / invMassSum;

        a.x -= bestNx * bestPush * shareA;
        a.z -= bestNZ(bestNz, bestPush, shareA);
        b.x += bestNx * bestPush * shareB;
        b.z += bestNZ(bestNz, bestPush, shareB);

        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const velAlongNormal = rvx * bestNx + rvz * bestNz;

        if (velAlongNormal < 0) {
          const restitution = 0.42;
          const impulse = (-(1 + restitution) * velAlongNormal) / invMassSum;
          a.vx -= impulse * invMassA * bestNx;
          a.vz -= impulse * invMassA * bestNz;
          b.vx += impulse * invMassB * bestNx;
          b.vz += impulse * invMassB * bestNz;

          // Friction / deceleration on collision
          a.vx *= 0.92;
          a.vz *= 0.92;
          b.vx *= 0.92;
          b.vz *= 0.92;

          const impact = Math.abs(velAlongNormal);
          if (impact > maxImpact) maxImpact = impact;
          if (contactsOut && impact > 1.5) {
            contactsOut.push({
              x: hitX,
              y: Math.max(a.y, b.y) + 0.55,
              z: hitZ,
              intensity: impact,
            });
          }
        }
      }
    }
  }
  return maxImpact;
}

function bestNZ(nz: number, push: number, share: number): number {
  return nz * push * share;
}

/**
 * Sort racers and assign 1..N live race ranks.
 */
export function updateRaceStandings(vehicles: VehicleTelemetry[]): void {
  const sorted = [...vehicles].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.totalProgress - a.totalProgress;
  });

  for (let i = 0; i < sorted.length; i++) {
    sorted[i].rank = i + 1;
  }
}

export interface FixedChaseCameraPose {
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  chaseYaw: number;
}

/**
 * Fixed medium chase camera rig:
 * Smooths ONLY lateral yaw (`chaseYaw`) and computes camera position directly from
 * vehicle `(x, y, z)` at a locked 5.6m trailing radius and 2.2m height so high speed
 * or Nitro boost never causes longitudinal pullback.
 */
export function stepFixedChaseCamera(
  carX: number,
  carY: number,
  carZ: number,
  carYaw: number,
  prevChaseYaw: number,
  dt: number,
  out: FixedChaseCameraPose = {
    camX: 0,
    camY: 0,
    camZ: 0,
    lookX: 0,
    lookY: 0,
    lookZ: 0,
    chaseYaw: 0,
  },
): FixedChaseCameraPose {
  const dYaw = Math.atan2(Math.sin(carYaw - prevChaseYaw), Math.cos(carYaw - prevChaseYaw));
  const nextYaw = prevChaseYaw + dYaw * (1 - Math.exp(-10 * dt));
  const fwdX = -Math.sin(nextYaw);
  const fwdZ = -Math.cos(nextYaw);
  const fixedDist = 5.6;

  out.camX = carX - fwdX * fixedDist;
  out.camY = carY + 2.2;
  out.camZ = carZ - fwdZ * fixedDist;
  out.lookX = carX + fwdX * 6.5;
  out.lookY = carY + 0.85;
  out.lookZ = carZ + fwdZ * 6.5;
  out.chaseYaw = nextYaw;
  return out;
}

