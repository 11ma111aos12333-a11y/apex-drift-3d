import React, { useState } from 'react';
import { ArrowLeft, Compass, Flag, Cpu, Users, Wifi, Bluetooth, Play } from 'lucide-react';
import { TRACKS } from '../data/tracks';
import { GameMode, Language, PairingTransport, RaceOpponentMode } from '../types/game';
import { t } from '../i18n/translations';

interface ModeSelectScreenProps {
  lang: Language;
  initialMode?: GameMode;
  trackId: string;
  laps: number;
  aiCount: number;
  trafficEnabled: boolean;
  onChangeTrack: (id: string) => void;
  onChangeLaps: (laps: number) => void;
  onChangeAiCount: (count: number) => void;
  onToggleTraffic: (enabled: boolean) => void;
  onStartLocal: (mode: GameMode, opponentMode: RaceOpponentMode) => void;
  onOpenPairing: (mode: GameMode, transport: PairingTransport) => void;
  onBack: () => void;
}

export const ModeSelectScreen: React.FC<ModeSelectScreenProps> = ({
  lang,
  initialMode = 'race',
  trackId,
  laps,
  aiCount,
  trafficEnabled,
  onChangeTrack,
  onChangeLaps,
  onChangeAiCount,
  onToggleTraffic,
  onStartLocal,
  onOpenPairing,
  onBack,
}) => {
  const [selectedMode, setSelectedMode] = useState<GameMode>(initialMode);
  const [raceSubMode, setRaceSubMode] = useState<RaceOpponentMode>('ai');
  const [openWorldFriends, setOpenWorldFriends] = useState(false);

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center p-4 md:p-8 overflow-y-auto">
      <div
        className="w-full max-w-4xl rounded-2xl border border-white/15 p-5 md:p-7"
        style={{ background: 'rgba(9, 12, 18, 0.94)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label={t(lang, 'back')}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="font-display text-xl md:text-2xl font-bold text-white">
              {t(lang, 'chooseMode')}
            </h2>
          </div>
        </div>

        {/* Step 1: Primary Mode Switch (Open World vs Race Mode) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setSelectedMode('open-world')}
            className={`text-start p-4 rounded-xl border transition-colors cursor-pointer ${
              selectedMode === 'open-world'
                ? 'border-cyan-400 bg-cyan-500/10'
                : 'border-white/10 bg-white/5 hover:border-white/25'
            }`}
          >
            <div className="flex items-center gap-2.5 mb-1.5">
              <Compass className="w-5 h-5 text-cyan-400" />
              <span className="font-display text-lg font-bold text-white">
                {t(lang, 'openWorld')}
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {t(lang, 'openWorldDesc')}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSelectedMode('race')}
            className={`text-start p-4 rounded-xl border transition-colors cursor-pointer ${
              selectedMode === 'race'
                ? 'border-amber-400 bg-amber-500/10'
                : 'border-white/10 bg-white/5 hover:border-white/25'
            }`}
          >
            <div className="flex items-center gap-2.5 mb-1.5">
              <Flag className="w-5 h-5 text-amber-400" />
              <span className="font-display text-lg font-bold text-white">
                {t(lang, 'raceMode')}
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {t(lang, 'raceModeDesc')}
            </p>
          </button>
        </div>

        {/* Track Selector (shared cleanly) */}
        <div className="mb-6">
          <div className="text-xs font-semibold text-slate-300 mb-2">
            {t(lang, 'selectTrack')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {TRACKS.map((trk) => {
              const active = trk.id === trackId;
              return (
                <button
                  key={trk.id}
                  type="button"
                  data-testid={`track-card-${trk.id}`}
                  onClick={() => onChangeTrack(trk.id)}
                  className={`text-start p-3 rounded-xl border cursor-pointer transition-colors ${
                    active
                      ? 'border-amber-400 bg-amber-500/15'
                      : 'border-white/10 bg-white/5 hover:border-white/25'
                  }`}
                >
                  <div className="text-sm font-bold text-white">
                    {lang === 'ar' ? trk.nameAr : trk.nameEn}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 uppercase">
                    {trk.envTheme} · {trk.ramps.length} Ramps
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mode-Specific Configuration */}
        {selectedMode === 'open-world' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-white/10 bg-white/5">
              <div>
                <div className="text-sm font-bold text-white">{t(lang, 'trafficAi')}</div>
                <div className="text-xs text-slate-400">
                  {trafficEnabled ? t(lang, 'enabled') : t(lang, 'disabled')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onToggleTraffic(!trafficEnabled)}
                className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  trafficEnabled
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300 border border-white/15'
                }`}
              >
                {trafficEnabled ? t(lang, 'enabled') : t(lang, 'disabled')}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setOpenWorldFriends(false)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                  !openWorldFriends
                    ? 'border-cyan-400 bg-cyan-500/15 text-white'
                    : 'border-white/10 text-slate-300'
                }`}
              >
                {t(lang, 'soloDrive')}
              </button>
              <button
                type="button"
                onClick={() => setOpenWorldFriends(true)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                  openWorldFriends
                    ? 'border-cyan-400 bg-cyan-500/15 text-white'
                    : 'border-white/10 text-slate-300'
                }`}
              >
                {t(lang, 'multiplayerDrive')}
              </button>
            </div>

            {!openWorldFriends ? (
              <button
                type="button"
                onClick={() => onStartLocal('open-world', 'ai')}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-base font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-slate-950" />
                <span>{t(lang, 'enterOpenWorld')}</span>
              </button>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onOpenPairing('open-world', 'internet')}
                  className="flex items-center gap-3 p-4 rounded-xl border border-cyan-400/50 bg-cyan-500/10 hover:bg-cyan-500/20 text-start cursor-pointer"
                >
                  <Wifi className="w-6 h-6 text-cyan-400 shrink-0" />
                  <div>
                    <div className="text-sm font-bold text-white">{t(lang, 'internetPairing')}</div>
                    <div className="text-xs text-slate-300">{t(lang, 'internetPairingDesc')}</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPairing('open-world', 'bluetooth')}
                  className="flex items-center gap-3 p-4 rounded-xl border border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 text-start cursor-pointer"
                >
                  <Bluetooth className="w-6 h-6 text-amber-400 shrink-0" />
                  <div>
                    <div className="text-sm font-bold text-white">{t(lang, 'bluetoothPairing')}</div>
                    <div className="text-xs text-slate-300">{t(lang, 'bluetoothPairingDesc')}</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Race Sub-Choice: (A) VS Computer OR (B) VS Friends */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRaceSubMode('ai')}
                className={`text-start p-4 rounded-xl border cursor-pointer ${
                  raceSubMode === 'ai'
                    ? 'border-amber-400 bg-amber-500/15'
                    : 'border-white/10 bg-white/5 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-bold text-white">{t(lang, 'vsComputer')}</span>
                </div>
                <p className="text-xs text-slate-300">{t(lang, 'vsComputerDesc')}</p>
              </button>

              <button
                type="button"
                onClick={() => setRaceSubMode('friends')}
                className={`text-start p-4 rounded-xl border cursor-pointer ${
                  raceSubMode === 'friends'
                    ? 'border-cyan-400 bg-cyan-500/15'
                    : 'border-white/10 bg-white/5 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-bold text-white">{t(lang, 'vsFriends')}</span>
                </div>
                <p className="text-xs text-slate-300">{t(lang, 'vsFriendsDesc')}</p>
              </button>
            </div>

            {raceSubMode === 'ai' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl border border-white/10 bg-white/5">
                    <div className="flex justify-between text-xs font-semibold text-slate-300 mb-2">
                      <span>{t(lang, 'racersCount')}</span>
                      <span className="font-telemetry text-amber-400">{aiCount}</span>
                    </div>
                    <div className="flex gap-1.5">
                      {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => onChangeAiCount(n)}
                          className={`flex-1 py-1.5 rounded-lg font-telemetry text-xs font-bold cursor-pointer ${
                            aiCount === n
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-white/10 bg-white/5">
                    <div className="flex justify-between text-xs font-semibold text-slate-300 mb-2">
                      <span>{t(lang, 'lapsCount')}</span>
                      <span className="font-telemetry text-amber-400">{laps}</span>
                    </div>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => onChangeLaps(l)}
                          className={`flex-1 py-1.5 rounded-lg font-telemetry text-xs font-bold cursor-pointer ${
                            laps === l
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onStartLocal('race', 'ai')}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-base font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 cursor-pointer"
                >
                  <Play className="w-5 h-5 fill-slate-950" />
                  <span>{t(lang, 'startRace')}</span>
                </button>
              </div>
            ) : (
              <div>
                <div className="text-xs font-semibold text-slate-300 mb-2">
                  {t(lang, 'selectPairing')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenPairing('race', 'internet')}
                    className="flex items-center gap-3 p-4 rounded-xl border border-cyan-400/50 bg-cyan-500/10 hover:bg-cyan-500/20 text-start cursor-pointer"
                  >
                    <Wifi className="w-6 h-6 text-cyan-400 shrink-0" />
                    <div>
                      <div className="text-sm font-bold text-white">{t(lang, 'internetPairing')}</div>
                      <div className="text-xs text-slate-300">{t(lang, 'internetPairingDesc')}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPairing('race', 'bluetooth')}
                    className="flex items-center gap-3 p-4 rounded-xl border border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 text-start cursor-pointer"
                  >
                    <Bluetooth className="w-6 h-6 text-amber-400 shrink-0" />
                    <div>
                      <div className="text-sm font-bold text-white">{t(lang, 'bluetoothPairing')}</div>
                      <div className="text-xs text-slate-300">{t(lang, 'bluetoothPairingDesc')}</div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
