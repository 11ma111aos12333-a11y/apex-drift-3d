import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bluetooth,
  Copy,
  Check,
  Play,
  RefreshCw,
  Wifi,
  Signal,
} from 'lucide-react';
import {
  BluetoothDiscoveredDevice,
  CarCustomization,
  GameMode,
  Language,
  LobbyRoomState,
  PairingTransport,
} from '../types/game';
import { getCarById } from '../data/cars';
import { TRACKS } from '../data/tracks';
import { networkManager } from '../network/networkManager';
import { bluetoothBridge } from '../network/bluetoothBridge';
import { t } from '../i18n/translations';

interface PairingLobbyProps {
  lang: Language;
  mode: GameMode;
  transport: PairingTransport;
  playerName: string;
  selectedCarId: string;
  customization: CarCustomization;
  trackId: string;
  laps: number;
  trafficEnabled: boolean;
  onChangePlayerName: (name: string) => void;
  onRoomStarted: (room: LobbyRoomState) => void;
  onBack: () => void;
}

export const PairingLobby: React.FC<PairingLobbyProps> = ({
  lang,
  mode,
  transport,
  playerName,
  selectedCarId,
  customization,
  trackId,
  laps,
  trafficEnabled,
  onChangePlayerName,
  onRoomStarted,
  onBack,
}) => {
  const [room, setRoom] = useState<LobbyRoomState | null>(networkManager.getCurrentRoom());
  const [joinCode, setJoinCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Public online rooms directory
  const [publicRooms, setPublicRooms] = useState<
    Array<{ code: string; hostName: string; playerCount: number; maxPlayers: number; trackId: string }>
  >([]);

  // Bluetooth discovery state
  const [btDevices, setBtDevices] = useState<BluetoothDiscoveredDevice[]>([]);
  const [btConnected, setBtConnected] = useState(false);
  const [btInfo, setBtInfo] = useState<string | null>(null);

  useEffect(() => {
    const unsubRoom = networkManager.onRoomChange((r) => setRoom(r ? { ...r } : null));
    const unsubStart = networkManager.onGameStarted((r) => onRoomStarted(r));
    const unsubErr = networkManager.onError((code) => {
      if (code === 'ROOM_NOT_FOUND') {
        setErrorMsg(lang === 'ar' ? 'رمز الغرفة غير موجود' : 'Room code not found');
      } else if (code === 'ROOM_FULL') {
        setErrorMsg(lang === 'ar' ? 'الغرفة ممتلئة' : 'Room is full');
      }
      setBusy(false);
    });

    if (transport === 'internet') {
      fetch('/api/rooms')
        .then((r) => r.json())
        .then((d) => setPublicRooms(d.rooms || []))
        .catch(() => {});
    }

    return () => {
      unsubRoom();
      unsubStart();
      unsubErr();
    };
  }, [lang, onRoomStarted, transport]);

  const handleHostOnline = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await networkManager.createOnlineRoom({
        playerName: playerName.trim() || 'Driver 1',
        carId: selectedCarId,
        customization,
        mode,
        trackId,
        laps,
        fillWithAi: true,
        trafficEnabled,
      });
    } catch {
      setErrorMsg(lang === 'ar' ? 'تعذر الاتصال بخادم اللعب' : 'Could not connect to multiplayer server');
    } finally {
      setBusy(false);
    }
  };

  const handleJoinOnline = async (codeOverride?: string) => {
    const targetCode = (codeOverride ?? joinCode).trim().toUpperCase();
    if (!targetCode) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await networkManager.joinOnlineRoom(
        targetCode,
        playerName.trim() || 'Driver',
        selectedCarId,
        customization,
      );
    } catch {
      setErrorMsg(lang === 'ar' ? 'فشل الانضمام للغرفة' : 'Failed to join room');
    } finally {
      setBusy(false);
    }
  };

  const handleHostBluetooth = async () => {
    setErrorMsg(null);
    setBtInfo(null);
    try {
      const perm = await bluetoothBridge.ensureReady();
      networkManager.setupBluetoothLobby({
        isHost: true,
        playerName: playerName.trim() || 'Host Racer',
        carId: selectedCarId,
        customization,
        mode,
        trackId,
        laps,
        fillWithAi: true,
        trafficEnabled,
      });
      if (perm.mode === 'native') {
        await bluetoothBridge.hostServer(
          (pkt) => networkManager.handleBluetoothRawPacket(pkt),
          (st) => {
            setBtConnected(st.connected);
            if (st.error) setErrorMsg(st.error);
          },
        );
        setBtInfo(lang === 'ar' ? 'الجهاز جاهز لاستقبال أصدقاء البلوتوث' : 'Bluetooth RFCOMM Server active & discoverable');
      } else {
        setBtInfo(t(lang, 'btNativeHint'));
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Bluetooth Host failed');
    }
  };

  const handleScanBluetooth = async () => {
    setErrorMsg(null);
    setBtInfo(null);
    try {
      const perm = await bluetoothBridge.ensureReady();
      if (perm.mode === 'unavailable') {
        setBtInfo(t(lang, 'btNativeHint'));
        return;
      }
      const bonded = await bluetoothBridge.startDiscovery(
        (dev) => {
          setBtDevices((prev) =>
            prev.some((p) => p.address === dev.address) ? prev : [...prev, dev],
          );
        },
        (pkt) => networkManager.handleBluetoothRawPacket(pkt),
        (st) => {
          setBtConnected(st.connected);
          if (st.error) setErrorMsg(st.error);
        },
      );
      setBtDevices(bonded);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Bluetooth discovery failed');
    }
  };

  const handleConnectBtDevice = async (address: string) => {
    setErrorMsg(null);
    try {
      await bluetoothBridge.connect(address);
      networkManager.setupBluetoothLobby({
        isHost: false,
        playerName: playerName.trim() || 'BT Racer',
        carId: selectedCarId,
        customization,
        mode,
        trackId,
        laps,
        fillWithAi: true,
        trafficEnabled,
      });
      setBtConnected(true);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Could not pair RFCOMM device');
    }
  };

  const handleLeaveAndBack = () => {
    networkManager.leaveRoom();
    onBack();
  };

  const myId = networkManager.getClientId();
  const me = room?.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center p-4 md:p-8 overflow-y-auto">
      <div
        className="w-full max-w-4xl rounded-2xl border border-white/15 p-5 md:p-7"
        style={{ background: 'rgba(9, 12, 18, 0.94)' }}
      >
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleLeaveAndBack}
              aria-label={t(lang, 'back')}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              {transport === 'internet' ? (
                <Wifi className="w-5 h-5 text-cyan-400" />
              ) : (
                <Bluetooth className="w-5 h-5 text-amber-400" />
              )}
              <h2 className="font-display text-xl md:text-2xl font-bold text-white">
                {t(lang, 'pairingLobby')}
              </h2>
            </div>
          </div>

          {room && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{t(lang, 'roomCode')}:</span>
              <span className="font-telemetry text-base font-bold text-amber-400 tracking-wider">
                {room.code}
              </span>
              {transport === 'internet' && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(room.code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  aria-label="Copy room code"
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/40 bg-red-500/15 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        {!room ? (
          <div className="space-y-5">
            {/* Driver Name */}
            <div>
              <label
                htmlFor="driver-name-input"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                {t(lang, 'playerName')}
              </label>
              <input
                id="driver-name-input"
                type="text"
                value={playerName}
                maxLength={20}
                onChange={(e) => onChangePlayerName(e.target.value)}
                className="w-full max-w-sm px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-sm text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            {transport === 'internet' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-white/10 bg-white/5 flex flex-col justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">{t(lang, 'hostRoom')}</h3>
                    <p className="text-xs text-slate-300">{t(lang, 'internetPairingDesc')}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleHostOnline}
                    className="w-full py-3 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold text-sm cursor-pointer disabled:opacity-50"
                  >
                    {t(lang, 'hostRoom')}
                  </button>
                </div>

                <div className="p-4 rounded-xl border border-white/10 bg-white/5 flex flex-col justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">{t(lang, 'joinRoom')}</h3>
                    <input
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder={t(lang, 'enterRoomCode')}
                      maxLength={8}
                      className="w-full mt-2 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 font-telemetry text-sm text-white uppercase focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || joinCode.trim().length < 3}
                    onClick={() => handleJoinOnline()}
                    className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer disabled:opacity-50"
                  >
                    {t(lang, 'joinRoom')}
                  </button>
                </div>

                {publicRooms.length > 0 && (
                  <div className="md:col-span-2 p-4 rounded-xl border border-white/10 bg-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-300">
                        {lang === 'ar' ? 'غرف متاحة حالياً' : 'Active Rooms'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          fetch('/api/rooms')
                            .then((r) => r.json())
                            .then((d) => setPublicRooms(d.rooms || []))
                            .catch(() => {})
                        }
                        className="text-xs text-cyan-400 flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {publicRooms.map((pr) => (
                        <button
                          key={pr.code}
                          type="button"
                          onClick={() => handleJoinOnline(pr.code)}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-white/10 hover:border-cyan-400 text-xs cursor-pointer"
                        >
                          <span className="font-bold text-white">{pr.hostName}</span>
                          <span className="font-telemetry text-amber-400">
                            {pr.code} · {pr.playerCount}/{pr.maxPlayers}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Bluetooth Pairing Setup */
              <div className="space-y-4">
                {btInfo && (
                  <div className="p-3.5 rounded-xl border border-amber-400/30 bg-amber-500/10 text-xs text-amber-100">
                    {btInfo}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleHostBluetooth}
                    className="py-3.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer"
                  >
                    {t(lang, 'advertiseBluetooth')}
                  </button>
                  <button
                    type="button"
                    onClick={handleScanBluetooth}
                    className="py-3.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/15 text-white font-bold text-sm cursor-pointer"
                  >
                    {t(lang, 'scanBluetooth')}
                  </button>
                </div>

                {btDevices.length > 0 && (
                  <div className="space-y-2">
                    {btDevices.map((d) => (
                      <button
                        key={d.address}
                        type="button"
                        onClick={() => handleConnectBtDevice(d.address)}
                        className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:border-amber-400 cursor-pointer"
                      >
                        <div className="text-start">
                          <div className="text-sm font-bold text-white">{d.name}</div>
                          <div className="font-telemetry text-xs text-slate-400">{d.address}</div>
                        </div>
                        <span className="font-telemetry text-xs text-cyan-400">
                          {d.rssi} dBm
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Active Room Waiting Lobby */
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
              <div>
                <span>{t(lang, 'connectedPlayers')}: </span>
                <span className="font-telemetry font-bold text-white">
                  {room.players.length}/{room.maxPlayers}
                </span>
                {btConnected && <span className="mx-2 text-emerald-400">· {t(lang, 'btConnected')}</span>}
              </div>

              <div className="flex items-center gap-2">
                <Signal className="w-4 h-4 text-cyan-400" />
                <span className="font-telemetry">
                  {transport === 'internet' ? `${networkManager.getPingMs()} ms` : 'RFCOMM'}
                </span>
              </div>
            </div>

            {/* Paired Players List */}
            <div className="space-y-2">
              {room.players.map((p) => {
                const car = getCarById(p.carId);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-4 h-4 rounded-full border border-white/30"
                        style={{ backgroundColor: p.customization?.paintColor || car.defaultPaint }}
                      />
                      <div>
                        <div className="text-sm font-bold text-white">
                          {p.name}
                          {p.id === myId ? ` ${t(lang, 'youSuffix')}` : ''}
                          {p.isHost ? ` · ${t(lang, 'hostLabel')}` : ''}
                        </div>
                        <div className="text-xs text-slate-400">
                          {lang === 'ar' ? car.nameAr : car.nameEn}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-telemetry text-xs text-slate-400">{p.pingMs} ms</span>
                      <span
                        className={`text-xs font-bold ${
                          p.ready ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {p.ready ? t(lang, 'ready') : t(lang, 'notReady')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Host Room Settings (Track, Laps, Optional AI Fill) */}
            {isHost && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-white/10 bg-white/5">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {t(lang, 'selectTrack')}
                  </label>
                  <select
                    value={room.trackId}
                    onChange={(e) => networkManager.updateRoomSettings({ trackId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/15 text-xs text-white"
                  >
                    {TRACKS.map((trk) => (
                      <option key={trk.id} value={trk.id}>
                        {lang === 'ar' ? trk.nameAr : trk.nameEn}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">{t(lang, 'fillWithAi')}</span>
                  <button
                    type="button"
                    onClick={() =>
                      networkManager.updateRoomSettings({ fillWithAi: !room.fillWithAi })
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                      room.fillWithAi
                        ? 'bg-cyan-400 text-slate-950'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {room.fillWithAi ? t(lang, 'enabled') : t(lang, 'disabled')}
                  </button>
                </div>
              </div>
            )}

            {/* Lobby Bottom Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => networkManager.updatePlayerState({ ready: !me?.ready })}
                className={`px-5 py-3 rounded-xl text-sm font-bold cursor-pointer ${
                  me?.ready
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-800 text-white border border-white/20'
                }`}
              >
                {t(lang, 'toggleReady')}
              </button>

              {isHost ? (
                <button
                  type="button"
                  onClick={() => networkManager.startMultiplayerGame()}
                  className="flex items-center gap-2 px-7 py-3 rounded-xl text-sm font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>{t(lang, 'startRace')}</span>
                </button>
              ) : (
                <span className="text-xs text-slate-300">{t(lang, 'waitingHost')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
