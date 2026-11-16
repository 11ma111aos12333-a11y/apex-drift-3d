import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CarCustomization, CarSpec } from '../types/game';
import { ProceduralTexturePack } from './textures';

export interface BuiltCarRig {
  root: THREE.Group;
  bodyPivot: THREE.Group; // tilts with suspension pitch & roll
  frontLeftPivot: THREE.Group;
  frontRightPivot: THREE.Group;
  wheels: THREE.Object3D[];
  paintMaterials: THREE.MeshPhysicalMaterial[];
  rimMaterials: THREE.MeshStandardMaterial[];
  glassMaterials: THREE.MeshPhysicalMaterial[];
  brakeLightMaterial: THREE.MeshStandardMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  underglowMesh: THREE.Mesh;
  underglowMaterial: THREE.MeshBasicMaterial;
  nitroFlames: THREE.Mesh[];
  applyCustomization: (c: CarCustomization) => void;
  getAppliedPaintHex: () => string;
  setLightsState: (headlightsOn: boolean, braking: boolean, nitroActive: boolean) => void;
  updateVisualMotion: (
    steerAngle: number,
    wheelRot: number,
    pitch: number,
    roll: number,
    dt: number,
  ) => void;
  dispose: () => void;
}

const gltfLoader = new GLTFLoader();
const glbCache = new Map<string, Promise<THREE.Group>>();

export function preloadLocalGlb(url: string): Promise<THREE.Group> {
  if (!glbCache.has(url)) {
    glbCache.set(
      url,
      new Promise((resolve, reject) => {
        gltfLoader.load(
          url,
          (gltf) => resolve(gltf.scene),
          undefined,
          (err) => reject(err),
        );
      }),
    );
  }
  return glbCache.get(url)!;
}

/**
 * Normalize attributes and merge BufferGeometries cleanly to slash draw calls.
 */
function mergeGeoSafe(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    if (!ng.getAttribute('uv')) {
      const count = ng.getAttribute('position').count;
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    // Strip extra attributes like tangent/color that might differ between primitives
    for (const attrName of Object.keys(ng.attributes)) {
      if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
        ng.deleteAttribute(attrName);
      }
    }
    return ng;
  });
  const merged = mergeGeometries(normalized, false);
  normalized.forEach((g) => g.dispose());
  geos.forEach((g) => g.dispose());
  return merged;
}

/**
 * Sample the dominant saturated paint swatch color from a GLB mesh's colormap texture
 * and dynamically recolor matching pixels onto a cloned CanvasTexture.
 */
function detectDominantPaintRgb(
  image: CanvasImageSource,
  uvAttr: THREE.BufferAttribute,
): [number, number, number] | null {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < uvAttr.count; i++) {
    const u = Math.max(0, Math.min(0.999, uvAttr.getX(i)));
    const v = Math.max(0, Math.min(0.999, uvAttr.getY(i)));
    const px = Math.floor(u * size);
    const py = Math.floor(v * size);
    const idx = (py * size + px) * 4;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC - minC;
    // Ignore neutral greys/blacks/whites (windows, tires, bumpers)
    if (sat < 35 || maxC < 50) continue;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const entry = buckets.get(key);
    if (entry) {
      entry.count++;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best ? [best.r, best.g, best.b] : null;
}

function buildRecoloredGlbTexture(
  baseImage: CanvasImageSource,
  sourceRgb: [number, number, number],
  targetHex: string,
  targetCanvas?: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const size = 128;
  const canvas = targetCanvas ?? document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(baseImage, 0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;

  const target = new THREE.Color(targetHex);
  const tr = Math.round(target.r * 255);
  const tg = Math.round(target.g * 255);
  const tb = Math.round(target.b * 255);
  const [sr, sg, sb] = sourceRgb;
  const srcLum = Math.max(40, (sr + sg + sb) / 3);

  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - sr;
    const dg = d[i + 1] - sg;
    const db = d[i + 2] - sb;
    if (dr * dr + dg * dg + db * db < 3600) {
      const pixLum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const shade = Math.max(0.6, Math.min(1.25, pixLum / srcLum));
      d[i] = Math.min(255, Math.round(tr * shade));
      d[i + 1] = Math.min(255, Math.round(tg * shade));
      d[i + 2] = Math.min(255, Math.round(tb * shade));
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return { canvas, texture };
}

/**
 * Build a batched multi-part sculpted 3D wheel (4 draw calls per wheel instead of 10):
 * LatheGeometry rubber tire, merged alloy rim + hub + 5 spokes, brake disc, and caliper.
 * Zero BoxGeometry!
 */
function buildSculptedWheel(
  radius: number,
  width: number,
  rimMat: THREE.MeshStandardMaterial,
  tireMat: THREE.MeshStandardMaterial,
  discMat: THREE.MeshStandardMaterial,
  caliperMat: THREE.MeshStandardMaterial,
  isLeft: boolean,
): THREE.Group {
  const wheelGroup = new THREE.Group();
  const sideSign = isLeft ? -1 : 1;
  const innerR = radius * 0.64;
  const hw = width * 0.5;

  // 1. Rubber tire outer profile via LatheGeometry
  const profile = [
    new THREE.Vector2(innerR, -hw * 0.9),
    new THREE.Vector2(radius * 0.96, -hw),
    new THREE.Vector2(radius, -hw * 0.72),
    new THREE.Vector2(radius, hw * 0.72),
    new THREE.Vector2(radius * 0.96, hw),
    new THREE.Vector2(innerR, hw * 0.9),
  ];
  const tireGeo = new THREE.LatheGeometry(profile, 20);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMesh = new THREE.Mesh(tireGeo, tireMat);
  tireMesh.castShadow = true;
  wheelGroup.add(tireMesh);

  // 2. Merged alloy rim barrel + center hub + 5 sculpted spokes (1 Draw Call!)
  const rimParts: THREE.BufferGeometry[] = [];
  const rimBarrelGeo = new THREE.CylinderGeometry(innerR, innerR, width * 0.84, 18, 1, true);
  rimBarrelGeo.rotateZ(Math.PI / 2);
  rimParts.push(rimBarrelGeo);

  const hubGeo = new THREE.CylinderGeometry(innerR * 0.28, innerR * 0.28, width * 0.65, 12);
  hubGeo.rotateZ(Math.PI / 2);
  rimParts.push(hubGeo);

  for (let s = 0; s < 5; s++) {
    const angle = (s / 5) * Math.PI * 2;
    const spokeGeo = new THREE.CylinderGeometry(0.022, 0.032, innerR * 0.92, 6);
    spokeGeo.rotateX(angle);
    spokeGeo.translate(
      sideSign * width * 0.28,
      Math.cos(angle) * innerR * 0.45,
      Math.sin(angle) * innerR * 0.45,
    );
    rimParts.push(spokeGeo);
  }
  wheelGroup.add(new THREE.Mesh(mergeGeoSafe(rimParts), rimMat));

  // 3. Ventilated brake disc
  const discGeo = new THREE.CylinderGeometry(innerR * 0.76, innerR * 0.76, 0.035, 14);
  discGeo.rotateZ(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.x = -sideSign * width * 0.08;
  wheelGroup.add(disc);

  // 4. Sculpted brake caliper arc
  const caliperGeo = new THREE.TorusGeometry(innerR * 0.65, 0.045, 6, 10, Math.PI * 0.45);
  caliperGeo.rotateY(Math.PI / 2);
  const caliper = new THREE.Mesh(caliperGeo, caliperMat);
  caliper.position.x = -sideSign * width * 0.06;
  wheelGroup.add(caliper);

  return wheelGroup;
}

/**
 * Create a curved aerodynamic chassis profile using ExtrudeGeometry + smooth bevels
 * tailored to each vehicle category (Supercar, Muscle, Rally, Hypercar, etc.).
 */
function buildSculptedBodyGeometry(car: CarSpec): {
  chassisGeo: THREE.BufferGeometry;
  cabinGeo: THREE.BufferGeometry;
  hoodGeo: THREE.BufferGeometry;
} {
  const L = car.dimensions.length;
  const W = car.dimensions.width;
  const H = car.dimensions.height;
  const halfL = L * 0.5;

  const bodyShape = new THREE.Shape();
  if (car.category === 'hypercar' || car.category === 'supercar') {
    bodyShape.moveTo(-halfL, 0.14);
    bodyShape.quadraticCurveTo(-halfL - 0.08, 0.34, -halfL + 0.55, 0.52);
    bodyShape.quadraticCurveTo(-halfL + 1.15, 0.66, -halfL + 1.55, 0.64);
    bodyShape.lineTo(halfL - 1.25, 0.72);
    bodyShape.quadraticCurveTo(halfL - 0.4, 0.76, halfL, 0.58);
    bodyShape.lineTo(halfL - 0.06, 0.18);
    bodyShape.lineTo(halfL - 0.45, 0.14);
    bodyShape.lineTo(-halfL + 0.45, 0.14);
    bodyShape.closePath();
  } else if (car.category === 'muscle') {
    bodyShape.moveTo(-halfL, 0.18);
    bodyShape.quadraticCurveTo(-halfL - 0.04, 0.52, -halfL + 0.45, 0.68);
    bodyShape.lineTo(-0.2, 0.74);
    bodyShape.lineTo(halfL - 0.65, 0.78);
    bodyShape.quadraticCurveTo(halfL + 0.04, 0.72, halfL, 0.36);
    bodyShape.lineTo(halfL - 0.3, 0.18);
    bodyShape.closePath();
  } else {
    bodyShape.moveTo(-halfL, 0.18);
    bodyShape.quadraticCurveTo(-halfL - 0.05, 0.48, -halfL + 0.42, 0.66);
    bodyShape.lineTo(-0.25, 0.74);
    bodyShape.lineTo(halfL - 0.35, 0.78);
    bodyShape.quadraticCurveTo(halfL + 0.03, 0.66, halfL, 0.3);
    bodyShape.lineTo(halfL - 0.25, 0.18);
    bodyShape.closePath();
  }

  const chassisGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: W * 0.84,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.1,
    bevelThickness: 0.11,
  });
  chassisGeo.translate(0, 0, -(W * 0.42));
  chassisGeo.rotateY(-Math.PI / 2);
  chassisGeo.computeVertexNormals();

  const cabinShape = new THREE.Shape();
  const roofTop = H;
  const cabFront = car.category === 'muscle' ? -0.35 : -0.78;
  const cabRear = car.category === 'rally' ? halfL * 0.74 : halfL * 0.56;
  cabinShape.moveTo(cabFront - 0.35, 0.62);
  cabinShape.quadraticCurveTo(cabFront + 0.2, roofTop, cabFront + 0.65, roofTop);
  cabinShape.lineTo(cabRear - 0.5, roofTop - 0.03);
  cabinShape.quadraticCurveTo(cabRear, roofTop - 0.16, cabRear + 0.35, 0.66);
  cabinShape.closePath();

  const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
    depth: W * 0.64,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.07,
    bevelThickness: 0.12,
  });
  cabinGeo.translate(0, 0, -(W * 0.32));
  cabinGeo.rotateY(-Math.PI / 2);
  cabinGeo.computeVertexNormals();

  const hoodShape = new THREE.Shape();
  hoodShape.moveTo(-halfL + 0.38, 0.56);
  hoodShape.quadraticCurveTo(-halfL + 0.9, 0.74, -0.5, 0.7);
  hoodShape.lineTo(-0.5, 0.56);
  hoodShape.closePath();

  const hoodGeo = new THREE.ExtrudeGeometry(hoodShape, {
    depth: W * 0.42,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.04,
    bevelThickness: 0.06,
  });
  hoodGeo.translate(0, 0, -(W * 0.21));
  hoodGeo.rotateY(-Math.PI / 2);
  hoodGeo.computeVertexNormals();

  return { chassisGeo, cabinGeo, hoodGeo };
}

/**
 * Create a sculpted 3D car rig with isolated cloned materials per vehicle,
 * merged geometry batches for high FPS, and dynamic GLB texture recoloring.
 */
export function buildCarRig(
  car: CarSpec,
  customization: CarCustomization,
  textures: ProceduralTexturePack,
  isSoftwareGl: boolean,
): BuiltCarRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  let latestCustomization: CarCustomization = { ...customization };
  let disposed = false;

  // Automotive clearcoat PBR paint (moderate metalness 0.32 keeps chosen paint colors vivid!)
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(customization.paintColor),
    metalness: 0.32,
    roughness: 0.24,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.15,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.carbonMap,
    metalness: 0.25,
    roughness: 0.45,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(customization.rimColor),
    metalness: 0.86,
    roughness: 0.2,
    envMapIntensity: 1.25,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    metalness: 0.05,
    roughness: 0.88,
  });

  const discMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.85,
    roughness: 0.35,
  });

  const caliperMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    metalness: 0.4,
    roughness: 0.35,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    metalness: 0.1,
    roughness: 0.08,
    clearcoat: 1.0,
    transparent: true,
    opacity: Math.max(0.35, customization.windowTint),
    transmission: isSoftwareGl ? 0 : 0.28,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xe0f2fe,
    emissiveIntensity: 1.8,
    roughness: 0.1,
  });

  const brakeLightMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: 0xef4444,
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });

  const underglowMat = new THREE.MeshBasicMaterial({
    color: customization.underglowColor === 'none' ? 0x000000 : new THREE.Color(customization.underglowColor),
    alphaMap: textures.contactShadowMap,
    transparent: true,
    opacity: customization.underglowColor === 'none' ? 0 : 0.65,
    depthWrite: false,
  });

  // Contact Shadow Disc grounded at y = 0.02
  const shadowGeo = new THREE.CircleGeometry(car.dimensions.length * 0.56, 18);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowMap,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.position.y = 0.02;
  shadowDisc.scale.set(car.dimensions.width / car.dimensions.length, 1, 1.05);
  root.add(shadowDisc);

  // Soft radial underglow halo
  const glowRingGeo = new THREE.CircleGeometry(car.dimensions.width * 0.72, 18);
  glowRingGeo.rotateX(-Math.PI / 2);
  const underglowMesh = new THREE.Mesh(glowRingGeo, underglowMat);
  underglowMesh.position.y = 0.025;
  underglowMesh.scale.set(1, 1, (car.dimensions.length / car.dimensions.width) * 0.95);
  underglowMesh.visible = customization.underglowColor !== 'none';
  root.add(underglowMesh);

  // Wheel hubs & pivots
  const frontLeftPivot = new THREE.Group();
  const frontRightPivot = new THREE.Group();
  const wheels: THREE.Object3D[] = [];

  const halfTrack = car.physics.trackWidth * 0.5;
  const frontZ = -car.physics.wheelBase * 0.48;
  const rearZ = car.physics.wheelBase * 0.48;
  const wheelY = car.physics.wheelRadius;
  const wheelW = car.category === 'suv' ? 0.34 : 0.3;

  frontLeftPivot.position.set(-halfTrack, wheelY, frontZ);
  frontRightPivot.position.set(halfTrack, wheelY, frontZ);
  root.add(frontLeftPivot, frontRightPivot);

  const flWheel = buildSculptedWheel(car.physics.wheelRadius, wheelW, rimMat, tireMat, discMat, caliperMat, true);
  const frWheel = buildSculptedWheel(car.physics.wheelRadius, wheelW, rimMat, tireMat, discMat, caliperMat, false);
  const rlWheel = buildSculptedWheel(car.physics.wheelRadius, wheelW * 1.08, rimMat, tireMat, discMat, caliperMat, true);
  const rrWheel = buildSculptedWheel(car.physics.wheelRadius, wheelW * 1.08, rimMat, tireMat, discMat, caliperMat, false);

  rlWheel.position.set(-halfTrack, wheelY, rearZ);
  rrWheel.position.set(halfTrack, wheelY, rearZ);
  frontLeftPivot.add(flWheel);
  frontRightPivot.add(frWheel);
  root.add(rlWheel, rrWheel);
  wheels.push(flWheel, frWheel, rlWheel, rrWheel);

  const proceduralShellGroup = new THREE.Group();
  bodyPivot.add(proceduralShellGroup);

  const halfW = car.dimensions.width * 0.48;
  const halfL = car.dimensions.length * 0.5;
  const { chassisGeo, cabinGeo, hoodGeo } = buildSculptedBodyGeometry(car);

  // Batch Paintable Body Geometries (Chassis + Hood + Side Mirrors -> 1 Draw Call!)
  const paintParts: THREE.BufferGeometry[] = [];
  chassisGeo.translate(0, car.physics.rideHeight, 0);
  paintParts.push(chassisGeo);

  hoodGeo.translate(0, car.physics.rideHeight, 0);
  paintParts.push(hoodGeo);

  const lMirrorGeo = new THREE.ConeGeometry(0.08, 0.18, 6);
  lMirrorGeo.rotateZ(Math.PI / 2);
  lMirrorGeo.translate(-halfW - 0.04, car.physics.rideHeight + 0.76, -0.45);
  paintParts.push(lMirrorGeo);

  const rMirrorGeo = new THREE.ConeGeometry(0.08, 0.18, 6);
  rMirrorGeo.rotateZ(Math.PI / 2);
  rMirrorGeo.rotateY(Math.PI);
  rMirrorGeo.translate(halfW + 0.04, car.physics.rideHeight + 0.76, -0.45);
  paintParts.push(rMirrorGeo);

  const bodyMesh = new THREE.Mesh(mergeGeoSafe(paintParts), paintMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  proceduralShellGroup.add(bodyMesh);

  // Cabin glass
  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.position.y = car.physics.rideHeight;
  cabinMesh.renderOrder = 2;
  proceduralShellGroup.add(cabinMesh);

  // Batch Interior Seats (1 Draw Call)
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 });
  const seatParts: THREE.BufferGeometry[] = [];
  for (const sx of [-0.32, 0.32]) {
    const sg = new THREE.LatheGeometry(
      [new THREE.Vector2(0.01, 0), new THREE.Vector2(0.22, 0.08), new THREE.Vector2(0.18, 0.55), new THREE.Vector2(0.05, 0.65)],
      8,
    );
    sg.translate(sx, car.physics.rideHeight + 0.28, 0.15);
    seatParts.push(sg);
  }
  proceduralShellGroup.add(new THREE.Mesh(mergeGeoSafe(seatParts), seatMat));

  // Batch Carbon Aero Kit (Spoiler + Pylons + Front Splitter + Rear Diffuser + Steering Wheel -> 1 Draw Call!)
  const carbonParts: THREE.BufferGeometry[] = [];
  const swGeo = new THREE.TorusGeometry(0.14, 0.022, 6, 12);
  swGeo.rotateX(0.45);
  swGeo.translate(-0.32, car.physics.rideHeight + 0.68, -0.38);
  carbonParts.push(swGeo);

  if (car.category !== 'suv') {
    const wingShape = new THREE.Shape();
    wingShape.moveTo(-0.18, 0);
    wingShape.quadraticCurveTo(0, 0.06, 0.22, 0.01);
    wingShape.lineTo(0.2, -0.03);
    wingShape.closePath();

    const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
      depth: car.dimensions.width * 0.88,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.015,
      bevelThickness: 0.02,
    });
    wingGeo.translate(0, 0, -car.dimensions.width * 0.44);
    wingGeo.rotateY(-Math.PI / 2);
    const wingY = car.physics.rideHeight + (car.category === 'hypercar' || car.category === 'rally' ? 1.02 : 0.92);
    wingGeo.translate(0, wingY, halfL - 0.18);
    carbonParts.push(wingGeo);

    for (const sx of [-0.36, 0.36]) {
      const pylonCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx, car.physics.rideHeight + 0.72, halfL - 0.25),
        new THREE.Vector3(sx, wingY - 0.02, halfL - 0.18),
      ]);
      carbonParts.push(new THREE.TubeGeometry(pylonCurve, 4, 0.028, 6, false));
    }
  }

  const splitterShape = new THREE.Shape();
  splitterShape.moveTo(-0.35, 0);
  splitterShape.quadraticCurveTo(0, 0.04, 0.25, 0);
  splitterShape.lineTo(0.25, -0.04);
  splitterShape.lineTo(-0.35, -0.02);
  splitterShape.closePath();
  const splitterGeo = new THREE.ExtrudeGeometry(splitterShape, {
    depth: car.dimensions.width * 0.9,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.015,
    bevelThickness: 0.02,
  });
  splitterGeo.translate(0, 0, -car.dimensions.width * 0.45);
  splitterGeo.rotateY(-Math.PI / 2);
  splitterGeo.translate(0, car.physics.rideHeight + 0.14, -halfL + 0.1);
  carbonParts.push(splitterGeo);

  const diffuserShape = new THREE.Shape();
  diffuserShape.moveTo(-0.22, 0);
  diffuserShape.lineTo(0.16, 0.08);
  diffuserShape.lineTo(0.16, 0.28);
  diffuserShape.lineTo(-0.22, 0.2);
  diffuserShape.closePath();
  const diffuserGeo = new THREE.ExtrudeGeometry(diffuserShape, {
    depth: car.dimensions.width * 0.72,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.02,
    bevelThickness: 0.02,
  });
  diffuserGeo.translate(0, 0, -car.dimensions.width * 0.36);
  diffuserGeo.rotateY(-Math.PI / 2);
  diffuserGeo.translate(0, car.physics.rideHeight + 0.08, halfL - 0.06);
  carbonParts.push(diffuserGeo);

  const carbonMesh = new THREE.Mesh(mergeGeoSafe(carbonParts), carbonMat);
  carbonMesh.castShadow = true;
  proceduralShellGroup.add(carbonMesh);

  // Batch Headlights (1 Draw Call) & Taillights + Tail Bar (1 Draw Call)
  const hlParts: THREE.BufferGeometry[] = [];
  const tlParts: THREE.BufferGeometry[] = [];
  for (const sx of [-halfW * 0.68, halfW * 0.68]) {
    const hlGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.26, 8);
    hlGeo.rotateZ(Math.PI / 2);
    hlGeo.translate(sx, car.physics.rideHeight + 0.42, -halfL + 0.06);
    hlParts.push(hlGeo);

    const tlGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.26, 8);
    tlGeo.rotateZ(Math.PI / 2);
    tlGeo.translate(sx, car.physics.rideHeight + 0.56, halfL - 0.01);
    tlParts.push(tlGeo);
  }
  const tailBarGeo = new THREE.CylinderGeometry(0.024, 0.024, car.dimensions.width * 0.72, 6);
  tailBarGeo.rotateZ(Math.PI / 2);
  tailBarGeo.translate(0, car.physics.rideHeight + 0.56, halfL);
  tlParts.push(tailBarGeo);

  proceduralShellGroup.add(new THREE.Mesh(mergeGeoSafe(hlParts), headlightMat));
  proceduralShellGroup.add(new THREE.Mesh(mergeGeoSafe(tlParts), brakeLightMat));

  // Batch Exhaust Pipes (1 Draw Call) + Dual-Layer Nitro Plumes
  const pipeParts: THREE.BufferGeometry[] = [];
  const outerFlameGeo = new THREE.ConeGeometry(0.095, 0.85, 10);
  outerFlameGeo.rotateX(Math.PI / 2);
  const innerFlameGeo = new THREE.ConeGeometry(0.055, 0.58, 8);
  innerFlameGeo.rotateX(Math.PI / 2);

  const outerFlameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const innerFlameMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const nitroFlames: THREE.Mesh[] = [];

  for (const sx of [-0.32, 0.32]) {
    const pipeGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.22, 10);
    pipeGeo.rotateX(Math.PI / 2);
    pipeGeo.translate(sx, car.physics.rideHeight + 0.2, halfL + 0.02);
    pipeParts.push(pipeGeo);

    const outerFlame = new THREE.Mesh(outerFlameGeo, outerFlameMat);
    outerFlame.position.set(sx, car.physics.rideHeight + 0.2, halfL + 0.45);
    outerFlame.visible = false;
    bodyPivot.add(outerFlame);
    nitroFlames.push(outerFlame);

    const innerFlame = new THREE.Mesh(innerFlameGeo, innerFlameMat);
    innerFlame.position.set(sx, car.physics.rideHeight + 0.2, halfL + 0.32);
    innerFlame.visible = false;
    bodyPivot.add(innerFlame);
    nitroFlames.push(innerFlame);
  }
  proceduralShellGroup.add(new THREE.Mesh(mergeGeoSafe(pipeParts), discMat));

  // Dynamic GLB Paint Support (for dune-titan-4x4 & kuro-tuner)
  let glbRecolorFn: ((paintHex: string) => void) | null = null;
  let glbClonedTexture: THREE.Texture | null = null;
  let lastGlbPaintHex = '';

  if (car.glbModel) {
    preloadLocalGlb(car.glbModel)
      .then((srcScene) => {
        if (disposed) return;
        const clone = srcScene.clone(true);
        const recolorState: {
          baseImg: CanvasImageSource | null;
          dominantRgb: [number, number, number] | null;
          mats: THREE.MeshStandardMaterial[];
        } = {
          baseImg: null,
          dominantRgb: null,
          mats: [],
        };
        const recolorCanvas = document.createElement('canvas');

        clone.traverse((child) => {
          if (child.name.startsWith('wheel-')) {
            child.visible = false;
            return;
          }
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh;
            m.castShadow = true;
            m.receiveShadow = true;
            const origMat = m.material as THREE.MeshStandardMaterial;
            if (origMat) {
              // Clone material per car instance so vehicles never share colors/textures!
              const instMat = origMat.clone();
              instMat.roughness = 0.28;
              instMat.metalness = 0.22;
              m.material = instMat;

              if (origMat.map?.image) {
                recolorState.mats.push(instMat);
                if (!recolorState.dominantRgb) {
                  const uvAttr = m.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
                  if (uvAttr) {
                    recolorState.baseImg = origMat.map.image as CanvasImageSource;
                    recolorState.dominantRgb = detectDominantPaintRgb(recolorState.baseImg, uvAttr);
                  }
                }
              }
            }
          }
        });

        clone.rotation.y = Math.PI;
        const box = new THREE.Box3().setFromObject(clone);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = car.dimensions.length / Math.max(0.1, size.z);
        clone.scale.setScalar(scale);
        clone.position.set(
          -center.x * scale,
          car.physics.rideHeight - box.min.y * scale - 0.02,
          -center.z * scale,
        );

        if (recolorState.baseImg && recolorState.dominantRgb && recolorState.mats.length > 0) {
          const capturedImg = recolorState.baseImg;
          const capturedRgb = recolorState.dominantRgb;
          const capturedMats = recolorState.mats;
          glbRecolorFn = (paintHex: string) => {
            if (lastGlbPaintHex === paintHex) return;
            lastGlbPaintHex = paintHex;
            const { texture } = buildRecoloredGlbTexture(capturedImg, capturedRgb, paintHex, recolorCanvas);
            if (glbClonedTexture) glbClonedTexture.dispose();
            glbClonedTexture = texture;
            for (const mat of capturedMats) {
              mat.map = texture;
              mat.needsUpdate = true;
            }
          };
          glbRecolorFn(latestCustomization.paintColor);
        }

        proceduralShellGroup.visible = false;
        bodyPivot.add(clone);
      })
      .catch(() => {
        // Keep sculpted procedural bodywork seamlessly if GLB fails
      });
  }

  const paintMaterials = [paintMat];
  const rimMaterials = [rimMat];
  const glassMaterials = [glassMat];

  const applyCustomization = (c: CarCustomization) => {
    latestCustomization = { ...c };
    paintMaterials.forEach((m) => {
      m.color.set(c.paintColor);
      m.needsUpdate = true;
    });
    rimMaterials.forEach((m) => {
      m.color.set(c.rimColor);
      m.needsUpdate = true;
    });
    glassMaterials.forEach((m) => {
      m.opacity = Math.max(0.32, c.windowTint);
      m.needsUpdate = true;
    });
    if (c.underglowColor === 'none') {
      underglowMat.opacity = 0;
      underglowMesh.visible = false;
    } else {
      underglowMesh.visible = true;
      underglowMat.color.set(c.underglowColor);
      underglowMat.opacity = 0.5;
    }
    if (glbRecolorFn) {
      glbRecolorFn(c.paintColor);
    }
  };

  return {
    root,
    bodyPivot,
    frontLeftPivot,
    frontRightPivot,
    wheels,
    paintMaterials,
    rimMaterials,
    glassMaterials,
    brakeLightMaterial: brakeLightMat,
    headlightMaterial: headlightMat,
    underglowMesh,
    underglowMaterial: underglowMat,
    nitroFlames,
    applyCustomization,
    getAppliedPaintHex: () => '#' + paintMat.color.getHexString(),
    setLightsState: (headlightsOn: boolean, braking: boolean, nitroActive: boolean) => {
      headlightMat.emissiveIntensity = headlightsOn ? 2.4 : 0.7;
      brakeLightMat.emissiveIntensity = braking ? 3.2 : 0.65;
      for (let i = 0; i < nitroFlames.length; i++) {
        nitroFlames[i].visible = nitroActive;
        if (nitroActive) {
          const pulse = 0.8 + Math.random() * 0.55;
          nitroFlames[i].scale.set(1, pulse, 1);
        }
      }
    },
    updateVisualMotion: (
      steerAngle: number,
      wheelRot: number,
      pitch: number,
      roll: number,
    ) => {
      frontLeftPivot.rotation.y = steerAngle;
      frontRightPivot.rotation.y = steerAngle;
      for (let i = 0; i < wheels.length; i++) {
        wheels[i].rotation.x = -wheelRot;
      }
      bodyPivot.rotation.x = pitch;
      bodyPivot.rotation.z = roll;
    },
    dispose: () => {
      disposed = true;
      if (glbClonedTexture) glbClonedTexture.dispose();
      root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material?.dispose();
          }
        }
      });
    },
  };
}
