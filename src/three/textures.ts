import * as THREE from 'three';

export interface ProceduralTexturePack {
  asphaltMap: THREE.CanvasTexture;
  asphaltBump: THREE.CanvasTexture;
  desertMap: THREE.Texture;
  desertBump: THREE.CanvasTexture;
  coastalGroundMap: THREE.CanvasTexture;
  cityGroundMap: THREE.CanvasTexture;
  gpCurbMap: THREE.CanvasTexture;
  carbonMap: THREE.CanvasTexture;
  buildingFacadeMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  smokeMap: THREE.CanvasTexture;
  skyMap: THREE.Texture;
  nightSkyMap: THREE.CanvasTexture;
  daySkyMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTexturePack(
  renderer: THREE.WebGLRenderer,
): ProceduralTexturePack {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
  const loader = new THREE.TextureLoader();

  // 1. Asphalt Road Albedo + Dashed Lane Markings
  const roadCanvas = document.createElement('canvas');
  roadCanvas.width = 512;
  roadCanvas.height = 512;
  const rCtx = roadCanvas.getContext('2d')!;
  rCtx.fillStyle = '#252830';
  rCtx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 16000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 26 + Math.floor(Math.random() * 34);
    rCtx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    rCtx.fillRect(x, y, 2, 2);
  }

  rCtx.fillStyle = 'rgba(14, 16, 20, 0.28)';
  rCtx.fillRect(105, 0, 48, 512);
  rCtx.fillRect(359, 0, 48, 512);

  rCtx.fillStyle = '#e2e8f0';
  rCtx.fillRect(18, 0, 10, 512);
  rCtx.fillRect(484, 0, 10, 512);

  rCtx.fillStyle = '#f59e0b';
  for (let y = 16; y < 512; y += 96) {
    rCtx.fillRect(247, y, 6, 52);
    rCtx.fillRect(259, y, 6, 52);
  }

  const asphaltMap = new THREE.CanvasTexture(roadCanvas);
  asphaltMap.colorSpace = THREE.SRGBColorSpace;
  asphaltMap.wrapS = THREE.RepeatWrapping;
  asphaltMap.wrapT = THREE.RepeatWrapping;
  asphaltMap.anisotropy = maxAniso;

  // 2. Asphalt Bump/Micro-Relief Map
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bCtx = bumpCanvas.getContext('2d')!;
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const g = 90 + Math.floor(Math.random() * 85);
    bCtx.fillStyle = `rgb(${g},${g},${g})`;
    bCtx.fillRect(x, y, 2, 2);
  }
  const asphaltBump = new THREE.CanvasTexture(bumpCanvas);
  asphaltBump.wrapS = THREE.RepeatWrapping;
  asphaltBump.wrapT = THREE.RepeatWrapping;
  asphaltBump.anisotropy = maxAniso;

  // 3. Desert Sand Texture (generated image asset + procedural bump)
  const desertMap = loader.load('/src/assets/images/tex_desert_sand_1794739999300.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(28, 28);
    tex.anisotropy = maxAniso;
    tex.needsUpdate = true;
  });
  desertMap.colorSpace = THREE.SRGBColorSpace;
  desertMap.wrapS = THREE.RepeatWrapping;
  desertMap.wrapT = THREE.RepeatWrapping;
  desertMap.repeat.set(28, 28);

  const desertBump = new THREE.CanvasTexture(bumpCanvas);
  desertBump.wrapS = THREE.RepeatWrapping;
  desertBump.wrapT = THREE.RepeatWrapping;
  desertBump.repeat.set(28, 28);

  // 3b. Coastal / Stadium Lush Green Grass Texture
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = 256;
  grassCanvas.height = 256;
  const gCtx = grassCanvas.getContext('2d')!;
  gCtx.fillStyle = '#2d5a36';
  gCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const g = 75 + Math.floor(Math.random() * 48);
    gCtx.fillStyle = `rgb(${36 + (i % 14)},${g},${42 + (i % 12)})`;
    gCtx.fillRect(x, y, 2, 2);
  }
  const coastalGroundMap = new THREE.CanvasTexture(grassCanvas);
  coastalGroundMap.colorSpace = THREE.SRGBColorSpace;
  coastalGroundMap.wrapS = THREE.RepeatWrapping;
  coastalGroundMap.wrapT = THREE.RepeatWrapping;
  coastalGroundMap.repeat.set(34, 34);
  coastalGroundMap.anisotropy = maxAniso;

  // 3c. Night City Urban Concrete Plaza Texture
  const cityCanvas = document.createElement('canvas');
  cityCanvas.width = 256;
  cityCanvas.height = 256;
  const uCtx = cityCanvas.getContext('2d')!;
  uCtx.fillStyle = '#151923';
  uCtx.fillRect(0, 0, 256, 256);
  uCtx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
  uCtx.lineWidth = 2;
  for (let p = 0; p < 256; p += 64) {
    uCtx.beginPath();
    uCtx.moveTo(p, 0);
    uCtx.lineTo(p, 256);
    uCtx.moveTo(0, p);
    uCtx.lineTo(256, p);
    uCtx.stroke();
  }
  const cityGroundMap = new THREE.CanvasTexture(cityCanvas);
  cityGroundMap.colorSpace = THREE.SRGBColorSpace;
  cityGroundMap.wrapS = THREE.RepeatWrapping;
  cityGroundMap.wrapT = THREE.RepeatWrapping;
  cityGroundMap.repeat.set(36, 36);
  cityGroundMap.anisotropy = maxAniso;

  // 3d. FIA Red & White Grand Prix Curb Texture
  const curbCanvas = document.createElement('canvas');
  curbCanvas.width = 128;
  curbCanvas.height = 128;
  const cbCtx = curbCanvas.getContext('2d')!;
  cbCtx.fillStyle = '#ef4444';
  cbCtx.fillRect(0, 0, 128, 64);
  cbCtx.fillStyle = '#f8fafc';
  cbCtx.fillRect(0, 64, 128, 64);
  const gpCurbMap = new THREE.CanvasTexture(curbCanvas);
  gpCurbMap.colorSpace = THREE.SRGBColorSpace;
  gpCurbMap.wrapS = THREE.RepeatWrapping;
  gpCurbMap.wrapT = THREE.RepeatWrapping;
  gpCurbMap.repeat.set(140, 1);

  // 4. Carbon Fiber Weave Texture
  const carbonCanvas = document.createElement('canvas');
  carbonCanvas.width = 64;
  carbonCanvas.height = 64;
  const cCtx = carbonCanvas.getContext('2d')!;
  cCtx.fillStyle = '#14161a';
  cCtx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) {
    for (let x = 0; x < 64; x += 8) {
      cCtx.fillStyle = ((x + y) / 8) % 2 === 0 ? '#272a33' : '#1b1d24';
      cCtx.fillRect(x, y, 7, 7);
    }
  }
  const carbonMap = new THREE.CanvasTexture(carbonCanvas);
  carbonMap.colorSpace = THREE.SRGBColorSpace;
  carbonMap.wrapS = THREE.RepeatWrapping;
  carbonMap.wrapT = THREE.RepeatWrapping;
  carbonMap.repeat.set(6, 6);

  // 5. Modern Architectural Curtain-Wall Facade Texture
  const facCanvas = document.createElement('canvas');
  facCanvas.width = 256;
  facCanvas.height = 512;
  const fCtx = facCanvas.getContext('2d')!;
  fCtx.fillStyle = '#182130';
  fCtx.fillRect(0, 0, 256, 512);
  for (let row = 16; row < 496; row += 42) {
    fCtx.fillStyle = '#0f172a';
    fCtx.fillRect(0, row - 6, 256, 6);
    for (let col = 12; col < 244; col += 38) {
      const lit = ((row * 7 + col * 13) % 11) > 3;
      fCtx.fillStyle = lit
        ? ((row + col) % 5 === 0 ? '#fde68a' : '#7dd3fc')
        : '#1e293b';
      fCtx.fillRect(col, row, 28, 28);
    }
  }
  const buildingFacadeMap = new THREE.CanvasTexture(facCanvas);
  buildingFacadeMap.colorSpace = THREE.SRGBColorSpace;
  buildingFacadeMap.wrapS = THREE.RepeatWrapping;
  buildingFacadeMap.wrapT = THREE.RepeatWrapping;
  buildingFacadeMap.repeat.set(0.055, 0.038);
  buildingFacadeMap.anisotropy = maxAniso;

  // 6. Soft Radial Contact Shadow Disc
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sCtx = shadowCanvas.getContext('2d')!;
  const grad = sCtx.createRadialGradient(64, 64, 12, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 128, 128);
  const contactShadowMap = new THREE.CanvasTexture(shadowCanvas);

  // 7. Tire Drift Smoke Puff Sprite
  const smokeCanvas = document.createElement('canvas');
  smokeCanvas.width = 128;
  smokeCanvas.height = 128;
  const smCtx = smokeCanvas.getContext('2d')!;
  const smGrad = smCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  smGrad.addColorStop(0, 'rgba(226, 232, 240, 0.65)');
  smGrad.addColorStop(0.5, 'rgba(203, 213, 225, 0.3)');
  smGrad.addColorStop(1, 'rgba(203, 213, 225, 0)');
  smCtx.fillStyle = smGrad;
  smCtx.fillRect(0, 0, 128, 128);
  const smokeMap = new THREE.CanvasTexture(smokeCanvas);

  // 8. Panoramic Desert Sunset Sky Backdrop
  const skyMap = loader.load('/src/assets/images/skybox_horizon_panorama_1794740000305.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
  });
  skyMap.colorSpace = THREE.SRGBColorSpace;

  // 9. Starry Neon Night City Sky Dome
  const nSkyCanvas = document.createElement('canvas');
  nSkyCanvas.width = 512;
  nSkyCanvas.height = 256;
  const nCtx = nSkyCanvas.getContext('2d')!;
  const nGrad = nCtx.createLinearGradient(0, 0, 0, 256);
  nGrad.addColorStop(0, '#020617');
  nGrad.addColorStop(0.52, '#0f172a');
  nGrad.addColorStop(0.82, '#1e1b4b');
  nGrad.addColorStop(1, '#312e81');
  nCtx.fillStyle = nGrad;
  nCtx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 240; i++) {
    const sx = (i * 197) % 512;
    const sy = (i * 89) % 130;
    nCtx.fillStyle = i % 7 === 0 ? '#7dd3fc' : '#f8fafc';
    nCtx.fillRect(sx, sy, i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1);
  }
  const nightSkyMap = new THREE.CanvasTexture(nSkyCanvas);
  nightSkyMap.colorSpace = THREE.SRGBColorSpace;

  // 10. Crisp Daytime Coastal / Grand Prix Sky Dome
  const dSkyCanvas = document.createElement('canvas');
  dSkyCanvas.width = 512;
  dSkyCanvas.height = 256;
  const dCtx = dSkyCanvas.getContext('2d')!;
  const dGrad = dCtx.createLinearGradient(0, 0, 0, 256);
  dGrad.addColorStop(0, '#0369a1');
  dGrad.addColorStop(0.45, '#38bdf8');
  dGrad.addColorStop(0.75, '#bae6fd');
  dGrad.addColorStop(1, '#f0f9ff');
  dCtx.fillStyle = dGrad;
  dCtx.fillRect(0, 0, 512, 256);
  dCtx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  for (let i = 0; i < 16; i++) {
    const cx = (i * 73) % 512;
    const cy = 62 + (i % 4) * 18;
    dCtx.beginPath();
    dCtx.ellipse(cx, cy, 42, 11, 0, 0, Math.PI * 2);
    dCtx.fill();
  }
  const daySkyMap = new THREE.CanvasTexture(dSkyCanvas);
  daySkyMap.colorSpace = THREE.SRGBColorSpace;

  return {
    asphaltMap,
    asphaltBump,
    desertMap,
    desertBump,
    coastalGroundMap,
    cityGroundMap,
    gpCurbMap,
    carbonMap,
    buildingFacadeMap,
    contactShadowMap,
    smokeMap,
    skyMap,
    nightSkyMap,
    daySkyMap,
    dispose: () => {
      asphaltMap.dispose();
      asphaltBump.dispose();
      desertMap.dispose();
      desertBump.dispose();
      coastalGroundMap.dispose();
      cityGroundMap.dispose();
      gpCurbMap.dispose();
      carbonMap.dispose();
      buildingFacadeMap.dispose();
      contactShadowMap.dispose();
      smokeMap.dispose();
      skyMap.dispose();
      nightSkyMap.dispose();
      daySkyMap.dispose();
    },
  };
}
