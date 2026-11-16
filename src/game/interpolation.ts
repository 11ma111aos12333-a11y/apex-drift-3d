import { RemoteMotionPacket } from '../types/game';

export interface InterpolatedPose {
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

interface BufferedSnapshot {
  receivedAtMs: number;
  packet: RemoteMotionPacket;
}

/**
 * Maintains a small jitter-buffer of remote motion packets and produces
 * smoothly interpolated + lightly extrapolated poses for remote multiplayer vehicles.
 */
export class RemoteCarInterpolator {
  private buffers = new Map<string, BufferedSnapshot[]>();
  private readonly interpDelayMs = 65;

  pushPacket(packet: RemoteMotionPacket, nowMs: number): void {
    let list = this.buffers.get(packet.id);
    if (!list) {
      list = [];
      this.buffers.set(packet.id, list);
    }

    // Ignore out-of-order stale sequence numbers
    if (list.length > 0 && packet.seq <= list[list.length - 1].packet.seq) {
      return;
    }

    list.push({ receivedAtMs: nowMs, packet });
    if (list.length > 16) {
      list.shift();
    }
  }

  removePlayer(id: string): void {
    this.buffers.delete(id);
  }

  clear(): void {
    this.buffers.clear();
  }

  sample(id: string, nowMs: number): InterpolatedPose | null {
    const list = this.buffers.get(id);
    if (!list || list.length === 0) return null;

    const renderTime = nowMs - this.interpDelayMs;

    // Single packet or before first packet: extrapolate lightly from velocity
    if (list.length === 1 || renderTime <= list[0].receivedAtMs) {
      const latest = list[list.length - 1];
      const dtSec = Math.min(0.25, Math.max(0, (nowMs - latest.receivedAtMs) / 1000));
      const p = latest.packet;
      return {
        x: p.x + p.vx * dtSec,
        y: p.y + p.vy * dtSec,
        z: p.z + p.vz * dtSec,
        qx: p.qx,
        qy: p.qy,
        qz: p.qz,
        qw: p.qw,
        vx: p.vx,
        vy: p.vy,
        vz: p.vz,
        steer: p.steer,
        wheelRpm: p.wheelRpm,
        nitro: p.nitro,
        braking: p.braking,
        drifting: p.drifting,
        lap: p.lap,
        lapProgress: p.lapProgress,
        finished: p.finished,
        finishTimeMs: p.finishTimeMs,
      };
    }

    // Latest packet is older than renderTime -> bounded dead-reckoning extrapolation
    const last = list[list.length - 1];
    if (renderTime >= last.receivedAtMs) {
      const dtSec = Math.min(0.25, (renderTime - last.receivedAtMs) / 1000);
      const p = last.packet;
      return {
        x: p.x + p.vx * dtSec,
        y: p.y + p.vy * dtSec,
        z: p.z + p.vz * dtSec,
        qx: p.qx,
        qy: p.qy,
        qz: p.qz,
        qw: p.qw,
        vx: p.vx,
        vy: p.vy,
        vz: p.vz,
        steer: p.steer,
        wheelRpm: p.wheelRpm,
        nitro: p.nitro,
        braking: p.braking,
        drifting: p.drifting,
        lap: p.lap,
        lapProgress: p.lapProgress,
        finished: p.finished,
        finishTimeMs: p.finishTimeMs,
      };
    }

    // Find bracket [a, b] around renderTime
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (renderTime >= a.receivedAtMs && renderTime <= b.receivedAtMs) {
        const span = Math.max(1, b.receivedAtMs - a.receivedAtMs);
        const alpha = Math.max(0, Math.min(1, (renderTime - a.receivedAtMs) / span));
        const pa = a.packet;
        const pb = b.packet;

        const q = slerpQuat(
          pa.qx,
          pa.qy,
          pa.qz,
          pa.qw,
          pb.qx,
          pb.qy,
          pb.qz,
          pb.qw,
          alpha,
        );

        return {
          x: pa.x + (pb.x - pa.x) * alpha,
          y: pa.y + (pb.y - pa.y) * alpha,
          z: pa.z + (pb.z - pa.z) * alpha,
          qx: q[0],
          qy: q[1],
          qz: q[2],
          qw: q[3],
          vx: pa.vx + (pb.vx - pa.vx) * alpha,
          vy: pa.vy + (pb.vy - pa.vy) * alpha,
          vz: pa.vz + (pb.vz - pa.vz) * alpha,
          steer: pa.steer + (pb.steer - pa.steer) * alpha,
          wheelRpm: pa.wheelRpm + (pb.wheelRpm - pa.wheelRpm) * alpha,
          nitro: pb.nitro,
          braking: pb.braking,
          drifting: pb.drifting,
          lap: pb.lap,
          lapProgress: pb.lapProgress,
          finished: pb.finished,
          finishTimeMs: pb.finishTimeMs,
        };
      }
    }

    const p = last.packet;
    return { ...p };
  }
}

export function slerpQuat(
  ax: number,
  ay: number,
  az: number,
  aw: number,
  bx: number,
  by: number,
  bz: number,
  bw: number,
  t: number,
): [number, number, number, number] {
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  let tx = bx;
  let ty = by;
  let tz = bz;
  let tw = bw;

  if (dot < 0) {
    dot = -dot;
    tx = -tx;
    ty = -ty;
    tz = -tz;
    tw = -tw;
  }

  if (dot > 0.9995) {
    const rx = ax + (tx - ax) * t;
    const ry = ay + (ty - ay) * t;
    const rz = az + (tz - az) * t;
    const rw = aw + (tw - aw) * t;
    const len = Math.hypot(rx, ry, rz, rw) || 1;
    return [rx / len, ry / len, rz / len, rw / len];
  }

  const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);

  const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return [
    s0 * ax + s1 * tx,
    s0 * ay + s1 * ty,
    s0 * az + s1 * tz,
    s0 * aw + s1 * tw,
  ];
}
