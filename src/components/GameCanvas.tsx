import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CameraAngle,
  CarCustomization,
  CollisionContact,
  GameMode,
  GraphicsQuality,
  LobbyRoomState,
  RaceOpponentMode,
  RaceResultEntry,
  ScreenState,
  VehicleInput,
  VehicleTelemetry,
} from '../types/game';
import { CARS, getCarById } from '../data/cars';
import { getTrackById } from '../data/tracks';
import {
  FixedChaseCameraPose,
  resolveVehicleCollisions,
  stepFixedChaseCamera,
  stepVehiclePhysics,
  updateRaceStandings,
} from '../game/physics';
import { computeAiDriverInput } from '../game/aiRacer';
import { RemoteCarInterpolator } from '../game/interpolation';
import { createProceduralTexturePack } from '../three/textures';
import { buildCarRig, BuiltCarRig } from '../three/carBuilder';
import { buildGameWorld, WorldHandles } from '../three/worldBuilder';
import { networkManager } from '../network/networkManager';
import { soundEngine } from '../audio/soundEngine';

export interface HudTelemetrySnapshot {
  speedKmh: number;
  rpm: number;
  gear: number;
  nitro: number;
  isDrifting: boolean;
  isNitroActive: boolean;
  lap: number;
  totalLaps: number;
  rank: number;
  totalRacers: number;
  countdownSec: number; // 3, 2, 1, 0 (GO!), -1 (hidden)
  elapsedMs: number;
  headlightsOn: boolean;
  isWrongWay: boolean;
  minimapPoints: Array<{
    id: string;
    x: number;
    z: number;
    isPlayer: boolean;
    isFriend: boolean;
    color: string;
  }>;
  trackOutline: Array<{ x: number; z: number }>;
}

export interface SessionConfig {
  sessionKey: number;
  mode: GameMode;
  opponentMode: RaceOpponentMode;
  trackId: string;
  laps: number;
  aiCount: number; // total racers in VS AI (2..8)
  trafficEnabled: boolean;
  room: LobbyRoomState | null;
}

interface GameCanvasProps {
  screen: ScreenState;
  selectedCarId: string;
  customization: CarCustomization;
  cameraAngle: CameraAngle;
  graphicsQuality: GraphicsQuality;
  sessionConfig: SessionConfig;
  touchInputRef: React.MutableRefObject<VehicleInput>;
  headlightsOn: boolean;
  onToggleCamera: () => void;
  onToggleLights: () => void;
  onTogglePause: () => void;
  onHudUpdate: (snap: HudTelemetrySnapshot) => void;
  onRaceFinished: (results: RaceResultEntry[]) => void;
}

// Pre-allocated math objects for zero-GC 60Hz loop
const _camLook = new THREE.Vector3();
const _chasePoseScratch: FixedChaseCameraPose = {
  camX: 0,
  camY: 0,
  camZ: 0,
  lookX: 0,
  lookY: 0,
  lookZ: 0,
  chaseYaw: 0,
};
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();
const _dummy = new THREE.Object3D();

const SKID_POOL_SIZE = 220;
const SMOKE_POOL_SIZE = 70;
const SPARK_POOL_SIZE = 64;

interface SmokeParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
}

interface SparkParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  screen,
  selectedCarId,
  customization,
  cameraAngle,
  graphicsQuality,
  sessionConfig,
  touchInputRef,
  headlightsOn,
  onToggleCamera,
  onToggleLights,
  onTogglePause,
  onHudUpdate,
  onRaceFinished,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // Latest props stored in refs so WebGLRenderer never tears down on UI state changes
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const selectedCarRef = useRef(selectedCarId);
  selectedCarRef.current = selectedCarId;

  const customRef = useRef(customization);
  customRef.current = customization;

  const cameraAngleRef = useRef(cameraAngle);
  cameraAngleRef.current = cameraAngle;

  const qualityRef = useRef<GraphicsQuality>(graphicsQuality);
  qualityRef.current = graphicsQuality;

  const headlightsRef = useRef(headlightsOn);
  headlightsRef.current = headlightsOn;

  const callbacksRef = useRef({
    onToggleCamera,
    onToggleLights,
    onTogglePause,
    onHudUpdate,
    onRaceFinished,
  });
  callbacksRef.current = {
    onToggleCamera,
    onToggleLights,
    onTogglePause,
    onHudUpdate,
    onRaceFinished,
  };

  const sessionRef = useRef(sessionConfig);
  sessionRef.current = sessionConfig;

  // Trigger rebuild flags when garage car or session changes
  const activeGarageKeyRef = useRef('');
  const activeSessionKeyRef = useRef(-1);
  const applyQualityFnRef = useRef<(() => void) | null>(null);
  const syncGarageFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    applyQualityFnRef.current?.();
  }, [graphicsQuality]);

  useEffect(() => {
    syncGarageFnRef.current?.();
  }, [selectedCarId, customization]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Software WebGL probe
    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const smartAntialias = !isSoftwareGl && window.devicePixelRatio <= 1.5;
    const renderer = new THREE.WebGLRenderer({
      antialias: smartAntialias,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = !isSoftwareGl && qualityRef.current !== 'low';
    renderer.shadowMap.type = THREE.BasicShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x131a29);
    scene.fog = new THREE.Fog(0x1b2436, 90, 360);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(
      60,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.25,
      360,
    );

    // Minimal Light Rig: 1 HemisphereLight + 1 DirectionalLight (no PointLights/SpotLights!)
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x78350f, 0.9);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.0);
    sunLight.position.set(45, 75, 35);
    sunLight.castShadow = !isSoftwareGl && qualityRef.current !== 'low';
    sunLight.shadow.mapSize.width = 512;
    sunLight.shadow.mapSize.height = 512;
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far = 165;
    const sd = 42;
    sunLight.shadow.camera.left = -sd;
    sunLight.shadow.camera.right = sd;
    sunLight.shadow.camera.top = sd;
    sunLight.shadow.camera.bottom = -sd;
    sunLight.shadow.bias = -0.0008;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.55);
    rimLight.position.set(-40, 28, -45);
    rimLight.visible = qualityRef.current === 'high';
    scene.add(rimLight);

    const textures = createProceduralTexturePack(renderer);

    // Pooled Skidmarks & Smoke Particles
    const skidGeo = new THREE.CircleGeometry(0.28, 6);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a0c,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    const skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, SKID_POOL_SIZE);
    skidMesh.frustumCulled = false;
    for (let i = 0; i < SKID_POOL_SIZE; i++) {
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      skidMesh.setMatrixAt(i, _dummy.matrix);
    }
    skidMesh.instanceMatrix.needsUpdate = true;
    scene.add(skidMesh);
    let skidCursor = 0;

    const smokeGeo = new THREE.PlaneGeometry(1.4, 1.4);
    const smokeMat = new THREE.MeshBasicMaterial({
      map: textures.smokeMap,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, SMOKE_POOL_SIZE);
    smokeMesh.frustumCulled = false;
    scene.add(smokeMesh);
    const smokePool: SmokeParticle[] = Array.from({ length: SMOKE_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: -50,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
      size: 1,
    }));
    let smokeCursor = 0;

    const sparkGeo = new THREE.SphereGeometry(0.11, 5, 5);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xfb923c,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, SPARK_POOL_SIZE);
    sparkMesh.frustumCulled = false;
    scene.add(sparkMesh);
    const sparkPool: SparkParticle[] = Array.from({ length: SPARK_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: -50,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 0.4,
    }));
    let sparkCursor = 0;

    // Active scene handles
    let worldHandles: WorldHandles | null = null;
    let currentTrack = getTrackById(sessionRef.current.trackId);
    let activeWorldMode: GameMode | null = null;
    let garageCarRig: BuiltCarRig | null = null;
    const garageRoot = new THREE.Group();
    scene.add(garageRoot);

    interface ActiveActor {
      telemetry: VehicleTelemetry;
      rig: BuiltCarRig;
      aiLaneOffset: number;
      aiSkill: number;
      isTraffic: boolean;
      isRemote: boolean;
    }

    const actors: ActiveActor[] = [];
    const actorsRoot = new THREE.Group();
    scene.add(actorsRoot);

    const interpolator = new RemoteCarInterpolator();
    const unsubMotion = networkManager.onMotionPacket((pkt) => {
      interpolator.pushPacket(pkt, performance.now());
    });

    // Garage 360 orbit state
    let garageOrbitYaw = 0.65;
    let garageOrbitPitch = 0.24;
    let garageZoom = 6.2;
    let draggingGarage = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (screenRef.current === 'garage') {
        draggingGarage = true;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
      }
      soundEngine.unlock();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingGarage || screenRef.current !== 'garage') return;
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      garageOrbitYaw -= dx * 0.008;
      garageOrbitPitch = THREE.MathUtils.clamp(garageOrbitPitch + dy * 0.005, 0.08, 0.68);
    };
    const onPointerUp = () => {
      draggingGarage = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (screenRef.current === 'garage') {
        garageZoom = THREE.MathUtils.clamp(garageZoom + e.deltaY * 0.003, 4.2, 9.5);
      }
    };

    const domEl = renderer.domElement;
    domEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    domEl.addEventListener('wheel', onWheel, { passive: true });

    // Keyboard input tracking
    const keysDown = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      soundEngine.unlock();
      const code = e.code;
      keysDown.add(code);

      if (screenRef.current === 'playing') {
        if (code === 'KeyC') callbacksRef.current.onToggleCamera();
        else if (code === 'KeyL') callbacksRef.current.onToggleLights();
        else if (code === 'KeyH') soundEngine.playHorn();
        else if (code === 'Escape' || code === 'KeyP') callbacksRef.current.onTogglePause();
      } else if (screenRef.current === 'paused') {
        if (code === 'Escape' || code === 'KeyP') callbacksRef.current.onTogglePause();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.delete(e.code);
    };
    const onBlur = () => {
      keysDown.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // ResizeObserver for crisp responsiveness
    const handleResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    // Race simulation state
    let raceElapsedMs = 0;
    let countdownRemainingSec = 0;
    let lastBeepSec = -1;
    let raceFinishedNotified = false;
    let trauma = 0;
    let lastHudEmitMs = 0;
    let lastNetEmitMs = 0;
    let netSeq = 0;

    let lastCollisionSoundMs = 0;
    let camChaseYaw = 0;

    // Pre-allocated scratch arrays for zero-GC 60Hz loop
    const telemetryScratch: VehicleTelemetry[] = [];
    const racerScratch: VehicleTelemetry[] = [];
    const frameContactsScratch: CollisionContact[] = [];
    const playerInputScratch: VehicleInput = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      nitro: false,
    };

    function applyGraphicsQuality() {
      const q = qualityRef.current;
      const maxDpr = q === 'low' ? 1.0 : q === 'medium' ? 1.25 : 1.5;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, maxDpr));
      renderer.setSize(container!.clientWidth || window.innerWidth, container!.clientHeight || window.innerHeight);

      const useShadows = !isSoftwareGl && q !== 'low';
      renderer.shadowMap.enabled = useShadows;
      sunLight.castShadow = useShadows;
      const mapSize = q === 'high' ? 1024 : 512;
      if (sunLight.shadow.mapSize.width !== mapSize) {
        sunLight.shadow.mapSize.width = mapSize;
        sunLight.shadow.mapSize.height = mapSize;
        sunLight.shadow.map?.dispose();
        sunLight.shadow.map = null;
      }
      const frustum = q === 'high' ? 56 : 42;
      sunLight.shadow.camera.left = -frustum;
      sunLight.shadow.camera.right = frustum;
      sunLight.shadow.camera.top = frustum;
      sunLight.shadow.camera.bottom = -frustum;
      sunLight.shadow.camera.updateProjectionMatrix();

      rimLight.visible = q === 'high';
      const farDist = q === 'low' ? 250 : q === 'medium' ? 350 : 480;
      camera.far = farDist;
      camera.updateProjectionMatrix();
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = Math.round(farDist * 0.24);
        scene.fog.far = Math.round(farDist * 0.95);
      }
    }
    applyQualityFnRef.current = applyGraphicsQuality;
    applyGraphicsQuality();

    function clearActors() {
      for (const a of actors) {
        actorsRoot.remove(a.rig.root);
        a.rig.dispose();
      }
      actors.length = 0;
      telemetryScratch.length = 0;
      racerScratch.length = 0;
      interpolator.clear();
    }

    function applyAtmosphereForTheme() {
      const theme = currentTrack.envTheme;
      const farDist = camera.far;
      const nearDist = Math.round(farDist * 0.24);
      const fogFar = Math.round(farDist * 0.95);

      if (theme === 'night-city') {
        scene.background = new THREE.Color(0x090d1a);
        scene.fog = new THREE.Fog(0x0b1121, nearDist, fogFar);
        hemiLight.color.setHex(0x38bdf8);
        hemiLight.groundColor.setHex(0x1e1b4b);
        hemiLight.intensity = 0.78;
        sunLight.color.setHex(0xc7d2fe);
        sunLight.intensity = 1.45;
        rimLight.color.setHex(0xec4899);
        rimLight.intensity = 0.85;
      } else if (theme === 'desert') {
        scene.background = new THREE.Color(0xe6b88a);
        scene.fog = new THREE.Fog(0xd99b66, nearDist, fogFar);
        hemiLight.color.setHex(0xfef3c7);
        hemiLight.groundColor.setHex(0x9a3412);
        hemiLight.intensity = 0.95;
        sunLight.color.setHex(0xfff1d6);
        sunLight.intensity = 2.25;
        rimLight.color.setHex(0xf97316);
        rimLight.intensity = 0.55;
      } else {
        scene.background = new THREE.Color(0x93c5fd);
        scene.fog = new THREE.Fog(0xbae6fd, nearDist, fogFar);
        hemiLight.color.setHex(0xe0f2fe);
        hemiLight.groundColor.setHex(0x3f6212);
        hemiLight.intensity = 1.05;
        sunLight.color.setHex(0xfffbeb);
        sunLight.intensity = 2.3;
        rimLight.color.setHex(0x38bdf8);
        rimLight.intensity = 0.65;
      }
    }

    function ensureWorldForTrack(trackId: string, mode: GameMode) {
      if (worldHandles && currentTrack.id === trackId && activeWorldMode === mode) return;
      if (worldHandles) {
        scene.remove(worldHandles.worldGroup);
        scene.remove(worldHandles.garageGroup);
        worldHandles.dispose();
      }
      currentTrack = getTrackById(trackId);
      activeWorldMode = mode;
      worldHandles = buildGameWorld(currentTrack, textures, mode);
      scene.add(worldHandles.worldGroup);
      scene.add(worldHandles.garageGroup);
      applyAtmosphereForTheme();
    }

    function syncGaragePreviewCar() {
      const key = `${selectedCarRef.current}:${JSON.stringify(customRef.current)}`;
      if (activeGarageKeyRef.current === key && garageCarRig) return;

      const car = getCarById(selectedCarRef.current);
      if (!garageCarRig || !activeGarageKeyRef.current.startsWith(car.id + ':')) {
        if (garageCarRig) {
          garageRoot.remove(garageCarRig.root);
          garageCarRig.dispose();
        }
        garageCarRig = buildCarRig(car, customRef.current, textures, isSoftwareGl);
        garageRoot.add(garageCarRig.root);
      } else {
        garageCarRig.applyCustomization(customRef.current);
      }
      garageCarRig.setLightsState(true, false, false);
      activeGarageKeyRef.current = key;
    }
    syncGarageFnRef.current = () => {
      syncGaragePreviewCar();
      if (screenRef.current === 'garage' || screenRef.current === 'title') {
        renderer.render(scene, camera);
      }
    };

    function startGameplaySession() {
      const cfg = sessionRef.current;
      activeSessionKeyRef.current = cfg.sessionKey;
      ensureWorldForTrack(cfg.trackId, cfg.mode);
      clearActors();

      const track = currentTrack;
      const wp0 = track.waypoints[0];
      const wp1 = track.waypoints[1];
      const baseYaw = Math.atan2(-(wp1.x - wp0.x), -(wp1.z - wp0.z));
      const fwdX = -Math.sin(baseYaw);
      const fwdZ = -Math.cos(baseYaw);
      const rightX = Math.cos(baseYaw);
      const rightZ = -Math.sin(baseYaw);

      const spawnList: Array<{
        id: string;
        name: string;
        isPlayer: boolean;
        isAi: boolean;
        isRemote: boolean;
        isTraffic: boolean;
        carId: string;
        customization: CarCustomization;
      }> = [];

      const myId = networkManager.getClientId();
      if (cfg.room && cfg.room.players.length > 0) {
        // Dynamic grid built from actual paired players!
        for (const p of cfg.room.players) {
          const isMe = p.id === myId;
          spawnList.push({
            id: p.id,
            name: p.name,
            isPlayer: isMe,
            isAi: false,
            isRemote: !isMe,
            isTraffic: false,
            carId: isMe ? selectedCarRef.current : p.carId,
            customization: isMe ? customRef.current : p.customization,
          });
        }
        // Optional AI backfill for empty slots in Race Mode
        if (cfg.mode === 'race' && cfg.room.fillWithAi && spawnList.length < 4) {
          const needed = 4 - spawnList.length;
          for (let i = 0; i < needed; i++) {
            const aiCar = CARS[(i + 2) % CARS.length];
            spawnList.push({
              id: `ai-fill-${i}`,
              name: `Racer AI ${i + 1}`,
              isPlayer: false,
              isAi: true,
              isRemote: false,
              isTraffic: false,
              carId: aiCar.id,
              customization: {
                paintColor: aiCar.defaultPaint,
                rimColor: aiCar.defaultRim,
                underglowColor: aiCar.defaultUnderglow,
                windowTint: 0.45,
              },
            });
          }
        }
      } else {
        // Solo / VS Computer
        spawnList.push({
          id: myId,
          name: 'Player',
          isPlayer: true,
          isAi: false,
          isRemote: false,
          isTraffic: false,
          carId: selectedCarRef.current,
          customization: customRef.current,
        });
        if (cfg.mode === 'race' && cfg.opponentMode === 'ai') {
          const aiTotal = Math.max(1, Math.min(7, cfg.aiCount - 1));
          for (let i = 0; i < aiTotal; i++) {
            const aiCar = CARS[(i + 1) % CARS.length];
            spawnList.push({
              id: `ai-${i}`,
              name: `AI ${i + 1}`,
              isPlayer: false,
              isAi: true,
              isRemote: false,
              isTraffic: false,
              carId: aiCar.id,
              customization: {
                paintColor: aiCar.defaultPaint,
                rimColor: aiCar.defaultRim,
                underglowColor: aiCar.defaultUnderglow,
                windowTint: 0.45,
              },
            });
          }
        }
      }

      // Build grid positions (2-wide staggered grid)
      spawnList.forEach((entry, idx) => {
        const row = Math.floor(idx / 2);
        const col = idx % 2 === 0 ? -1 : 1;
        const backOffset = row * 7.5 + 4;
        const sideOffset = col * 3.1;

        const sx = wp0.x - fwdX * backOffset + rightX * sideOffset;
        const sz = wp0.z - fwdZ * backOffset + rightZ * sideOffset;

        const carSpec = getCarById(entry.carId);
        const rig = buildCarRig(carSpec, entry.customization, textures, isSoftwareGl);
        rig.root.position.set(sx, 0, sz);
        rig.root.rotation.y = baseYaw;
        actorsRoot.add(rig.root);

        const telemetry: VehicleTelemetry = {
          id: entry.id,
          name: entry.name,
          isPlayer: entry.isPlayer,
          isAi: entry.isAi,
          carId: entry.carId,
          customization: entry.customization,
          x: sx,
          y: 0,
          z: sz,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: baseYaw,
          pitch: 0,
          roll: 0,
          speedMs: 0,
          speedKmh: 0,
          rpm: 1100,
          gear: 1,
          steerAngle: 0,
          wheelRotation: 0,
          nitro: 100,
          isNitroActive: false,
          isDrifting: false,
          isBraking: false,
          grounded: true,
          lap: 1,
          lapProgress: 0,
          totalProgress: 0,
          rank: idx + 1,
          finished: false,
          finishTimeMs: 0,
          bestLapMs: 0,
          lastLapStartMs: 0,
          nextCheckpointIdx: 1,
          lastValidCheckpointIdx: 0,
          isWrongWay: false,
          wrongWayTimer: 0,
          outOfBoundsTimer: 0,
        };

        actors.push({
          telemetry,
          rig,
          aiLaneOffset: ((idx % 3) - 1) * 3.5,
          aiSkill: 0.85 + (idx % 4) * 0.04,
          isTraffic: false,
          isRemote: entry.isRemote,
        });
      });

      // Open World Smart Traffic AI (spread around the circuit!)
      if (cfg.mode === 'open-world' && cfg.trafficEnabled) {
        const trafficCount = 6;
        for (let t = 0; t < trafficCount; t++) {
          const wpIdx = Math.floor(((t + 1) / (trafficCount + 1)) * track.waypoints.length);
          const twp = track.waypoints[wpIdx];
          const twpNext = track.waypoints[(wpIdx + 1) % track.waypoints.length];
          const tYaw = Math.atan2(-(twpNext.x - twp.x), -(twpNext.z - twp.z));
          const carSpec = CARS[(t + 2) % CARS.length];
          const custom: CarCustomization = {
            paintColor: ['#64748b', '#0284c7', '#f59e0b', '#e2e8f0'][t % 4],
            rimColor: '#1e293b',
            underglowColor: 'none',
            windowTint: 0.6,
          };
          const rig = buildCarRig(carSpec, custom, textures, isSoftwareGl);
          rig.root.position.set(twp.x, 0, twp.z);
          rig.root.rotation.y = tYaw;
          actorsRoot.add(rig.root);

          actors.push({
            telemetry: {
              id: `traffic-${t}`,
              name: 'Traffic',
              isPlayer: false,
              isAi: true,
              carId: carSpec.id,
              customization: custom,
              x: twp.x,
              y: 0,
              z: twp.z,
              vx: 0,
              vy: 0,
              vz: 0,
              yaw: tYaw,
              pitch: 0,
              roll: 0,
              speedMs: 0,
              speedKmh: 0,
              rpm: 1500,
              gear: 2,
              steerAngle: 0,
              wheelRotation: 0,
              nitro: 0,
              isNitroActive: false,
              isDrifting: false,
              isBraking: false,
              grounded: true,
              lap: 1,
              lapProgress: 0,
              totalProgress: 0,
              rank: 99,
              finished: false,
              finishTimeMs: 0,
              bestLapMs: 0,
              lastLapStartMs: 0,
              nextCheckpointIdx: 1,
              lastValidCheckpointIdx: 0,
              isWrongWay: false,
              wrongWayTimer: 0,
              outOfBoundsTimer: 0,
            },
            rig,
            aiLaneOffset: t % 2 === 0 ? 4.2 : -4.2,
            aiSkill: 0.45,
            isTraffic: true,
            isRemote: false,
          });
        }
      }

      raceElapsedMs = 0;
      countdownRemainingSec = cfg.mode === 'race' ? 3.2 : 0;
      lastBeepSec = -1;
      raceFinishedNotified = false;
      trauma = 0;

      // Snap fixed medium chase camera behind player immediately on spawn
      const player = actors.find((a) => a.telemetry.isPlayer);
      if (player) {
        camChaseYaw = player.telemetry.yaw;
        const pfX = -Math.sin(camChaseYaw);
        const pfZ = -Math.cos(camChaseYaw);
        camera.position.set(
          player.telemetry.x - pfX * 5.6,
          player.telemetry.y + 2.2,
          player.telemetry.z - pfZ * 5.6,
        );
        camera.lookAt(player.telemetry.x + pfX * 6.5, player.telemetry.y + 0.85, player.telemetry.z + pfZ * 6.5);
      }
    }

    ensureWorldForTrack(sessionRef.current.trackId, sessionRef.current.mode);
    syncGaragePreviewCar();
    const initHandles = worldHandles as WorldHandles | null;
    if (initHandles) {
      const showShowcase = screenRef.current !== 'playing';
      initHandles.worldGroup.visible = !showShowcase;
      initHandles.garageGroup.visible = showShowcase;
      garageRoot.visible = showShowcase;
    }
    camera.position.set(
      Math.sin(garageOrbitYaw) * Math.cos(garageOrbitPitch) * garageZoom,
      Math.sin(garageOrbitPitch) * garageZoom + 0.9,
      Math.cos(garageOrbitYaw) * Math.cos(garageOrbitPitch) * garageZoom,
    );
    camera.lookAt(0, 0.65, 0);
    camera.fov = 46;
    camera.updateProjectionMatrix();
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    renderer.render(scene, camera);

    // Frame pacing loop (respects afterDraw on Software WebGL!)
    let frameId = 0;
    let disposed = false;
    let lastTimeMs = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function spawnSmoke(x: number, y: number, z: number) {
      const p = smokePool[smokeCursor];
      smokeCursor = (smokeCursor + 1) % SMOKE_POOL_SIZE;
      p.active = true;
      p.x = x + (Math.random() - 0.5) * 0.4;
      p.y = y + 0.25;
      p.z = z + (Math.random() - 0.5) * 0.4;
      p.vx = (Math.random() - 0.5) * 1.4;
      p.vy = 0.8 + Math.random() * 0.8;
      p.vz = (Math.random() - 0.5) * 1.4;
      p.life = 0;
      p.maxLife = 0.55 + Math.random() * 0.3;
      p.size = 0.85;
    }

    function spawnSkid(x: number, y: number, z: number, yaw: number) {
      _dummy.position.set(x, y + 0.055, z);
      _dummy.rotation.set(0, yaw, 0);
      _dummy.scale.set(1, 1, 1.8);
      _dummy.updateMatrix();
      skidMesh.setMatrixAt(skidCursor, _dummy.matrix);
      skidMesh.instanceMatrix.needsUpdate = true;
      skidCursor = (skidCursor + 1) % SKID_POOL_SIZE;
    }

    function spawnSparks(x: number, y: number, z: number, intensity: number) {
      const burstCount = Math.min(8, Math.max(3, Math.floor(intensity * 0.45)));
      for (let k = 0; k < burstCount; k++) {
        const s = sparkPool[sparkCursor];
        sparkCursor = (sparkCursor + 1) % SPARK_POOL_SIZE;
        s.active = true;
        s.x = x;
        s.y = y;
        s.z = z;
        s.vx = (Math.random() - 0.5) * 14;
        s.vy = 2.5 + Math.random() * 6.5;
        s.vz = (Math.random() - 0.5) * 14;
        s.life = 0;
        s.maxLife = 0.22 + Math.random() * 0.22;
      }
    }

    function tick() {
      if (disposed) return;

      const nowMs = performance.now();
      const rawDt = (nowMs - lastTimeMs) / 1000;
      lastTimeMs = nowMs;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      const scr = screenRef.current;
      const inShowcase = scr === 'title' || scr === 'garage' || scr === 'mode-select' || scr === 'lobby';

      if (worldHandles) {
        worldHandles.worldGroup.visible = !inShowcase;
        worldHandles.garageGroup.visible = inShowcase;
      }
      garageRoot.visible = inShowcase;
      actorsRoot.visible = !inShowcase;
      skidMesh.visible = !inShowcase;
      smokeMesh.visible = !inShowcase;
      sparkMesh.visible = !inShowcase;

      if (inShowcase) {
        soundEngine.updateTelemetry(0, false, false, false);
        syncGaragePreviewCar();

        if (scr !== 'garage') {
          garageOrbitYaw += dt * 0.22;
        }
        const camX = Math.sin(garageOrbitYaw) * Math.cos(garageOrbitPitch) * garageZoom;
        const camY = Math.sin(garageOrbitPitch) * garageZoom + 0.9;
        const camZ = Math.cos(garageOrbitYaw) * Math.cos(garageOrbitPitch) * garageZoom;

        camera.position.x = THREE.MathUtils.damp(camera.position.x, camX, 8, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, camY, 8, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, camZ, 8, dt);
        camera.lookAt(0, 0.65, 0);
        camera.fov = THREE.MathUtils.damp(camera.fov, 46, 6, dt);
        camera.updateProjectionMatrix();

        sunLight.position.set(12, 18, 12);
        sunLight.target.position.set(0, 0, 0);
      } else {
        // Gameplay Mode!
        if (activeSessionKeyRef.current !== sessionRef.current.sessionKey) {
          startGameplaySession();
        }

        const isPlaying = scr === 'playing';
        const cfg = sessionRef.current;

        if (isPlaying) {
          if (countdownRemainingSec > 0) {
            countdownRemainingSec = Math.max(0, countdownRemainingSec - Math.min(rawDt, 0.5));
            const ceilSec = Math.ceil(countdownRemainingSec);
            if (ceilSec !== lastBeepSec && ceilSec >= 0) {
              lastBeepSec = ceilSec;
              soundEngine.playCountdownBeep(ceilSec === 0);
            }
          } else {
            raceElapsedMs += dt * 1000;
          }

          const allowMove = countdownRemainingSec <= 0;

          // Build player input (Keyboard + Android Touch/Gyro merged)
          const kThrottle = keysDown.has('KeyW') || keysDown.has('ArrowUp') ? 1 : 0;
          const kBrake = keysDown.has('KeyS') || keysDown.has('ArrowDown') ? 1 : 0;
          const kLeft = keysDown.has('KeyA') || keysDown.has('ArrowLeft') ? 1 : 0;
          const kRight = keysDown.has('KeyD') || keysDown.has('ArrowRight') ? 1 : 0;
          const kHandbrake = keysDown.has('Space');
          const kNitro = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');

          const ti = touchInputRef.current;
          playerInputScratch.throttle = Math.max(kThrottle, ti.throttle);
          playerInputScratch.brake = Math.max(kBrake, ti.brake);
          playerInputScratch.steer = THREE.MathUtils.clamp((kLeft - kRight) + ti.steer, -1, 1);
          playerInputScratch.handbrake = kHandbrake || ti.handbrake;
          playerInputScratch.nitro = kNitro || ti.nitro;

          telemetryScratch.length = actors.length;
          for (let i = 0; i < actors.length; i++) {
            telemetryScratch[i] = actors[i].telemetry;
          }
          const totalLaps = cfg.mode === 'race' ? cfg.laps : 0;
          frameContactsScratch.length = 0;
          const stepOptions = {
            mode: cfg.mode,
            colliders: worldHandles?.layout.colliders,
            contactsOut: frameContactsScratch,
          };

          for (let i = 0; i < actors.length; i++) {
            const actor = actors[i];
            if (actor.isRemote) {
              const pose = interpolator.sample(actor.telemetry.id, nowMs);
              if (pose) {
                actor.telemetry.x = pose.x;
                actor.telemetry.y = pose.y;
                actor.telemetry.z = pose.z;
                actor.telemetry.vx = pose.vx;
                actor.telemetry.vy = pose.vy;
                actor.telemetry.vz = pose.vz;
                actor.telemetry.steerAngle = pose.steer;
                actor.telemetry.isNitroActive = pose.nitro;
                actor.telemetry.isBraking = pose.braking;
                actor.telemetry.isDrifting = pose.drifting;
                actor.telemetry.lap = pose.lap;
                actor.telemetry.lapProgress = pose.lapProgress;
                actor.telemetry.totalProgress = (pose.lap - 1) + pose.lapProgress;
                actor.telemetry.finished = pose.finished;
                actor.telemetry.finishTimeMs = pose.finishTimeMs;
                _quat.set(pose.qx, pose.qy, pose.qz, pose.qw);
                _euler.setFromQuaternion(_quat, 'YXZ');
                actor.telemetry.yaw = _euler.y;
                actor.telemetry.wheelRotation += (pose.wheelRpm * dt * 0.12);
              }
              continue;
            }

            const carSpec = getCarById(actor.telemetry.carId);
            const inp = actor.telemetry.isPlayer
              ? playerInputScratch
              : computeAiDriverInput(
                  actor.telemetry,
                  telemetryScratch,
                  currentTrack,
                  actor.aiLaneOffset,
                  actor.aiSkill,
                  actor.isTraffic,
                );

            stepVehiclePhysics(
              actor.telemetry,
              inp,
              carSpec,
              currentTrack,
              dt,
              raceElapsedMs,
              totalLaps,
              allowMove,
              stepOptions,
            );
          }

          // Car-vs-Car Solid Mass/Momentum Collisions + Static Contact Sparks & Audio
          const carImpact = resolveVehicleCollisions(
            telemetryScratch,
            (id) => getCarById(id).physics.massKg,
            frameContactsScratch,
          );
          let maxFrameImpact = carImpact;
          for (let c = 0; c < frameContactsScratch.length; c++) {
            const fc = frameContactsScratch[c];
            if (fc.intensity > maxFrameImpact) maxFrameImpact = fc.intensity;
            if (fc.intensity > 2.4) {
              spawnSparks(fc.x, fc.y, fc.z, fc.intensity);
            }
          }
          if (maxFrameImpact > 2.5) {
            trauma = Math.min(1, trauma + Math.min(0.55, maxFrameImpact * 0.035));
            if (nowMs - lastCollisionSoundMs > 160) {
              lastCollisionSoundMs = nowMs;
              soundEngine.playCollision(maxFrameImpact);
            }
          }

          if (cfg.mode === 'race') {
            racerScratch.length = 0;
            for (let i = 0; i < telemetryScratch.length; i++) {
              const vt = telemetryScratch[i];
              if (!vt.finished || vt.rank <= 8) racerScratch.push(vt);
            }
            updateRaceStandings(racerScratch);
          }

          // Sync meshes, drift smoke, skidmarks, and audio
          const playerActor = actors.find((a) => a.telemetry.isPlayer);

          for (let i = 0; i < actors.length; i++) {
            const a = actors[i];
            const v = a.telemetry;
            a.rig.root.position.set(v.x, v.y, v.z);
            a.rig.root.rotation.y = v.yaw;
            a.rig.updateVisualMotion(v.steerAngle, v.wheelRotation, v.pitch, v.roll, dt);
            a.rig.setLightsState(headlightsRef.current, v.isBraking, v.isNitroActive);

            if (v.isDrifting && Math.random() < 0.55) {
              const rx = Math.cos(v.yaw) * 0.85;
              const rz = -Math.sin(v.yaw) * 0.85;
              const bx = Math.sin(v.yaw) * 1.3;
              const bz = Math.cos(v.yaw) * 1.3;
              spawnSmoke(v.x - rx + bx, v.y, v.z - rz + bz);
              spawnSmoke(v.x + rx + bx, v.y, v.z + rz + bz);
              spawnSkid(v.x - rx + bx, v.y, v.z - rz + bz, v.yaw);
              spawnSkid(v.x + rx + bx, v.y, v.z + rz + bz, v.yaw);
            }
          }

          if (playerActor) {
            const pv = playerActor.telemetry;
            soundEngine.updateTelemetry(pv.rpm, pv.isDrifting, pv.isNitroActive, true);

            // Network telemetry broadcast (~22 Hz when in room)
            if (cfg.room && nowMs - lastNetEmitMs > 45) {
              lastNetEmitMs = nowMs;
              _euler.set(pv.pitch, pv.yaw, pv.roll, 'YXZ');
              _quat.setFromEuler(_euler);
              networkManager.sendMotionPacket({
                id: pv.id,
                seq: ++netSeq,
                ts: Date.now(),
                x: Number(pv.x.toFixed(3)),
                y: Number(pv.y.toFixed(3)),
                z: Number(pv.z.toFixed(3)),
                qx: Number(_quat.x.toFixed(4)),
                qy: Number(_quat.y.toFixed(4)),
                qz: Number(_quat.z.toFixed(4)),
                qw: Number(_quat.w.toFixed(4)),
                vx: Number(pv.vx.toFixed(2)),
                vy: Number(pv.vy.toFixed(2)),
                vz: Number(pv.vz.toFixed(2)),
                steer: Number(pv.steerAngle.toFixed(3)),
                wheelRpm: pv.rpm,
                nitro: pv.isNitroActive,
                braking: pv.isBraking,
                drifting: pv.isDrifting,
                lap: pv.lap,
                lapProgress: Number(pv.lapProgress.toFixed(4)),
                finished: pv.finished,
                finishTimeMs: pv.finishTimeMs,
              });
            }

            // Check Race Finish
            if (cfg.mode === 'race' && pv.finished && !raceFinishedNotified) {
              raceFinishedNotified = true;
              const finalOrder = actors
                .filter((a) => !a.isTraffic)
                .map((a) => a.telemetry)
                .sort((a, b) => a.rank - b.rank)
                .map((v) => ({
                  id: v.id,
                  name: v.name,
                  carId: v.carId,
                  isPlayer: v.isPlayer,
                  isAi: v.isAi,
                  rank: v.rank,
                  finishTimeMs: v.finishTimeMs || raceElapsedMs,
                  finished: v.finished,
                }));
              callbacksRef.current.onRaceFinished(finalOrder);
            }
          }
        } else {
          soundEngine.updateTelemetry(0, false, false, false);
        }

        // Update pooled smoke particles
        for (let i = 0; i < SMOKE_POOL_SIZE; i++) {
          const p = smokePool[i];
          if (p.active) {
            p.life += dt;
            if (p.life >= p.maxLife) {
              p.active = false;
              _dummy.position.set(0, -50, 0);
              _dummy.scale.setScalar(0.001);
            } else {
              p.x += p.vx * dt;
              p.y += p.vy * dt;
              p.z += p.vz * dt;
              const t = p.life / p.maxLife;
              const s = p.size * (1 + t * 2.2) * (1 - t * 0.4);
              _dummy.position.set(p.x, p.y, p.z);
              _dummy.quaternion.copy(camera.quaternion);
              _dummy.scale.setScalar(s);
            }
          } else {
            _dummy.position.set(0, -50, 0);
            _dummy.scale.setScalar(0.001);
          }
          _dummy.updateMatrix();
          smokeMesh.setMatrixAt(i, _dummy.matrix);
        }
        smokeMesh.instanceMatrix.needsUpdate = true;

        // Update pooled collision sparks
        for (let i = 0; i < SPARK_POOL_SIZE; i++) {
          const s = sparkPool[i];
          if (s.active) {
            s.life += dt;
            if (s.life >= s.maxLife) {
              s.active = false;
              _dummy.position.set(0, -50, 0);
              _dummy.scale.setScalar(0.001);
            } else {
              s.vy -= 18 * dt;
              s.x += s.vx * dt;
              s.y += s.vy * dt;
              s.z += s.vz * dt;
              const fade = 1 - s.life / s.maxLife;
              _dummy.position.set(s.x, s.y, s.z);
              _dummy.scale.setScalar(Math.max(0.2, fade * 1.35));
            }
          } else {
            _dummy.position.set(0, -50, 0);
            _dummy.scale.setScalar(0.001);
          }
          _dummy.updateMatrix();
          sparkMesh.setMatrixAt(i, _dummy.matrix);
        }
        sparkMesh.instanceMatrix.needsUpdate = true;

        // Fixed Medium Chase Cam / Hood / Overhead Rig (ZERO linear lerp lag & ZERO speed pullback!)
        const player = actors.find((a) => a.telemetry.isPlayer);
        if (player) {
          const pv = player.telemetry;
          const fwdX = -Math.sin(pv.yaw);
          const fwdZ = -Math.cos(pv.yaw);

          const angleMode = cameraAngleRef.current;
          if (angleMode === 'hood') {
            camera.position.set(pv.x + fwdX * 0.65, pv.y + 1.38, pv.z + fwdZ * 0.65);
            _camLook.set(pv.x + fwdX * 18, pv.y + 1.2, pv.z + fwdZ * 18);
          } else if (angleMode === 'overhead') {
            camera.position.set(pv.x - fwdX * 14, pv.y + 19, pv.z - fwdZ * 14);
            _camLook.set(pv.x + fwdX * 8, pv.y + 0.5, pv.z + fwdZ * 8);
          } else {
            // Smooth lateral yaw ONLY; lock linear distance strictly at 5.6m & height 2.2m!
            const pose = stepFixedChaseCamera(
              pv.x,
              pv.y,
              pv.z,
              pv.yaw,
              camChaseYaw,
              dt,
              _chasePoseScratch,
            );
            camChaseYaw = pose.chaseYaw;
            camera.position.set(pose.camX, pose.camY, pose.camZ);
            _camLook.set(pose.lookX, pose.lookY, pose.lookZ);
          }

          if (trauma > 0.001) {
            const shake = trauma * trauma * 0.38;
            camera.position.x += (Math.random() - 0.5) * shake;
            camera.position.y += (Math.random() - 0.5) * shake;
            trauma = Math.max(0, trauma - dt * 2.4);
          }

          camera.lookAt(_camLook);
          const targetFov = angleMode === 'hood' ? 64 : pv.isNitroActive ? 61.5 : 60;
          if (Math.abs(camera.fov - targetFov) > 0.05) {
            camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 8, dt);
            camera.updateProjectionMatrix();
          }

          // Keep directional shadow frustum centered on player
          sunLight.position.set(pv.x + 36, 58, pv.z + 28);
          sunLight.target.position.set(pv.x, 0, pv.z);
        }

        // Throttled HUD telemetry snapshot (10 Hz -> prevents 60fps React re-renders)
        if (nowMs - lastHudEmitMs >= 100 && player) {
          lastHudEmitMs = nowMs;
          const pv = player.telemetry;
          const racers = actors.filter((a) => !a.isTraffic);
          callbacksRef.current.onHudUpdate({
            speedKmh: pv.speedKmh,
            rpm: pv.rpm,
            gear: pv.gear,
            nitro: Math.round(pv.nitro),
            isDrifting: pv.isDrifting,
            isNitroActive: pv.isNitroActive,
            lap: Math.min(pv.lap, Math.max(1, cfg.laps)),
            totalLaps: cfg.mode === 'race' ? cfg.laps : 0,
            rank: pv.rank,
            totalRacers: racers.length,
            countdownSec: countdownRemainingSec > 0 ? Math.ceil(countdownRemainingSec) : -1,
            elapsedMs: raceElapsedMs,
            headlightsOn: headlightsRef.current,
            isWrongWay: pv.isWrongWay ?? false,
            minimapPoints: actors
              .filter((a) => !a.isTraffic)
              .map((a) => ({
                id: a.telemetry.id,
                x: a.telemetry.x,
                z: a.telemetry.z,
                isPlayer: a.telemetry.isPlayer,
                isFriend: a.isRemote,
                color: a.telemetry.isPlayer
                  ? '#f59e0b'
                  : a.isRemote
                    ? '#06b6d4'
                    : '#94a3b8',
              })),
            trackOutline: currentTrack.waypoints
              .filter((_, idx) => idx % 2 === 0)
              .map((w) => ({ x: w.x, z: w.z })),
          });
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (isSoftwareGl) {
      frameId = window.setTimeout(tick, 16);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      unsubMotion();
      ro.disconnect();
      domEl.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      domEl.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      soundEngine.updateTelemetry(0, false, false, false);
      if (garageCarRig) garageCarRig.dispose();
      clearActors();
      if (worldHandles) worldHandles.dispose();
      textures.dispose();
      skidGeo.dispose();
      skidMat.dispose();
      smokeGeo.dispose();
      smokeMat.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
      renderer.dispose();
      if (domEl.parentElement === container) {
        container.removeChild(domEl);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      data-testid="game-canvas-container"
      data-car-id={selectedCarId}
      data-paint-color={customization.paintColor}
      data-rim-color={customization.rimColor}
      data-underglow={customization.underglowColor}
      className="fixed inset-0 w-full h-full z-0"
    />
  );
};
