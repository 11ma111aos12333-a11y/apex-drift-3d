import React from 'react';
import { Trophy, RotateCcw, Home, Play, Volume2, VolumeX, Smartphone, Gauge } from 'lucide-react';
import {
  GraphicsQuality,
  Language,
  RaceResultEntry,
  SteeringControlMode,
} from '../types/game';
import { getCarById } from '../data/cars';
import { t } from '../i18n/translations';

interface PauseModalProps {
  lang: Language;
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  lang,
  onResume,
  onRestart,
  onExit,
}) => (
  <div className="fixed inset-0 z-20 flex items-center justify-center p-4" style={{ background: 'rgba(5, 7, 12, 0.72)' }}>
    <div
      className="w-full max-w-sm rounded-2xl border border-white/15 p-6 text-center space-y-4"
      style={{ background: 'rgba(9, 12, 18, 0.96)' }}
    >
      <h2 className="font-display text-2xl font-bold text-white">{t(lang, 'pause')}</h2>
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={onResume}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer"
        >
          <Play className="w-4 h-4 fill-slate-950" />
          <span>{t(lang, 'resume')}</span>
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>{t(lang, 'restart')}</span>
        </button>
        <button
          type="button"
          onClick={onExit}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-semibold text-sm cursor-pointer"
        >
          <Home className="w-4 h-4" />
          <span>{t(lang, 'exitToMenu')}</span>
        </button>
      </div>
    </div>
  </div>
);

interface ResultsModalProps {
  lang: Language;
  results: RaceResultEntry[];
  onPlayAgain: () => void;
  onExit: () => void;
}

export const ResultsModal: React.FC<ResultsModalProps> = ({
  lang,
  results,
  onPlayAgain,
  onExit,
}) => {
  const fmt = (ms: number) => {
    const s = Math.max(0, ms / 1000);
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(1).padStart(4, '0');
    return `${m}:${rem}`;
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-4" style={{ background: 'rgba(5, 7, 12, 0.78)' }}>
      <div
        className="w-full max-w-lg rounded-2xl border border-white/15 p-6 space-y-5"
        style={{ background: 'rgba(9, 12, 18, 0.96)' }}
      >
        <div className="flex items-center gap-3">
          <Trophy className="w-7 h-7 text-amber-400" />
          <div>
            <h2 className="font-display text-2xl font-bold text-white">{t(lang, 'raceFinished')}</h2>
            <p className="text-xs text-slate-400">{t(lang, 'podiumTitle')}</p>
          </div>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {results.map((r) => {
            const car = getCarById(r.carId);
            return (
              <div
                key={r.id}
                className={`flex items-center justify-between p-3 rounded-xl border ${
                  r.isPlayer
                    ? 'border-amber-400/60 bg-amber-500/15'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-telemetry text-base font-bold text-amber-400 w-6">
                    #{r.rank}
                  </span>
                  <div>
                    <div className="text-sm font-bold text-white">
                      {r.name} {r.isPlayer ? t(lang, 'youSuffix') : ''}
                    </div>
                    <div className="text-xs text-slate-400">
                      {lang === 'ar' ? car.nameAr : car.nameEn}
                    </div>
                  </div>
                </div>
                <span className="font-telemetry text-xs text-slate-200">
                  {fmt(r.finishTimeMs)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onPlayAgain}
            className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer"
          >
            {t(lang, 'playAgain')}
          </button>
          <button
            type="button"
            onClick={onExit}
            className="py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm cursor-pointer"
          >
            {t(lang, 'exitToMenu')}
          </button>
        </div>
      </div>
    </div>
  );
};

interface SettingsModalProps {
  lang: Language;
  steeringMode: SteeringControlMode;
  graphicsQuality: GraphicsQuality;
  muted: boolean;
  onChangeSteering: (mode: SteeringControlMode) => void;
  onChangeGraphicsQuality: (quality: GraphicsQuality) => void;
  onToggleMute: () => void;
  onToggleLang: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  lang,
  steeringMode,
  graphicsQuality,
  muted,
  onChangeSteering,
  onChangeGraphicsQuality,
  onToggleMute,
  onToggleLang,
  onClose,
}) => (
  <div className="fixed inset-0 z-30 flex items-center justify-center p-4" style={{ background: 'rgba(5, 7, 12, 0.78)' }}>
    <div
      className="w-full max-w-md rounded-2xl border border-white/15 p-6 space-y-5"
      style={{ background: 'rgba(9, 12, 18, 0.97)' }}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <h2 className="font-display text-xl font-bold text-white">{t(lang, 'settings')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 rounded-lg bg-white/10 text-xs text-slate-200 cursor-pointer"
        >
          {t(lang, 'back')}
        </button>
      </div>

      {/* Android Steering Method */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
          <Smartphone className="w-4 h-4 text-amber-400" />
          <span>{t(lang, 'controlMethod')}</span>
        </div>
        <div className="space-y-2">
          {(['buttons', 'wheel', 'gyro'] as SteeringControlMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChangeSteering(m)}
              className={`w-full text-start px-3.5 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                steeringMode === m
                  ? 'border-amber-400 bg-amber-500/15 text-white'
                  : 'border-white/10 bg-white/5 text-slate-300'
              }`}
            >
              {m === 'buttons'
                ? t(lang, 'ctrlButtons')
                : m === 'wheel'
                  ? t(lang, 'ctrlWheel')
                  : t(lang, 'ctrlGyro')}
            </button>
          ))}
        </div>
      </div>

      {/* Graphics Quality Preset */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
          <Gauge className="w-4 h-4 text-cyan-400" />
          <span>{t(lang, 'graphicsQuality')}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['low', 'medium', 'high'] as GraphicsQuality[]).map((q) => (
            <button
              key={q}
              type="button"
              data-testid={`quality-${q}`}
              onClick={() => onChangeGraphicsQuality(q)}
              className={`py-2 px-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                graphicsQuality === q
                  ? 'border-cyan-400 bg-cyan-500/20 text-white'
                  : 'border-white/10 bg-white/5 text-slate-300'
              }`}
            >
              {q === 'low'
                ? t(lang, 'qualityLow')
                : q === 'medium'
                  ? t(lang, 'qualityMedium')
                  : t(lang, 'qualityHigh')}
            </button>
          ))}
        </div>
      </div>

      {/* Sound & Language */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onToggleMute}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/15 bg-white/5 text-xs font-semibold text-white cursor-pointer"
        >
          {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          <span>{t(lang, 'soundEffects')}</span>
        </button>

        <button
          type="button"
          onClick={onToggleLang}
          className="py-2.5 rounded-xl border border-white/15 bg-white/5 text-xs font-semibold text-white cursor-pointer"
        >
          {t(lang, 'language')}: {lang === 'ar' ? 'العربية' : 'English'}
        </button>
      </div>
    </div>
  </div>
);
