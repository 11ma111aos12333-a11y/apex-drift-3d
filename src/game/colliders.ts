import {
  CollisionContact,
  GameMode,
  StaticCollider,
  TrackSpec,
  TrackWaypoint,
  VehicleTelemetry,
} from '../types/game';

export interface PlacedBuilding {
  x: number;
  z: number;
  radius: number;
  height: number;
  sides: number;
  neonColor: number;
}

export interface PlacedTree {
  x: number;
  z: number;
  y: number;
  scale: number;
  variant: 'palm' | 'pine' | 'urban';
}

export interface PlacedRock {
  x: number;
  z: number;
  y: number;
  sx: number;
  sy: number;
  rotY: number;
  isMesa: boolean;
}

export interface PlacedPole {
  x: number;
  z: number;
  yaw: number;
}

export interface PlacedGrandstand {
  x: number;
  z: number;
  yaw: number;
  length: number;
  depth: number;
}

export interface WorldLayout {
  buildings: PlacedBuilding[];
  trees: PlacedTree[];
  rocks: PlacedRock[];
  poles: PlacedPole[];
  grandstands: PlacedGrandstand[];
  fuelStation: { x: number; z: number } | null;
  colliders: StaticCollider[];
}

/**
 * Closest point & tangent on closed track polyline for accurate road-width & wall math.
 */
export function projectPointOntoTrack(
  x: number,
  z: number,
  waypoints: TrackWaypoint[],
): {
  closestX: number;
  closestZ: number;
  tangentX: number;
  tangentZ: number;
  normalX: number;
  normalZ: number;
  distFromCenter: number;
  roadHalfWidth: number;
  segIdx: number;
  segT: number;
} {
  const n = waypoints.length;
  if (n < 2) {
    return {
      closestX: x,
      closestZ: z,
      tangentX: 0,
      tangentZ: -1,
      normalX: 1,
      normalZ: 0,
      distFromCenter: 0,
      roadHalfWidth: 9,
      segIdx: 0,
      segT: 0,
    };
  }

  let bestDistSq = Infinity;
  let bestX = waypoints[0].x;
  let bestZ = waypoints[0].z;
  let bestTx = 0;
  let bestTz = -1;
  let bestIdx = 0;
  let bestT = 0;
  let bestWidth = waypoints[0].width;

  for (let i = 0; i < n; i++) {
    const a = waypoints[i];
    const b = waypoints[(i + 1) % n];
    const abX = b.x - a.x;
    const abZ = b.z - a.z;
    const abLenSq = abX * abX + abZ * abZ || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abX + (z - a.z) * abZ) / abLenSq));
    const px = a.x + abX * t;
    const pz = a.z + abZ * t;
    const dx = x - px;
    const dz = z - pz;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestX = px;
      bestZ = pz;
      const len = Math.sqrt(abLenSq);
      bestTx = abX / len;
      bestTz = abZ / len;
      bestIdx = i;
      bestT = t;
      bestWidth = a.width;
    }
  }

  const dx = x - bestX;
  const dz = z - bestZ;
  const dist = Math.sqrt(bestDistSq);
  // Right-hand normal relative to tangent (tx, tz)
  const rightX = -bestTz;
  const rightZ = bestTx;
  const sideSign = dx * rightX + dz * rightZ >= 0 ? 1 : -1;

  const normalX = dist > 0.0001 ? dx / dist : rightX * sideSign;
  const normalZ = dist > 0.0001 ? dz / dist : rightZ * sideSign;

  return {
    closestX: bestX,
    closestZ: bestZ,
    tangentX: bestTx,
    tangentZ: bestTz,
    normalX,
    normalZ,
    distFromCenter: dist,
    roadHalfWidth: bestWidth * 0.52,
    segIdx: bestIdx,
    segT: bestT,
  };
}

function terrainHeightOffRoad(
  x: number,
  z: number,
  distToRoad: number,
  halfRoad: number,
  envTheme: TrackSpec['envTheme'],
): number {
  if (distToRoad <= halfRoad + 4) return 0;
  const blend = Math.min(1, (distToRoad - halfRoad - 4) / 24);
  if (envTheme === 'desert') {
    const h =
      blend *
      (Math.sin(x * 0.032) * Math.cos(z * 0.032) * 2.8 +
        Math.sin(x * 0.016 + z * 0.022) * 1.9);
    return h < 0 ? h * 0.2 : h;
  }
  if (envTheme === 'coastal') {
    // Mountains rise more on the inland (-X) side
    const mountainBoost = x < 40 ? 1.85 : 0.65;
    const h =
      blend *
      mountainBoost *
      (Math.sin(x * 0.028) * Math.cos(z * 0.028) * 2.4 +
        Math.cos(x * 0.015 - z * 0.018) * 1.4);
    return h < 0 ? 0 : h;
  }
  return 0;
}

/**
 * Deterministic layout & solid physics colliders shared identically
 * between worldBuilder.ts (visuals) and physics.ts (collisions).
 */
export function generateWorldLayout(track: TrackSpec): WorldLayout {
  const buildings: PlacedBuilding[] = [];
  const trees: PlacedTree[] = [];
  const rocks: PlacedRock[] = [];
  const poles: PlacedPole[] = [];
  const grandstands: PlacedGrandstand[] = [];
  const colliders: StaticCollider[] = [];

  const theme = track.envTheme;

  // 1. Buildings / Skyscrapers (Night City, Coastal Town sector, Grand Prix Paddock)
  const neonPalette =
    theme === 'night-city'
      ? [0x06b6d4, 0xec4899, 0xf59e0b, 0x8b5cf6]
      : [0x06b6d4, 0xf59e0b, 0x38bdf8];

  const candidateTowers: Array<[number, number, number, number, number]> =
    theme === 'night-city'
      ? [
          [-30, -25, 10.5, 52, 8],
          [-32, -75, 11.5, 64, 6],
          [-28, -120, 10, 48, 8],
          [32, -45, 11, 56, 6],
          [34, -95, 10, 46, 8],
          [75, -80, 12, 60, 10],
          [75, -168, 11, 50, 8],
          [185, -100, 12, 54, 6],
          [190, 20, 11, 48, 8],
          [145, 72, 10.5, 44, 6],
          [55, 72, 11, 52, 8],
          [-30, 55, 9.5, 40, 8],
        ]
      : theme === 'coastal'
        ? [
            [-34, -36, 9.5, 34, 8],
            [-36, 36, 9, 28, 6],
            [32, -42, 9.5, 30, 8],
            [36, 32, 8.5, 26, 6],
          ]
        : theme === 'grand-prix'
          ? [
              [-46, -50, 11, 24, 8],
              [-46, -105, 11, 28, 6],
              [62, -45, 10, 22, 8],
            ]
          : [];

  candidateTowers.forEach(([tx, tz, rad, h, sides], idx) => {
    const proj = projectPointOntoTrack(tx, tz, track.waypoints);
    if (proj.distFromCenter > proj.roadHalfWidth + rad + 4) {
      buildings.push({
        x: tx,
        z: tz,
        radius: rad,
        height: h,
        sides,
        neonColor: neonPalette[idx % neonPalette.length],
      });
      colliders.push({
        id: `bldg-${idx}`,
        kind: 'building',
        x: tx,
        z: tz,
        radius: rad * 0.96,
        height: h,
        restitution: 0.35,
      });
    }
  });

  // 2. Fuel Station near start area (Night City & Coastal)
  let fuelStation: { x: number; z: number } | null = null;
  if (theme === 'night-city' || theme === 'coastal') {
    const fx = -23;
    const fz = 12;
    const fProj = projectPointOntoTrack(fx, fz, track.waypoints);
    if (fProj.distFromCenter > fProj.roadHalfWidth + 6.5) {
      fuelStation = { x: fx, z: fz };
      for (const px of [-4.2, 4.2]) {
        colliders.push({
          id: `fuel-pillar-${px}`,
          kind: 'fuel-pillar',
          x: fx + px,
          z: fz,
          radius: 0.75,
          height: 5,
          restitution: 0.3,
        });
      }
      for (const px of [-2, 2]) {
        colliders.push({
          id: `fuel-pump-${px}`,
          kind: 'fuel-pillar',
          x: fx + px,
          z: fz,
          radius: 0.68,
          height: 2.2,
          restitution: 0.3,
        });
      }
    }
  }

  // 3. Grandstands (Grand Prix Pro Circuit)
  if (theme === 'grand-prix') {
    const standSpecs: PlacedGrandstand[] = [
      { x: -24, z: -45, yaw: Math.PI * 0.5, length: 34, depth: 9 },
      { x: -24, z: -105, yaw: Math.PI * 0.5, length: 34, depth: 9 },
      { x: 24, z: -75, yaw: -Math.PI * 0.5, length: 36, depth: 9 },
      { x: 95, z: -222, yaw: 0, length: 32, depth: 9 },
    ];
    standSpecs.forEach((st, sIdx) => {
      const p = projectPointOntoTrack(st.x, st.z, track.waypoints);
      if (p.distFromCenter > p.roadHalfWidth + 6) {
        grandstands.push(st);
        // Represent rectangular grandstand footprint with 4 overlapping circular colliders
        const stepCount = 4;
        const fwdX = Math.sin(st.yaw);
        const fwdZ = Math.cos(st.yaw);
        const alongX = fwdZ;
        const alongZ = -fwdX;
        for (let k = 0; k < stepCount; k++) {
          const offset = ((k / (stepCount - 1)) - 0.5) * (st.length * 0.78);
          colliders.push({
            id: `stand-${sIdx}-${k}`,
            kind: 'grandstand',
            x: st.x + alongX * offset,
            z: st.z + alongZ * offset,
            radius: st.depth * 0.56,
            height: 11,
            restitution: 0.25,
          });
        }
      }
    });
  }

  // 4. Trees (theme-tailored: desert palms, coastal pines, or urban trees)
  const treeTarget = theme === 'night-city' ? 28 : 68;
  const treeVariant: PlacedTree['variant'] =
    theme === 'desert' ? 'palm' : theme === 'coastal' ? 'pine' : 'urban';

  let attempts = 0;
  while (trees.length < treeTarget && attempts < 900) {
    attempts++;
    const angle = attempts * 2.39996;
    const radius = 32 + (attempts % 24) * 11;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const proj = projectPointOntoTrack(x, z, track.waypoints);
    if (proj.distFromCenter < proj.roadHalfWidth + 4.2) continue;
    // Coastal bay water exclusion zone on east (+X) side
    if (theme === 'coastal' && x > 225 && z > -240 && z < 160) continue;
    // Avoid overlapping buildings or grandstands
    let blocked = false;
    for (let b = 0; b < buildings.length; b++) {
      if (Math.hypot(x - buildings[b].x, z - buildings[b].z) < buildings[b].radius + 4) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const sc = 0.88 + (trees.length % 5) * 0.12;
    const gy = terrainHeightOffRoad(x, z, proj.distFromCenter, proj.roadHalfWidth, theme);
    trees.push({ x, z, y: gy, scale: sc, variant: treeVariant });
    colliders.push({
      id: `tree-${trees.length}`,
      kind: 'tree',
      x,
      z,
      radius: 0.62 * sc,
      height: 5 * sc,
      restitution: 0.35,
    });
  }

  // 5. Rocks & Desert Red Canyon Mesas
  const rockTarget = theme === 'desert' ? 54 : theme === 'coastal' ? 32 : 0;
  for (let i = 0; i < 450 && rocks.length < rockTarget; i++) {
    const angle = i * 1.9 + 0.5;
    const radius = 44 + (i % 19) * 13;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const proj = projectPointOntoTrack(x, z, track.waypoints);
    if (proj.distFromCenter < proj.roadHalfWidth + 6.5) continue;
    if (theme === 'coastal' && x > 225 && z > -240 && z < 160) continue;

    const isMesa = theme === 'desert' && i % 4 === 0;
    const sx = isMesa ? 2.4 + (i % 3) * 0.9 : 0.9 + (i % 4) * 0.55;
    const sy = isMesa ? 2.2 + (i % 3) * 0.8 : 0.7 + (i % 3) * 0.45;
    const gy = terrainHeightOffRoad(x, z, proj.distFromCenter, proj.roadHalfWidth, theme);
    rocks.push({ x, z, y: gy, sx, sy, rotY: i * 0.7, isMesa });
    colliders.push({
      id: `rock-${rocks.length}`,
      kind: 'rock',
      x,
      z,
      radius: (isMesa ? 3.2 : 2.1) * (sx * 0.45),
      height: 3.5 * sy,
      restitution: 0.3,
    });
  }

  // 6. Roadside Streetlights / Track Light Towers
  const wps = track.waypoints;
  const lampInterval = theme === 'night-city' ? 3 : 5;
  for (let i = 0; i < wps.length; i += lampInterval) {
    const curr = wps[i];
    const next = wps[(i + 1) % wps.length];
    const tx = next.x - curr.x;
    const tz = next.z - curr.z;
    const len = Math.hypot(tx, tz) || 1;
    const rx = -tz / len;
    const rz = tx / len;
    const side = (i / lampInterval) % 2 === 0 ? 1 : -1;
    const offset = (curr.width * 0.52 + 1.55) * side;
    const px = curr.x + rx * offset;
    const pz = curr.z + rz * offset;
    const yaw = Math.atan2(-rx * side, -rz * side);
    poles.push({ x: px, z: pz, yaw });
    colliders.push({
      id: `pole-${i}`,
      kind: 'pole',
      x: px,
      z: pz,
      radius: 0.42,
      height: 6.4,
      restitution: 0.35,
    });
  }

  return {
    buildings,
    trees,
    rocks,
    poles,
    grandstands,
    fuelStation,
    colliders,
  };
}

/**
 * Resolve solid capsule (front + rear circle) collisions against all static world obstacles
 * (buildings, trees, rocks, streetlights, grandstands, fuel station pillars).
 */
export function resolveStaticWorldCollisions(
  v: VehicleTelemetry,
  colliders: StaticCollider[],
  wheelBase = 2.65,
  carHalfWidth = 1.05,
): CollisionContact | null {
  const fwdX = -Math.sin(v.yaw);
  const fwdZ = -Math.cos(v.yaw);
  const offset = wheelBase * 0.34;

  // Test two proxy circles covering front and rear of vehicle chassis
  const bodyCircles = [
    { cx: v.x + fwdX * offset, cz: v.z + fwdZ * offset },
    { cx: v.x - fwdX * offset, cz: v.z - fwdZ * offset },
  ];

  let strongestContact: CollisionContact | null = null;

  for (let c = 0; c < colliders.length; c++) {
    const col = colliders[c];
    if (v.y > col.height + 0.8) continue;

    const minDist = col.radius + carHalfWidth;
    const minDistSq = minDist * minDist;

    for (let k = 0; k < 2; k++) {
      const bx = bodyCircles[k].cx + (v.x - (bodyCircles[0].cx + bodyCircles[1].cx) * 0.5);
      const bz = bodyCircles[k].cz + (v.z - (bodyCircles[0].cz + bodyCircles[1].cz) * 0.5);
      const dx = bx - col.x;
      const dz = bz - col.z;
      const dSq = dx * dx + dz * dz;

      if (dSq < minDistSq) {
        const d = Math.sqrt(dSq);
        const nx = d > 0.0001 ? dx / d : fwdX;
        const nz = d > 0.0001 ? dz / d : fwdZ;
        const push = minDist - d;

        v.x += nx * push;
        v.z += nz * push;
        // Shift both body circles so second circle stays synchronized
        bodyCircles[0].cx += nx * push;
        bodyCircles[0].cz += nz * push;
        bodyCircles[1].cx += nx * push;
        bodyCircles[1].cz += nz * push;

        // Velocity reflection + tangential sliding along obstacle
        const vn = v.vx * nx + v.vz * nz;
        if (vn < 0) {
          const impact = Math.abs(vn);
          v.vx -= (1 + col.restitution) * vn * nx;
          v.vz -= (1 + col.restitution) * vn * nz;
          // Mild scrape friction along surface
          v.vx *= 0.88;
          v.vz *= 0.88;
          if (!strongestContact || impact > strongestContact.intensity) {
            strongestContact = {
              x: col.x + nx * col.radius,
              y: v.y + 0.55,
              z: col.z + nz * col.radius,
              intensity: impact,
            };
          }
        }
      }
    }
  }

  return strongestContact;
}

/**
 * Strict continuous guardrail containment for Race Mode.
 * Prevents any vehicle from leaving the closed track boundaries at any speed.
 */
export function enforceRaceTrackWalls(
  v: VehicleTelemetry,
  track: TrackSpec,
  carHalfWidth = 1.05,
): CollisionContact | null {
  const proj = projectPointOntoTrack(v.x, v.z, track.waypoints);
  const maxOffset = Math.max(2.5, proj.roadHalfWidth - carHalfWidth);

  if (proj.distFromCenter <= maxOffset) {
    return null;
  }

  // Clamp car strictly back inside continuous track barrier
  v.x = proj.closestX + proj.normalX * maxOffset;
  v.z = proj.closestZ + proj.normalZ * maxOffset;

  // Reflect outward velocity component while allowing clean barrier sliding
  const velOut = v.vx * proj.normalX + v.vz * proj.normalZ;
  if (velOut > 0) {
    const restitution = 0.22;
    v.vx -= (1 + restitution) * velOut * proj.normalX;
    v.vz -= (1 + restitution) * velOut * proj.normalZ;
    // Gentle barrier scrub
    v.vx *= 0.94;
    v.vz *= 0.94;
    return {
      x: proj.closestX + proj.normalX * proj.roadHalfWidth,
      y: v.y + 0.5,
      z: proj.closestZ + proj.normalZ * proj.roadHalfWidth,
      intensity: velOut,
    };
  }

  return null;
}

/**
 * Sequential checkpoint validation, wrong-way warning, and auto-respawn
 * onto the last valid checkpoint when stuck/reversed/out-of-bounds in Race Mode.
 */
export function updateCheckpointsAndRecovery(
  v: VehicleTelemetry,
  track: TrackSpec,
  mode: GameMode,
  dt: number,
  raceElapsedMs: number,
  totalLaps: number,
): void {
  const n = track.waypoints.length;
  if (n < 4) return;

  const checkpointCount = 8;
  if (v.nextCheckpointIdx === undefined) v.nextCheckpointIdx = 1;
  if (v.lastValidCheckpointIdx === undefined) v.lastValidCheckpointIdx = 0;
  if (v.wrongWayTimer === undefined) v.wrongWayTimer = 0;
  if (v.outOfBoundsTimer === undefined) v.outOfBoundsTimer = 0;

  const proj = projectPointOntoTrack(v.x, v.z, track.waypoints);
  const progress = (proj.segIdx + proj.segT) / n;
  v.lapProgress = progress;

  // Advance sequential checkpoints (0 -> 1 -> 2 -> ... -> 7 -> 0)
  const expectedCp = v.nextCheckpointIdx % checkpointCount;
  const cpWpIdx = Math.floor((expectedCp / checkpointCount) * n) % n;
  const cpWp = track.waypoints[cpWpIdx];
  const distToCp = Math.hypot(v.x - cpWp.x, v.z - cpWp.z);
  const checkpointTriggerRadius = Math.max(22, track.roadWidth * 1.35);

  if (distToCp < checkpointTriggerRadius) {
    v.lastValidCheckpointIdx = expectedCp;
    v.nextCheckpointIdx = (expectedCp + 1) % checkpointCount;

    // Crossing checkpoint 0 after passing checkpoint 7 completes a genuine lap!
    if (expectedCp === 0 && !v.finished && mode === 'race') {
      v.lap += 1;
      const lapDuration = raceElapsedMs - v.lastLapStartMs;
      if (lapDuration > 4000 && (v.bestLapMs === 0 || lapDuration < v.bestLapMs)) {
        v.bestLapMs = lapDuration;
      }
      v.lastLapStartMs = raceElapsedMs;
      if (totalLaps > 0 && v.lap > totalLaps) {
        v.finished = true;
        v.finishTimeMs = raceElapsedMs;
      }
    }
  }

  // Smooth continuous progress within current lap (respecting sequential checkpoint progress)
  if (!v.finished) {
    const completedCheckpoints =
      v.nextCheckpointIdx === 0 ? checkpointCount : Math.max(0, v.nextCheckpointIdx - 1);
    const minLapFrac = completedCheckpoints / checkpointCount;
    // Prevent bogus 0.99 progress right behind start line before clearing checkpoint 1
    const effectiveProgress =
      completedCheckpoints <= 1 && progress > 0.7 ? progress - 1.0 : progress;
    v.totalProgress = Math.max((v.lap - 1) + minLapFrac * 0.5, (v.lap - 1) + effectiveProgress);
  } else {
    v.totalProgress = totalLaps + 1;
  }

  // Wrong-way & out-of-bounds recovery (Race Mode)
  if (mode !== 'race' || v.finished) {
    v.isWrongWay = false;
    v.wrongWayTimer = 0;
    v.outOfBoundsTimer = 0;
    return;
  }

  const fwdX = -Math.sin(v.yaw);
  const fwdZ = -Math.cos(v.yaw);
  const headingDot = fwdX * proj.tangentX + fwdZ * proj.tangentZ;
  const velDot =
    v.speedMs > 3.0 ? (v.vx * proj.tangentX + v.vz * proj.tangentZ) / v.speedMs : headingDot;

  if (headingDot < -0.45 && (velDot < -0.35 || v.speedMs > 4.0)) {
    v.wrongWayTimer += dt;
  } else {
    v.wrongWayTimer = Math.max(0, v.wrongWayTimer - dt * 2.0);
  }
  v.isWrongWay = v.wrongWayTimer > 0.45;

  if (proj.distFromCenter > proj.roadHalfWidth + 3.5) {
    v.outOfBoundsTimer += dt;
  } else {
    v.outOfBoundsTimer = 0;
  }

  // Auto-respawn onto last valid checkpoint if out-of-bounds or persistently driving wrong way
  if (v.outOfBoundsTimer > 1.4 || v.wrongWayTimer > 3.6) {
    const resetWpIdx = Math.floor(((v.lastValidCheckpointIdx ?? 0) / checkpointCount) * n) % n;
    const wp = track.waypoints[resetWpIdx];
    const nextWp = track.waypoints[(resetWpIdx + 1) % n];
    const resetYaw = Math.atan2(-(nextWp.x - wp.x), -(nextWp.z - wp.z));
    v.x = wp.x;
    v.y = wp.y + 0.15;
    v.z = wp.z;
    v.vx = 0;
    v.vy = 0;
    v.vz = 0;
    v.speedMs = 0;
    v.speedKmh = 0;
    v.yaw = resetYaw;
    v.pitch = 0;
    v.roll = 0;
    v.isWrongWay = false;
    v.wrongWayTimer = 0;
    v.outOfBoundsTimer = 0;
  }
}
