import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Lightbulb, Volume2, Pause, Flame } from 'lucide-react';
import {
  CameraAngle,
  GameMode,
  Language,
  PairingTransport,
  SteeringControlMode,
  VehicleInput,
} from '../types/game';
import { HudTelemetrySnapshot } from './GameCanvas';
import { t } from '../i18n/translations';
import { soundEngine } from '../audio/soundEngine';

type TouchAction = 'left' | 'right' | 'gas' | 'brake' | 'drift' | 'nitro';

interface GameHudProps {
  lang: Language;
  mode: GameMode;
  isMultiplayer: boolean;
  transport: PairingTransport;
  pingMs: number;
  steeringMode: SteeringControlMode;
  cameraAngle: CameraAngle;
  hud: HudTelemetrySnapshot;
  touchInputRef: React.MutableRefObject<VehicleInput>;
  onToggleCamera: () => void;
  onToggleLights: () => void;
  onPause: () => void;
}

function formatTimeMs(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export const GameHud: React.FC<GameHudProps> = ({
  lang,
  mode,
  isMultiplayer,
  transport,
  pingMs,
  steeringMode,
  hud,
  touchInputRef,
  onToggleCamera,
  onToggleLights,
  onPause,
}) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const wheelPointerIdRef = useRef<number | null>(null);
  const activePointersRef = useRef<Map<number, TouchAction>>(new Map());
  const [pressedSet, setPressedSet] = useState<Set<TouchAction>>(() => new Set());

  const syncTouchActions = useCallback(() => {
    const map = activePointersRef.current;
    let left = false;
    let right = false;
    let gas = false;
    let brake = false;
    let drift = false;
    let nitro = false;
    const nextSet = new Set<TouchAction>();

    for (const action of map.values()) {
      nextSet.add(action);
      if (action === 'left') left = true;
      else if (action === 'right') right = true;
      else if (action === 'gas') gas = true;
      else if (action === 'brake') brake = true;
      else if (action === 'drift') drift = true;
      else if (action === 'nitro') nitro = true;
    }

    if (steeringMode === 'buttons') {
      touchInputRef.current.steer = (left ? 1 : 0) + (right ? -1 : 0);
    }
    touchInputRef.current.throttle = gas ? 1 : 0;
    touchInputRef.current.brake = brake ? 1 : 0;
    touchInputRef.current.handbrake = drift;
    touchInputRef.current.nitro = nitro;
    setPressedSet(nextSet);
  }, [steeringMode, touchInputRef]);

  // Clear all active touches on unmount or steering mode switch
  useEffect(() => {
    const pointers = activePointersRef.current;
    const touchRef = touchInputRef;
    return () => {
      pointers.clear();
      touchRef.current.throttle = 0;
      touchRef.current.brake = 0;
      touchRef.current.steer = 0;
      touchRef.current.handbrake = false;
      touchRef.current.nitro = false;
    };
  }, [steeringMode, touchInputRef]);

  const handleActionPointerDown = (
    action: TouchAction,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    soundEngine.unlock();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without pointer capture support
    }
    activePointersRef.current.set(e.pointerId, action);
    syncTouchActions();
  };

  const handleActionPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointersRef.current.delete(e.pointerId)) {
      syncTouchActions();
    }
  };

  // Gyroscope orientation listener when Steering Mode = 'gyro'
  useEffect(() => {
    if (steeringMode !== 'gyro') {
      return;
    }
    const onOrientation = (e: DeviceOrientationEvent) => {
      const screenAngle = window.screen?.orientation?.angle ?? 0;
      let rawTilt = 0;
      if (screenAngle === 90) {
        rawTilt = -(e.beta ?? 0);
      } else if (screenAngle === 270 || screenAngle === -90) {
        rawTilt = e.beta ?? 0;
      } else {
        rawTilt = -(e.gamma ?? 0);
      }
      // Deadzone 2.5 deg for steady straight-line driving; left tilt -> +1 steer
      const adjusted = Math.abs(rawTilt) < 2.5 ? 0 : rawTilt;
      const steer = Math.max(-1, Math.min(1, adjusted / 26));
      touchInputRef.current.steer = steer;
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      touchInputRef.current.steer = 0;
    };
  }, [steeringMode, touchInputRef]);

  // Minimap coordinate projector
  const renderMinimap = () => {
    const pts = hud.trackOutline;
    if (pts.length < 3) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const span = Math.max(1, Math.max(maxX - minX, maxZ - minZ));
    const mapCoord = (x: number, z: number) => ({
      mx: 10 + ((x - minX) / span) * 80,
      my: 10 + ((z - minZ) / span) * 80,
    });

    const pathD =
      pts
        .map((p, idx) => {
          const { mx, my } = mapCoord(p.x, p.z);
          return `${idx === 0 ? 'M' : 'L'}${mx.toFixed(1)},${my.toFixed(1)}`;
        })
        .join(' ') + ' Z';

    return (
      <svg
        width="104"
        height="104"
        viewBox="0 0 100 100"
        className="rounded-xl border border-white/15"
        style={{ background: 'rgba(9, 12, 18, 0.78)' }}
        aria-label="Track Minimap"
      >
        <path
          d={pathD}
          fill="none"
          stroke="rgba(148, 163, 184, 0.55)"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        {hud.minimapPoints.map((pt) => {
          const { mx, my } = mapCoord(pt.x, pt.z);
          return (
            <circle
              key={pt.id}
              cx={mx}
              cy={my}
              r={pt.isPlayer ? 4.4 : pt.isFriend ? 3.8 : 3.0}
              fill={pt.color}
              stroke="#090c12"
              strokeWidth="1.2"
            />
          );
        })}
      </svg>
    );
  };

  const rpmPct = Math.min(100, Math.round((hud.rpm / 8500) * 100));
  const nitroRadius = 29;
  const nitroCircumference = 2 * Math.PI * nitroRadius;
  const nitroDashOffset =
    nitroCircumference * (1 - Math.max(0, Math.min(100, hud.nitro)) / 100);
  const nitroDepleted = hud.nitro < 3;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-5 select-none">
      {/* Top Perimeter Row */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Left Cluster: Rank, Lap, Timer, Signal */}
        <div
          className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-white/15"
          style={{ background: 'rgba(9, 12, 18, 0.8)' }}
        >
          {mode === 'race' ? (
            <>
              <div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase">
                  {t(lang, 'rank')}
                </div>
                <div className="font-telemetry text-xl md:text-2xl font-bold text-amber-400 leading-none">
                  {hud.rank}
                  <span className="text-xs text-slate-400">/{hud.totalRacers}</span>
                </div>
              </div>
              <div className="w-px h-7 bg-white/10" />
              <div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase">
                  {t(lang, 'lap')}
                </div>
                <div className="font-telemetry text-xl md:text-2xl font-bold text-white leading-none">
                  {hud.lap}
                  <span className="text-xs text-slate-400">/{hud.totalLaps}</span>
                </div>
              </div>
              <div className="w-px h-7 bg-white/10" />
              <div className="font-telemetry text-sm md:text-base font-semibold text-slate-200">
                {formatTimeMs(hud.elapsedMs)}
              </div>
            </>
          ) : (
            <div className="text-xs md:text-sm font-bold text-cyan-400">
              {t(lang, 'openWorldActive')}
            </div>
          )}

          {isMultiplayer && (
            <>
              <div className="w-px h-7 bg-white/10" />
              <div className="font-telemetry text-xs text-emerald-400">
                {transport === 'internet' ? `${pingMs}ms` : 'BT'}
              </div>
            </>
          )}
        </div>

        {/* Top-Right Cluster: Minimap + Utility Action Icons */}
        <div className="flex items-start gap-2.5">
          {renderMinimap()}
          <div className="pointer-events-auto flex flex-col gap-1.5">
            <button
              type="button"
              tabIndex={-1}
              aria-label={t(lang, 'pause')}
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="w-10 h-10 rounded-xl border border-white/15 flex items-center justify-center text-white hover:border-amber-400 cursor-pointer"
              style={{ background: 'rgba(9, 12, 18, 0.82)' }}
            >
              <Pause className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={t(lang, 'camera')}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleCamera();
              }}
              className="w-10 h-10 rounded-xl border border-white/15 flex items-center justify-center text-white hover:border-cyan-400 cursor-pointer"
              style={{ background: 'rgba(9, 12, 18, 0.82)' }}
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={t(lang, 'lights')}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleLights();
              }}
              className={`w-10 h-10 rounded-xl border flex items-center justify-center cursor-pointer ${
                hud.headlightsOn
                  ? 'border-amber-400 text-amber-300'
                  : 'border-white/15 text-slate-300'
              }`}
              style={{ background: 'rgba(9, 12, 18, 0.82)' }}
            >
              <Lightbulb className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={t(lang, 'horn')}
              onClick={(e) => {
                e.currentTarget.blur();
                soundEngine.unlock();
                soundEngine.playHorn();
              }}
              className="w-10 h-10 rounded-xl border border-white/15 flex items-center justify-center text-slate-200 hover:border-amber-400 cursor-pointer"
              style={{ background: 'rgba(9, 12, 18, 0.82)' }}
            >
              <Volume2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Wrong-Way Warning Banner */}
      {hud.isWrongWay && hud.countdownSec <= 0 && (
        <div className="self-center mt-2">
          <div
            data-testid="wrong-way-banner"
            className="animate-pulse px-6 py-2.5 rounded-2xl border-2 border-red-500 text-red-200 font-display text-lg md:text-2xl font-extrabold tracking-wide shadow-lg"
            style={{ background: 'rgba(127, 29, 29, 0.9)' }}
          >
            ⚠️ {t(lang, 'wrongWay')}
          </div>
        </div>
      )}

      {/* Center Countdown Banner (Only during 3-2-1 countdown) */}
      {hud.countdownSec > 0 && (
        <div className="self-center my-auto">
          <div
            className="font-display text-6xl md:text-8xl font-bold text-amber-400 px-8 py-4 rounded-2xl border border-amber-400/40"
            style={{ background: 'rgba(9, 12, 18, 0.85)' }}
          >
            {hud.countdownSec}
          </div>
        </div>
      )}

      {/* Bottom Perimeter Row (dir=ltr ensures physical left=nitro+steering and right=pedals even in Arabic RTL) */}
      <div dir="ltr" className="flex items-end justify-between gap-3">
        {/* Left Side Column: Nitro Button ABOVE Steering Controls */}
        <div className="pointer-events-auto flex flex-col items-start gap-2.5 touch-none select-none">
          {/* Glowing Nitro Boost Button (Left side above steering for ergonomic left-thumb boost) */}
          <button
            type="button"
            data-testid="nitro-btn"
            aria-label={t(lang, 'nitro')}
            onPointerDown={(e) => handleActionPointerDown('nitro', e)}
            onPointerUp={handleActionPointerEnd}
            onPointerCancel={handleActionPointerEnd}
            className={`relative w-16 h-16 md:w-[70px] md:h-[70px] rounded-full flex flex-col items-center justify-center text-white font-extrabold cursor-pointer touch-none select-none transition-transform ${
              pressedSet.has('nitro') ? 'scale-92 ring-2 ring-amber-300' : ''
            } ${hud.isNitroActive ? 'animate-nitro-active' : ''} ${
              nitroDepleted ? 'opacity-45 grayscale' : ''
            }`}
            style={{
              background: hud.isNitroActive
                ? 'linear-gradient(135deg, #fb923c 0%, #ef4444 45%, #2563eb 100%)'
                : 'linear-gradient(135deg, rgba(249,115,22,0.92) 0%, rgba(37,99,235,0.92) 100%)',
              boxShadow: nitroDepleted
                ? 'none'
                : '0 0 18px rgba(249, 115, 22, 0.55), 0 0 26px rgba(56, 189, 248, 0.45)',
            }}
          >
            <svg
              className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
              viewBox="0 0 68 68"
            >
              <circle
                cx="34"
                cy="34"
                r={nitroRadius}
                fill="none"
                stroke="rgba(15, 23, 42, 0.65)"
                strokeWidth="4.5"
              />
              <circle
                cx="34"
                cy="34"
                r={nitroRadius}
                fill="none"
                stroke={hud.isNitroActive ? '#fde047' : '#38bdf8'}
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeDasharray={nitroCircumference}
                strokeDashoffset={nitroDashOffset}
              />
            </svg>
            <span className="text-lg leading-none z-10">🚀🔥</span>
            <span className="text-[9px] font-display tracking-wider uppercase mt-0.5 z-10">
              {t(lang, 'nitro')}
            </span>
          </button>

          {/* Left Steering Controls (Android Buttons / Touch Wheel / Gyro badge) */}
          <div className="flex items-center gap-2 touch-none select-none">
            {steeringMode === 'buttons' && (
              <>
                <button
                  type="button"
                  data-testid="steer-left"
                  aria-label={t(lang, 'left')}
                  onPointerDown={(e) => handleActionPointerDown('left', e)}
                  onPointerUp={handleActionPointerEnd}
                  onPointerCancel={handleActionPointerEnd}
                  className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl border font-bold text-xl cursor-pointer touch-none select-none transition-colors ${
                    pressedSet.has('left')
                      ? 'border-amber-400 bg-amber-500 text-slate-950'
                      : 'border-white/25 text-white'
                  }`}
                  style={
                    pressedSet.has('left')
                      ? undefined
                      : { background: 'rgba(9, 12, 18, 0.82)' }
                  }
                >
                  ◀
                </button>
                <button
                  type="button"
                  data-testid="steer-right"
                  aria-label={t(lang, 'right')}
                  onPointerDown={(e) => handleActionPointerDown('right', e)}
                  onPointerUp={handleActionPointerEnd}
                  onPointerCancel={handleActionPointerEnd}
                  className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl border font-bold text-xl cursor-pointer touch-none select-none transition-colors ${
                    pressedSet.has('right')
                      ? 'border-amber-400 bg-amber-500 text-slate-950'
                      : 'border-white/25 text-white'
                  }`}
                  style={
                    pressedSet.has('right')
                      ? undefined
                      : { background: 'rgba(9, 12, 18, 0.82)' }
                  }
                >
                  ▶
                </button>
              </>
            )}

            {steeringMode === 'wheel' && (
              <div
                ref={wheelRef}
                role="slider"
                aria-label="Steering Wheel"
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={0}
                onPointerDown={(e) => {
                  e.preventDefault();
                  soundEngine.unlock();
                  wheelPointerIdRef.current = e.pointerId;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // ignore
                  }
                }}
                onPointerMove={(e) => {
                  if (wheelPointerIdRef.current !== e.pointerId || !wheelRef.current) return;
                  const rect = wheelRef.current.getBoundingClientRect();
                  const cx = rect.left + rect.width / 2;
                  const cy = rect.top + rect.height / 2;
                  const angle = Math.atan2(e.clientX - cx, -(e.clientY - cy));
                  const norm = Math.max(-1, Math.min(1, -angle / 1.2));
                  touchInputRef.current.steer = norm;
                  wheelRef.current.style.transform = `rotate(${(-norm * 75).toFixed(0)}deg)`;
                }}
                onPointerUp={(e) => {
                  if (wheelPointerIdRef.current !== e.pointerId) return;
                  wheelPointerIdRef.current = null;
                  touchInputRef.current.steer = 0;
                  if (wheelRef.current) wheelRef.current.style.transform = 'rotate(0deg)';
                }}
                onPointerCancel={(e) => {
                  if (wheelPointerIdRef.current !== e.pointerId) return;
                  wheelPointerIdRef.current = null;
                  touchInputRef.current.steer = 0;
                  if (wheelRef.current) wheelRef.current.style.transform = 'rotate(0deg)';
                }}
                className="w-24 h-24 rounded-full border-4 border-amber-400/70 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none"
                style={{ background: 'rgba(9, 12, 18, 0.8)' }}
              >
                <div className="w-full h-1.5 bg-amber-400/80" />
              </div>
            )}

            {steeringMode === 'gyro' && (
              <div
                className="px-3 py-2 rounded-xl border border-cyan-400/40 text-xs font-semibold text-cyan-300"
                style={{ background: 'rgba(9, 12, 18, 0.8)' }}
              >
                {t(lang, 'ctrlGyro')}
              </div>
            )}
          </div>
        </div>

        {/* Center Compact Digital Speedometer / Gear / RPM / Nitro */}
        <div
          className="px-4 py-2.5 rounded-2xl border border-white/15 min-w-[180px] md:min-w-[230px]"
          style={{ background: 'rgba(9, 12, 18, 0.86)' }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span
                data-testid="hud-speed"
                className="font-telemetry text-3xl md:text-4xl font-bold text-white leading-none"
              >
                {hud.speedKmh}
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                {t(lang, 'kmh')}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {hud.isDrifting && (
                <span className="text-[11px] font-bold text-amber-400 uppercase">
                  {t(lang, 'drift')}
                </span>
              )}
              <span className="font-telemetry text-lg font-bold text-cyan-400">
                {hud.gear === 0 ? 'R' : `G${hud.gear}`}
              </span>
            </div>
          </div>

          {/* RPM Bar */}
          <div className="mt-1.5 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-75 ${
                rpmPct > 84 ? 'bg-red-500' : 'bg-amber-400'
              }`}
              style={{ width: `${rpmPct}%` }}
            />
          </div>

          {/* Nitro Bar */}
          <div className="mt-1.5 flex items-center gap-2">
            <Flame className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-75"
                style={{ width: `${hud.nitro}%` }}
              />
            </div>
            <span className="font-telemetry text-[10px] text-cyan-300">{hud.nitro}%</span>
          </div>
        </div>

        {/* Right Touch Pedals: Handbrake/Drift, Brake, Gas (Multi-touch enabled) */}
        <div className="pointer-events-auto flex items-end gap-2.5 touch-none select-none">
          <button
            type="button"
            data-testid="drift-btn"
            onPointerDown={(e) => handleActionPointerDown('drift', e)}
            onPointerUp={handleActionPointerEnd}
            onPointerCancel={handleActionPointerEnd}
            className={`px-3.5 py-2.5 rounded-xl border font-bold text-xs cursor-pointer touch-none select-none transition-colors ${
              pressedSet.has('drift')
                ? 'border-amber-300 bg-amber-400 text-slate-950'
                : 'border-amber-400/50 text-amber-300'
            }`}
            style={
              pressedSet.has('drift') ? undefined : { background: 'rgba(9, 12, 18, 0.84)' }
            }
          >
            {t(lang, 'drift')}
          </button>

          <button
            type="button"
            data-testid="brake-btn"
            onPointerDown={(e) => handleActionPointerDown('brake', e)}
            onPointerUp={handleActionPointerEnd}
            onPointerCancel={handleActionPointerEnd}
            className={`w-12 h-16 md:w-14 md:h-20 rounded-2xl border font-bold text-xs cursor-pointer touch-none select-none transition-colors ${
              pressedSet.has('brake')
                ? 'border-red-300 bg-red-500 text-white'
                : 'border-red-400/40 text-red-300'
            }`}
            style={
              pressedSet.has('brake') ? undefined : { background: 'rgba(9, 12, 18, 0.8)' }
            }
          >
            {t(lang, 'brake')}
          </button>

          <button
            type="button"
            data-testid="gas-btn"
            onPointerDown={(e) => handleActionPointerDown('gas', e)}
            onPointerUp={handleActionPointerEnd}
            onPointerCancel={handleActionPointerEnd}
            className={`w-14 h-20 md:w-16 md:h-24 rounded-2xl border font-bold text-xs cursor-pointer touch-none select-none transition-colors ${
              pressedSet.has('gas')
                ? 'border-emerald-300 bg-emerald-500 text-slate-950'
                : 'border-emerald-400/50 text-emerald-300'
            }`}
            style={
              pressedSet.has('gas') ? undefined : { background: 'rgba(9, 12, 18, 0.8)' }
            }
          >
            {t(lang, 'gas')}
          </button>
        </div>
      </div>
    </div>
  );
};
