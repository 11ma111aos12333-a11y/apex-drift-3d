import { TrackSpec, VehicleInput, VehicleTelemetry } from '../types/game';

/**
 * Compute AI racing or traffic driving input with spline lookahead,
 * corner deceleration, and lateral overtaking avoidance.
 */
export function computeAiDriverInput(
  ai: VehicleTelemetry,
  allVehicles: VehicleTelemetry[],
  track: TrackSpec,
  laneOffset: number,
  skillFactor = 0.92,
  isTraffic = false,
): VehicleInput {
  const wps = track.waypoints;
  const n = wps.length;
  if (n === 0) {
    return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  }

  // Find closest waypoint
  let nearestIdx = 0;
  let minD2 = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = wps[i].x - ai.x;
    const dz = wps[i].z - ai.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2) {
      minD2 = d2;
      nearestIdx = i;
    }
  }

  // Look ahead proportional to speed
  const lookSteps = isTraffic ? 2 : Math.max(2, Math.min(5, Math.floor(ai.speedMs / 18) + 2));
  const targetIdx = (nearestIdx + lookSteps) % n;
  const nextIdx = (targetIdx + 1) % n;
  const farIdx = (nearestIdx + lookSteps + 4) % n;

  const wp = wps[targetIdx];
  const wpNext = wps[nextIdx];

  // Tangent & right normal for lateral lane offset / overtaking
  const tx = wpNext.x - wp.x;
  const tz = wpNext.z - wp.z;
  const tLen = Math.hypot(tx, tz) || 1;
  const rx = -tz / tLen;
  const rz = tx / tLen;

  // Dynamic overtaking check: nudge laterally if another car is directly ahead
  let avoidOffset = laneOffset;
  for (let i = 0; i < allVehicles.length; i++) {
    const other = allVehicles[i];
    if (other.id === ai.id) continue;
    const dx = other.x - ai.x;
    const dz = other.z - ai.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 14 && dist > 0.1) {
      const fwdX = -Math.sin(ai.yaw);
      const fwdZ = -Math.cos(ai.yaw);
      const dotFwd = (dx * fwdX + dz * fwdZ) / dist;
      if (dotFwd > 0.65) {
        const rightX = Math.cos(ai.yaw);
        const rightZ = -Math.sin(ai.yaw);
        const side = dx * rightX + dz * rightZ;
        avoidOffset += side >= 0 ? -4.2 : 4.2;
      }
    }
  }

  const maxOffset = (track.roadWidth * 0.38);
  avoidOffset = Math.max(-maxOffset, Math.min(maxOffset, avoidOffset));

  const targetX = wp.x + rx * avoidOffset;
  const targetZ = wp.z + rz * avoidOffset;

  const toTargetX = targetX - ai.x;
  const toTargetZ = targetZ - ai.z;

  // Desired yaw (yaw=0 points toward -Z)
  const desiredYaw = Math.atan2(-toTargetX, -toTargetZ);
  let angleDiff = desiredYaw - ai.yaw;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const steer = Math.max(-1, Math.min(1, angleDiff * 1.9));

  // Corner curvature ahead -> brake smoothly before sharp turns
  const farWp = wps[farIdx];
  const farDirX = farWp.x - wp.x;
  const farDirZ = farWp.z - wp.z;
  const fLen = Math.hypot(farDirX, farDirZ) || 1;
  const cornerDot = (tx / tLen) * (farDirX / fLen) + (tz / tLen) * (farDirZ / fLen);

  let throttle = isTraffic ? 0.42 : skillFactor;
  let brake = 0;

  if (isTraffic) {
    // Traffic cruises steadily at ~65-85 km/h
    if (ai.speedKmh > 78) {
      throttle = 0;
      brake = 0.2;
    }
  } else {
    if (cornerDot < 0.72 && ai.speedMs > 34) {
      throttle = 0.25;
      brake = 0.55;
    } else if (Math.abs(angleDiff) > 0.75 && ai.speedMs > 26) {
      throttle = 0.35;
      brake = 0.45;
    }
  }

  const useNitro =
    !isTraffic &&
    ai.nitro > 45 &&
    cornerDot > 0.94 &&
    Math.abs(angleDiff) < 0.14 &&
    ai.speedMs > 25;

  return {
    throttle,
    brake,
    steer,
    handbrake: false,
    nitro: useNitro,
  };
}
