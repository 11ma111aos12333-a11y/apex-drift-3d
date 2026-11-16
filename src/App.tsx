import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraAngle,
  CarCustomization,
  GameMode,
  GraphicsQuality,
  Language,
  LobbyRoomState,
  PairingTransport,
  RaceOpponentMode,
  RaceResultEntry,
  ScreenState,
  SteeringControlMode,
  VehicleInput,
} from './types/game';
import { CARS, getCarById } from './data/cars';
import { GameCanvas, HudTelemetrySnapshot, SessionConfig } from './components/GameCanvas';
import { TitleScreen } from './components/TitleScreen';
import { GarageScreen } from './components/GarageScreen';
import { ModeSelectScreen } from './components/ModeSelectScreen';
import { PairingLobby } from './components/PairingLobby';
import { GameHud } from './components/GameHud';
import { PauseModal, ResultsModal, SettingsModal } from './components/GameModals';
import { soundEngine } from './audio/soundEngine';
import { networkManager } from './network/networkManager';

const INITIAL_HUD: HudTelemetrySnapshot = {
  speedKmh: 0,
  rpm: 1100,
  gear: 1,
  nitro: 100,
  isDrifting: false,
  isNitroActive: false,
  lap: 1,
  totalLaps: 2,
  rank: 1,
  totalRacers: 1,
  countdownSec: -1,
  elapsedMs: 0,
  headlightsOn: true,
  isWrongWay: false,
  minimapPoints: [],
  trackOutline: [],
};

const CUSTOMS_STORAGE_KEY = 'apex_drift_customs_v1';
const SELECTED_CAR_STORAGE_KEY = 'apex_drift_selected_car_v1';
const QUALITY_STORAGE_KEY = 'apex_drift_quality_v1';

function defaultCustomFor(carId: string): CarCustomization {
  const car = getCarById(carId);
  return {
    paintColor: car.defaultPaint,
    rimColor: car.defaultRim,
    underglowColor: car.defaultUnderglow,
    windowTint: 0.48,
  };
}

function loadSavedCustoms(): Record<string, CarCustomization> {
  try {
    const raw = window.localStorage.getItem(CUSTOMS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default function App() {
  const isAutostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [lang, setLang] = useState<Language>('ar');
  const [screen, setScreen] = useState<ScreenState>(isAutostart ? 'playing' : 'title');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [selectedCarId, setSelectedCarId] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(SELECTED_CAR_STORAGE_KEY);
      return saved && CARS.some((c) => c.id === saved) ? saved : CARS[0].id;
    } catch {
      return CARS[0].id;
    }
  });
  const [customMap, setCustomMap] = useState<Record<string, CarCustomization>>(loadSavedCustoms);

  const customization = useMemo<CarCustomization>(
    () => customMap[selectedCarId] ?? defaultCustomFor(selectedCarId),
    [customMap, selectedCarId],
  );

  const handleChangeCustomization = useCallback(
    (next: CarCustomization) => {
      setCustomMap((prev) => {
        const updated = { ...prev, [selectedCarId]: next };
        try {
          window.localStorage.setItem(CUSTOMS_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore storage quota errors
        }
        return updated;
      });
    },
    [selectedCarId],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_CAR_STORAGE_KEY, selectedCarId);
    } catch {
      // ignore
    }
  }, [selectedCarId]);

  const [graphicsQuality, setGraphicsQuality] = useState<GraphicsQuality>(() => {
    try {
      const saved = window.localStorage.getItem(QUALITY_STORAGE_KEY);
      if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
    } catch {
      // ignore
    }
    return 'medium';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(QUALITY_STORAGE_KEY, graphicsQuality);
    } catch {
      // ignore
    }
  }, [graphicsQuality]);

  const [playerName, setPlayerName] = useState<string>('Driver 1');
  const [steeringMode, setSteeringMode] = useState<SteeringControlMode>('buttons');
  const [cameraAngle, setCameraAngle] = useState<CameraAngle>('chase');
  const [headlightsOn, setHeadlightsOn] = useState<boolean>(true);
  const [muted, setMuted] = useState<boolean>(false);

  // Mode / Pairing config
  const [trackId, setTrackId] = useState<string>('neon-night-city');
  const [laps, setLaps] = useState<number>(2);
  const [aiCount, setAiCount] = useState<number>(4);
  const [trafficEnabled, setTrafficEnabled] = useState<boolean>(true);
  const [pairingMode, setPairingMode] = useState<GameMode>('race');
  const [pairingTransport, setPairingTransport] = useState<PairingTransport>('internet');

  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({
    sessionKey: 1,
    mode: isAutostart ? 'open-world' : 'race',
    opponentMode: 'ai',
    trackId: 'neon-night-city',
    laps: 2,
    aiCount: 4,
    trafficEnabled: true,
    room: null,
  });

  const [hud, setHud] = useState<HudTelemetrySnapshot>(INITIAL_HUD);
  const [results, setResults] = useState<RaceResultEntry[]>([]);

  const touchInputRef = useRef<VehicleInput>({
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    nitro: false,
  });

  // Keep document.body.dataset.state & RTL/LTR direction synced
  useEffect(() => {
    const stateTag =
      screen === 'playing' || screen === 'paused' || screen === 'gameover'
        ? screen
        : 'title';
    document.body.dataset.state = stateTag;
  }, [screen]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const startLocalSession = useCallback(
    (mode: GameMode, opponentMode: RaceOpponentMode) => {
      soundEngine.unlock();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setResults([]);
      setSessionConfig((prev) => ({
        sessionKey: prev.sessionKey + 1,
        mode,
        opponentMode,
        trackId,
        laps,
        aiCount,
        trafficEnabled,
        room: null,
      }));
      setScreen('playing');
    },
    [aiCount, laps, trackId, trafficEnabled],
  );

  // Title-to-Start Handshake: Enter / Space starts gameplay from 'title'
  useEffect(() => {
    if (screen !== 'title' || settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        startLocalSession('open-world', 'ai');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, settingsOpen, startLocalSession]);

  const handleRoomStarted = useCallback((room: LobbyRoomState) => {
    soundEngine.unlock();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setResults([]);
    setSessionConfig((prev) => ({
      sessionKey: prev.sessionKey + 1,
      mode: room.mode,
      opponentMode: 'friends',
      trackId: room.trackId,
      laps: room.laps,
      aiCount: 4,
      trafficEnabled: room.trafficEnabled,
      room,
    }));
    setScreen('playing');
  }, []);

  const handleToggleCamera = useCallback(() => {
    setCameraAngle((prev) =>
      prev === 'chase' ? 'hood' : prev === 'hood' ? 'overhead' : 'chase',
    );
  }, []);

  const handleToggleLights = useCallback(() => {
    setHeadlightsOn((prev) => !prev);
  }, []);

  const handleTogglePause = useCallback(() => {
    setScreen((prev) => (prev === 'playing' ? 'paused' : prev === 'paused' ? 'playing' : prev));
  }, []);

  const handleRaceFinished = useCallback((finalOrder: RaceResultEntry[]) => {
    setResults(finalOrder);
    setScreen('gameover');
  }, []);

  const handleExitToMenu = useCallback(() => {
    networkManager.leaveRoom();
    setScreen('title');
  }, []);

  const handleRestartSession = useCallback(() => {
    setResults([]);
    setSessionConfig((prev) => ({
      ...prev,
      sessionKey: prev.sessionKey + 1,
    }));
    setScreen('playing');
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <GameCanvas
        screen={screen}
        selectedCarId={selectedCarId}
        customization={customization}
        cameraAngle={cameraAngle}
        graphicsQuality={graphicsQuality}
        sessionConfig={sessionConfig}
        touchInputRef={touchInputRef}
        headlightsOn={headlightsOn}
        onToggleCamera={handleToggleCamera}
        onToggleLights={handleToggleLights}
        onTogglePause={handleTogglePause}
        onHudUpdate={setHud}
        onRaceFinished={handleRaceFinished}
      />

      {screen === 'title' && (
        <TitleScreen
          lang={lang}
          onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
          onQuickStart={() => startLocalSession('open-world', 'ai')}
          onOpenModeSelect={() => setScreen('mode-select')}
          onOpenGarage={() => setScreen('garage')}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {screen === 'garage' && (
        <GarageScreen
          lang={lang}
          selectedCarId={selectedCarId}
          customization={customization}
          onSelectCar={setSelectedCarId}
          onChangeCustomization={handleChangeCustomization}
          onBack={() => setScreen('title')}
          onDriveSelected={() => setScreen('mode-select')}
        />
      )}

      {screen === 'mode-select' && (
        <ModeSelectScreen
          lang={lang}
          trackId={trackId}
          laps={laps}
          aiCount={aiCount}
          trafficEnabled={trafficEnabled}
          onChangeTrack={setTrackId}
          onChangeLaps={setLaps}
          onChangeAiCount={setAiCount}
          onToggleTraffic={setTrafficEnabled}
          onStartLocal={startLocalSession}
          onOpenPairing={(mode, transport) => {
            setPairingMode(mode);
            setPairingTransport(transport);
            setScreen('lobby');
          }}
          onBack={() => setScreen('title')}
        />
      )}

      {screen === 'lobby' && (
        <PairingLobby
          lang={lang}
          mode={pairingMode}
          transport={pairingTransport}
          playerName={playerName}
          selectedCarId={selectedCarId}
          customization={customization}
          trackId={trackId}
          laps={laps}
          trafficEnabled={trafficEnabled}
          onChangePlayerName={setPlayerName}
          onRoomStarted={handleRoomStarted}
          onBack={() => setScreen('mode-select')}
        />
      )}

      {(screen === 'playing' || screen === 'paused') && (
        <GameHud
          lang={lang}
          mode={sessionConfig.mode}
          isMultiplayer={Boolean(sessionConfig.room)}
          transport={sessionConfig.room?.transport ?? 'internet'}
          pingMs={networkManager.getPingMs()}
          steeringMode={steeringMode}
          cameraAngle={cameraAngle}
          hud={hud}
          touchInputRef={touchInputRef}
          onToggleCamera={handleToggleCamera}
          onToggleLights={handleToggleLights}
          onPause={handleTogglePause}
        />
      )}

      {screen === 'paused' && (
        <PauseModal
          lang={lang}
          onResume={() => setScreen('playing')}
          onRestart={handleRestartSession}
          onExit={handleExitToMenu}
        />
      )}

      {screen === 'gameover' && (
        <ResultsModal
          lang={lang}
          results={results}
          onPlayAgain={handleRestartSession}
          onExit={handleExitToMenu}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          lang={lang}
          steeringMode={steeringMode}
          graphicsQuality={graphicsQuality}
          muted={muted}
          onChangeSteering={setSteeringMode}
          onChangeGraphicsQuality={setGraphicsQuality}
          onToggleMute={() => {
            const next = !muted;
            setMuted(next);
            soundEngine.setMuted(next);
          }}
          onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
