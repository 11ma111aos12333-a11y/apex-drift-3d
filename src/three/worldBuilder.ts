import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GameMode, StuntRamp, TrackSpec } from '../types/game';
import { sampleSurfaceAt } from '../game/physics';
import { generateWorldLayout, WorldLayout } from '../game/colliders';
import { ProceduralTexturePack } from './textures';
import { preloadLocalGlb } from './carBuilder';

export interface WorldHandles {
  worldGroup: THREE.Group;
  garageGroup: THREE.Group;
  layout: WorldLayout;
  dispose: () => void;
}

/**
 * Normalize BufferGeometry attributes and optionally bake vertex colors before merging
 * so all static architectural landmarks render in minimum draw calls.
 */
function mergeWorldGeos(
  geos: THREE.BufferGeometry[],
  vertexColorHexes?: number[],
): THREE.BufferGeometry {
  const color = new THREE.Color();
  const normalized = geos.map((g, idx) => {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    if (!ng.getAttribute('uv')) {
      const count = ng.getAttribute('position').count;
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    for (const attrName of Object.keys(ng.attributes)) {
      if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
        ng.deleteAttribute(attrName);
      }
    }
    if (vertexColorHexes && vertexColorHexes[idx] !== undefined) {
      color.setHex(vertexColorHexes[idx]);
      const count = ng.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) {
        colors[k * 3] = color.r;
        colors[k * 3 + 1] = color.g;
        colors[k * 3 + 2] = color.b;
      }
      ng.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    return ng;
  });
  const merged = mergeGeometries(normalized, false);
  normalized.forEach((g) => g.dispose());
  geos.forEach((g) => g.dispose());
  return merged;
}

/**
 * Build closed-loop 3D asphalt road ribbon, FIA/standard curbs, start/finish gantry,
 * and continuous double-rail Race Guardrails when mode === 'race'.
 * Zero BoxGeometry!
 */
function buildTrackRoadMesh(
  track: TrackSpec,
  textures: ProceduralTexturePack,
  mode: GameMode,
): THREE.Group {
  const group = new THREE.Group();
  const wps = track.waypoints;
  const n = wps.length;
  if (n < 3) return group;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const leftCurbPts: THREE.Vector3[] = [];
  const rightCurbPts: THREE.Vector3[] = [];
  const leftGuardPts: THREE.Vector3[] = [];
  const rightGuardPts: THREE.Vector3[] = [];

  let accumDist = 0;
  for (let i = 0; i <= n; i++) {
    const curr = wps[i % n];
    const next = wps[(i + 1) % n];
    const prev = wps[(i - 1 + n) % n];

    if (i > 0) {
      accumDist += Math.hypot(curr.x - prev.x, curr.z - prev.z);
    }

    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const rx = -tz / len;
    const rz = tx / len;

    const hw = curr.width * 0.52;
    const y = 0.04;

    positions.push(curr.x - rx * hw, y, curr.z - rz * hw);
    positions.push(curr.x + rx * hw, y, curr.z + rz * hw);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, accumDist / 16);
    uvs.push(1, accumDist / 16);

    if (i < n) {
      leftCurbPts.push(new THREE.Vector3(curr.x - rx * (hw + 0.3), 0.12, curr.z - rz * (hw + 0.3)));
      rightCurbPts.push(new THREE.Vector3(curr.x + rx * (hw + 0.3), 0.12, curr.z + rz * (hw + 0.3)));
      leftGuardPts.push(new THREE.Vector3(curr.x - rx * (hw + 0.55), 0.72, curr.z - rz * (hw + 0.55)));
      rightGuardPts.push(new THREE.Vector3(curr.x + rx * (hw + 0.55), 0.72, curr.z + rz * (hw + 0.55)));
    }

    if (i < n) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roadGeo.setIndex(indices);

  const isNight = track.envTheme === 'night-city';
  const roadMat = new THREE.MeshStandardMaterial({
    color: track.envTheme === 'desert' ? 0xd9cbb8 : 0xffffff,
    map: textures.asphaltMap,
    bumpMap: textures.asphaltBump,
    bumpScale: 0.04,
    roughness: isNight ? 0.34 : 0.76,
    metalness: isNight ? 0.24 : 0.08,
  });

  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Merge Left + Right Curbs into 1 Draw Call
  const isGp = track.envTheme === 'grand-prix';
  const curbMat = isGp
    ? new THREE.MeshStandardMaterial({
        map: textures.gpCurbMap,
        roughness: 0.45,
        metalness: 0.1,
      })
    : new THREE.MeshStandardMaterial({
        color: isNight ? 0x0ea5e9 : track.envTheme === 'desert' ? 0xb45309 : 0xcbd5e1,
        emissive: isNight ? 0x0284c7 : 0x000000,
        emissiveIntensity: isNight ? 0.55 : 0,
        roughness: 0.5,
        metalness: 0.35,
      });

  const curbGeo = mergeWorldGeos([
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leftCurbPts, true), n * 2, 0.28, 5, true),
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rightCurbPts, true), n * 2, 0.28, 5, true),
  ]);
  const curbsMesh = new THREE.Mesh(curbGeo, curbMat);
  curbsMesh.receiveShadow = true;
  group.add(curbsMesh);

  // Continuous Solid 3D Race Guardrails (ONLY in Race Mode -> batched into 3 Draw Calls!)
  if (mode === 'race') {
    const railColor = isNight ? 0x38bdf8 : isGp ? 0xef4444 : 0xe2e8f0;
    const railMat = new THREE.MeshStandardMaterial({
      color: railColor,
      emissive: isNight ? 0x0284c7 : 0x000000,
      emissiveIntensity: isNight ? 0.65 : 0,
      metalness: 0.65,
      roughness: 0.3,
    });

    const topRailsGeo = mergeWorldGeos([
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leftGuardPts, true), n * 2, 0.14, 5, true),
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rightGuardPts, true), n * 2, 0.14, 5, true),
    ]);
    group.add(new THREE.Mesh(topRailsGeo, railMat));

    const leftLowPts = leftGuardPts.map((p) => new THREE.Vector3(p.x, 0.38, p.z));
    const rightLowPts = rightGuardPts.map((p) => new THREE.Vector3(p.x, 0.38, p.z));
    const lowMat = new THREE.MeshStandardMaterial({
      color: isGp ? 0xf8fafc : 0x475569,
      metalness: 0.55,
      roughness: 0.4,
    });
    const lowRailsGeo = mergeWorldGeos([
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leftLowPts, true), n * 2, 0.12, 5, true),
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rightLowPts, true), n * 2, 0.12, 5, true),
    ]);
    group.add(new THREE.Mesh(lowRailsGeo, lowMat));

    const postCount = leftGuardPts.length * 2;
    const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.9, 5);
    postGeo.translate(0, 0.45, 0);
    const postInst = new THREE.InstancedMesh(postGeo, lowMat, postCount);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = 0; i < leftGuardPts.length; i++) {
      dummy.position.set(leftGuardPts[i].x, 0, leftGuardPts[i].z);
      dummy.updateMatrix();
      postInst.setMatrixAt(idx++, dummy.matrix);

      dummy.position.set(rightGuardPts[i].x, 0, rightGuardPts[i].z);
      dummy.updateMatrix();
      postInst.setMatrixAt(idx++, dummy.matrix);
    }
    postInst.instanceMatrix.needsUpdate = true;
    postInst.computeBoundingSphere();
    group.add(postInst);
  }

  // Night City Illuminated Curved Neon Tunnel (Batched into 2 Draw Calls!)
  if (isNight && n > 10) {
    const archMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.7,
      roughness: 0.35,
    });
    const neonRibMat = new THREE.MeshBasicMaterial({ color: 0xec4899 });
    const outerArches: THREE.BufferGeometry[] = [];
    const neonRibs: THREE.BufferGeometry[] = [];

    for (let i = 2; i <= 5; i++) {
      const a = wps[i];
      const b = wps[(i + 1) % n];
      const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
      const hw = a.width * 0.56;
      const ribCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-hw, 0, 0),
        new THREE.Vector3(-hw * 0.92, 5.6, 0),
        new THREE.Vector3(0, 7.2, 0),
        new THREE.Vector3(hw * 0.92, 5.6, 0),
        new THREE.Vector3(hw, 0, 0),
      ]);
      const outer = new THREE.TubeGeometry(ribCurve, 14, 0.32, 6, false);
      outer.rotateY(yaw);
      outer.translate(a.x, 0, a.z);
      outerArches.push(outer);

      const inner = new THREE.TubeGeometry(ribCurve, 14, 0.14, 5, false);
      inner.rotateY(yaw);
      inner.translate(a.x, 0, a.z);
      neonRibs.push(inner);
    }
    group.add(new THREE.Mesh(mergeWorldGeos(outerArches), archMat));
    group.add(new THREE.Mesh(mergeWorldGeos(neonRibs), neonRibMat));
  }

  // Start / Finish Archway at waypoint 0
  const wp0 = wps[0];
  const wp1 = wps[1];
  const yaw = Math.atan2(-(wp1.x - wp0.x), -(wp1.z - wp0.z));
  const archGroup = new THREE.Group();
  archGroup.position.set(wp0.x, 0, wp0.z);
  archGroup.rotation.y = yaw;

  const archCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-track.roadWidth * 0.58, 0, 0),
    new THREE.Vector3(-track.roadWidth * 0.54, 6.4, 0),
    new THREE.Vector3(0, 7.6, 0),
    new THREE.Vector3(track.roadWidth * 0.54, 6.4, 0),
    new THREE.Vector3(track.roadWidth * 0.58, 0, 0),
  ]);
  const archMat = new THREE.MeshStandardMaterial({
    color: isGp ? 0xef4444 : isNight ? 0x06b6d4 : 0xf59e0b,
    metalness: 0.7,
    roughness: 0.25,
    emissive: isGp ? 0x7f1d1d : isNight ? 0x0891b2 : 0x78350f,
    emissiveIntensity: isNight ? 1.1 : 0.45,
  });
  const archMesh = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 18, 0.36, 8, false), archMat);
  archGroup.add(archMesh);

  const lineShape = new THREE.Shape();
  const hw = track.roadWidth * 0.48;
  lineShape.moveTo(-hw, -0.75);
  lineShape.lineTo(hw, -0.75);
  lineShape.lineTo(hw, 0.75);
  lineShape.lineTo(-hw, 0.75);
  lineShape.closePath();
  const lineGeo = new THREE.ShapeGeometry(lineShape);
  lineGeo.rotateX(-Math.PI / 2);
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const startLine = new THREE.Mesh(lineGeo, lineMat);
  startLine.position.y = 0.06;
  archGroup.add(startLine);

  group.add(archGroup);
  return group;
}

/**
 * Build sculpted Stunt Ramps batched into 2 Draw Calls (ramps + side rails).
 */
function buildStuntRamps(ramps: StuntRamp[]): THREE.Group {
  const group = new THREE.Group();
  if (ramps.length === 0) return group;

  const rampMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.35,
    roughness: 0.42,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.7,
    roughness: 0.3,
  });

  const rampGeos: THREE.BufferGeometry[] = [];
  const railGeos: THREE.BufferGeometry[] = [];

  for (const r of ramps) {
    const shape = new THREE.Shape();
    const hl = r.length * 0.5;
    shape.moveTo(-hl, 0);
    shape.quadraticCurveTo(0, r.height * 0.32, hl, r.height);
    shape.lineTo(hl, 0);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: r.width,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.08,
      bevelThickness: 0.08,
    });
    geo.translate(0, 0, -r.width * 0.5);
    geo.rotateY(Math.PI / 2);
    geo.rotateY(r.rotY);
    geo.translate(r.x, r.y + 0.02, r.z);
    rampGeos.push(geo);

    for (const sx of [-r.width * 0.52, r.width * 0.52]) {
      const railCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx, 0.2, hl),
        new THREE.Vector3(sx, r.height + 0.35, -hl),
      ]);
      const railGeo = new THREE.TubeGeometry(railCurve, 6, 0.1, 5, false);
      railGeo.rotateY(r.rotY);
      railGeo.translate(r.x, r.y, r.z);
      railGeos.push(railGeo);
    }
  }

  const rampsMesh = new THREE.Mesh(mergeWorldGeos(rampGeos), rampMat);
  rampsMesh.receiveShadow = true;
  group.add(rampsMesh);
  group.add(new THREE.Mesh(mergeWorldGeos(railGeos), railMat));
  return group;
}

/**
 * Build sculpted buildings, neon signs, fuel station, and Grand Prix spectator grandstands
 * strictly from shared WorldLayout coordinates, merged into minimal Draw Calls. Zero BoxGeometry!
 */
function buildArchitectureAndLandmarks(
  track: TrackSpec,
  layout: WorldLayout,
  textures: ProceduralTexturePack,
): THREE.Group {
  const group = new THREE.Group();
  const isNight = track.envTheme === 'night-city';

  const facadeMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0xe0f2fe : 0xffffff,
    map: textures.buildingFacadeMap,
    emissive: isNight ? 0x0c4a6e : 0x000000,
    emissiveMap: isNight ? textures.buildingFacadeMap : null,
    emissiveIntensity: isNight ? 0.85 : 0,
    roughness: 0.35,
    metalness: 0.55,
  });

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.78,
    metalness: 0.1,
  });

  // 1. Batched Buildings + Spires + Vertex-Colored Neon Rings (3 Draw Calls total!)
  if (layout.buildings.length > 0) {
    const bldgGeos: THREE.BufferGeometry[] = [];
    const spireGeos: THREE.BufferGeometry[] = [];
    const neonGeos: THREE.BufferGeometry[] = [];
    const neonColors: number[] = [];

    for (const b of layout.buildings) {
      const shape = new THREE.Shape();
      for (let i = 0; i < b.sides; i++) {
        const a = (i / b.sides) * Math.PI * 2 + Math.PI / b.sides;
        const px = Math.cos(a) * b.radius;
        const py = Math.sin(a) * b.radius;
        if (i === 0) shape.moveTo(px, py);
        else shape.lineTo(px, py);
      }
      shape.closePath();

      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: b.height,
        bevelEnabled: true,
        bevelSegments: 1,
        bevelSize: 0.4,
        bevelThickness: 0.5,
      });
      geo.rotateX(-Math.PI / 2);
      const ground = sampleSurfaceAt(b.x, b.z, track).groundY;
      geo.translate(b.x, ground, b.z);
      bldgGeos.push(geo);

      const spireGeo = new THREE.CylinderGeometry(0.15, b.radius * 0.45, 5, b.sides);
      spireGeo.translate(b.x, ground + b.height + 2.5, b.z);
      spireGeos.push(spireGeo);

      const beaconGeo = new THREE.TorusGeometry(b.radius * 0.68, 0.25, 6, b.sides);
      beaconGeo.rotateX(Math.PI / 2);
      beaconGeo.translate(b.x, ground + b.height + 0.35, b.z);
      neonGeos.push(beaconGeo);
      neonColors.push(b.neonColor);

      if (isNight) {
        const midRingGeo = new THREE.TorusGeometry(b.radius * 0.94, 0.22, 5, b.sides);
        midRingGeo.rotateX(Math.PI / 2);
        midRingGeo.translate(b.x, ground + b.height * 0.52, b.z);
        neonGeos.push(midRingGeo);
        neonColors.push(b.neonColor);
      }
    }

    const bldgMesh = new THREE.Mesh(mergeWorldGeos(bldgGeos), facadeMat);
    bldgMesh.castShadow = true;
    bldgMesh.receiveShadow = true;
    group.add(bldgMesh);
    group.add(new THREE.Mesh(mergeWorldGeos(spireGeos), concreteMat));

    const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    group.add(new THREE.Mesh(mergeWorldGeos(neonGeos, neonColors), neonMat));
  }

  // 2. Fuel Station Canopy (Batched into 3 Draw Calls)
  if (layout.fuelStation) {
    const { x: fuelX, z: fuelZ } = layout.fuelStation;
    const fy = sampleSurfaceAt(fuelX, fuelZ, track).groundY;
    const canopyShape = new THREE.Shape();
    canopyShape.moveTo(-6, -4);
    canopyShape.quadraticCurveTo(0, -5.2, 6, -4);
    canopyShape.lineTo(6, 4);
    canopyShape.quadraticCurveTo(0, 5.2, -6, 4);
    canopyShape.closePath();

    const canopyGeo = new THREE.ExtrudeGeometry(canopyShape, {
      depth: 0.7,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.25,
      bevelThickness: 0.2,
    });
    canopyGeo.rotateX(-Math.PI / 2);
    const canopy = new THREE.Mesh(canopyGeo, concreteMat);
    canopy.position.set(fuelX, fy + 4.4, fuelZ);
    group.add(canopy);

    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 1.2,
      roughness: 0.2,
    });
    const pillarGeos = [-4.2, 4.2].map((px) => {
      const g = new THREE.CylinderGeometry(0.32, 0.4, 4.5, 10);
      g.translate(fuelX + px, fy + 2.25, fuelZ);
      return g;
    });
    group.add(new THREE.Mesh(mergeWorldGeos(pillarGeos), accentMat));

    const pumpMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.4, metalness: 0.3 });
    const pumpGeos = [-2, 2].map((px) => {
      const g = new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.45, 0),
          new THREE.Vector2(0.42, 0.25),
          new THREE.Vector2(0.35, 1.5),
          new THREE.Vector2(0.4, 1.8),
          new THREE.Vector2(0.1, 1.9),
        ],
        10,
      );
      g.translate(fuelX + px, fy, fuelZ);
      return g;
    });
    group.add(new THREE.Mesh(mergeWorldGeos(pumpGeos), pumpMat));
  }

  // 3. Grand Prix Spectator Grandstands (Batched into 3 Draw Calls total!)
  if (layout.grandstands.length > 0) {
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.65,
      metalness: 0.25,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.35,
      metalness: 0.45,
    });
    const crowdMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.25,
      roughness: 0.8,
    });

    const standBodyGeos: THREE.BufferGeometry[] = [];
    const standRoofGeos: THREE.BufferGeometry[] = [];
    const crowdTransforms: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();

    for (const st of layout.grandstands) {
      const profile = new THREE.Shape();
      const hd = st.depth * 0.5;
      profile.moveTo(-hd, 0);
      profile.lineTo(-hd, 1.5);
      profile.lineTo(-hd + 2.2, 1.5);
      profile.lineTo(-hd + 2.2, 3.2);
      profile.lineTo(-hd + 4.4, 3.2);
      profile.lineTo(-hd + 4.4, 4.9);
      profile.lineTo(-hd + 6.6, 4.9);
      profile.lineTo(hd, 6.8);
      profile.lineTo(hd, 0);
      profile.closePath();

      const standGeo = new THREE.ExtrudeGeometry(profile, {
        depth: st.length,
        bevelEnabled: true,
        bevelSegments: 1,
        bevelSize: 0.15,
        bevelThickness: 0.15,
      });
      standGeo.translate(0, 0, -st.length * 0.5);
      standGeo.rotateY(Math.PI * 0.5);
      standGeo.rotateY(st.yaw);
      standGeo.translate(st.x, 0, st.z);
      standBodyGeos.push(standGeo);

      const roofShape = new THREE.Shape();
      roofShape.moveTo(-hd - 1.2, 8.6);
      roofShape.quadraticCurveTo(0, 9.8, hd + 0.6, 8.8);
      roofShape.lineTo(hd + 0.6, 8.3);
      roofShape.lineTo(-hd - 1.2, 8.1);
      roofShape.closePath();
      const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: st.length + 1 });
      roofGeo.translate(0, 0, -(st.length + 1) * 0.5);
      roofGeo.rotateY(Math.PI * 0.5);
      roofGeo.rotateY(st.yaw);
      roofGeo.translate(st.x, 0, st.z);
      standRoofGeos.push(roofGeo);

      const crowdCount = 20;
      const cos = Math.cos(st.yaw);
      const sin = Math.sin(st.yaw);
      for (let c = 0; c < crowdCount; c++) {
        const tier = c % 3;
        const along = ((c / (crowdCount - 1)) - 0.5) * (st.length * 0.85);
        const lz = -hd + 1.2 + tier * 2.1;
        dummy.position.set(
          st.x + along * cos + lz * sin,
          2.0 + tier * 1.7,
          st.z - along * sin + lz * cos,
        );
        dummy.updateMatrix();
        crowdTransforms.push(dummy.matrix.clone());
      }
    }

    const standsMesh = new THREE.Mesh(mergeWorldGeos(standBodyGeos), standMat);
    standsMesh.receiveShadow = true;
    group.add(standsMesh);
    group.add(new THREE.Mesh(mergeWorldGeos(standRoofGeos), roofMat));

    const crowdGeo = new THREE.SphereGeometry(0.45, 5, 4);
    const crowdInst = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdTransforms.length);
    crowdTransforms.forEach((mat, i) => crowdInst.setMatrixAt(i, mat));
    crowdInst.instanceMatrix.needsUpdate = true;
    crowdInst.computeBoundingSphere();
    group.add(crowdInst);
  }

  return group;
}

/**
 * Populate theme-specific terrain, coastal ocean, instanced palm/pine/urban trees,
 * desert mesas/rocks, and streetlights strictly from shared WorldLayout. Zero BoxGeometry!
 */
function buildInstancedNatureAndProps(
  track: TrackSpec,
  layout: WorldLayout,
  textures: ProceduralTexturePack,
): THREE.Group {
  const group = new THREE.Group();
  const theme = track.envTheme;

  // 1. Optimized 40x40 Subdivided Terrain Ground Plane
  const terrainGeo = new THREE.PlaneGeometry(760, 760, 40, 40);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const s = sampleSurfaceAt(vx, vz, track);
    posAttr.setY(i, s.onRoad ? -0.05 : s.groundY);
  }
  terrainGeo.computeVertexNormals();

  const terrainMap =
    theme === 'night-city'
      ? textures.cityGroundMap
      : theme === 'coastal' || theme === 'grand-prix'
        ? textures.coastalGroundMap
        : textures.desertMap;

  const terrainMat = new THREE.MeshStandardMaterial({
    color: theme === 'grand-prix' ? 0x86efac : 0xffffff,
    map: terrainMap,
    bumpMap: theme === 'desert' ? textures.desertBump : null,
    bumpScale: theme === 'desert' ? 0.14 : 0,
    roughness: theme === 'night-city' ? 0.55 : 0.92,
    metalness: theme === 'night-city' ? 0.15 : 0.02,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  // 2. Coastal Ocean Bay hugging the east seaside edge (ONLY on Coastal Mountain Road)
  if (theme === 'coastal') {
    const waterGeo = new THREE.CircleGeometry(260, 36);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.18,
      metalness: 0.25,
      transparent: true,
      opacity: 0.9,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(365, -0.35, -45);
    group.add(water);
  }

  // 3. Instanced Theme-Specific Trees (Desert Palms, Coastal Pines, or Urban Trees)
  if (layout.trees.length > 0) {
    const count = layout.trees.length;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    if (theme === 'desert') {
      const trunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 5.6, 6);
      trunkGeo.translate(0, 2.8, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c4a2d, roughness: 0.92 });
      const frondGeo = new THREE.ConeGeometry(1.85, 2.4, 6);
      frondGeo.scale(1, 0.45, 1);
      frondGeo.translate(0, 5.6, 0);
      const frondMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.78, flatShading: true });

      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
      const frondInst = new THREE.InstancedMesh(frondGeo, frondMat, count);

      layout.trees.forEach((tr, i) => {
        dummy.position.set(tr.x, tr.y, tr.z);
        dummy.rotation.set(0.05, i * 1.1, 0.04);
        dummy.scale.setScalar(tr.scale);
        dummy.updateMatrix();
        trunkInst.setMatrixAt(i, dummy.matrix);
        frondInst.setMatrixAt(i, dummy.matrix);
        color.setHSL(0.3 + (i % 3) * 0.02, 0.55, 0.32);
        frondInst.setColorAt(i, color);
      });
      trunkInst.instanceMatrix.needsUpdate = true;
      frondInst.instanceMatrix.needsUpdate = true;
      if (frondInst.instanceColor) frondInst.instanceColor.needsUpdate = true;
      trunkInst.computeBoundingSphere();
      frondInst.computeBoundingSphere();
      group.add(trunkInst, frondInst);
    } else if (theme === 'coastal') {
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.35, 3.6, 6);
      trunkGeo.translate(0, 1.8, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 });
      const lowCone = new THREE.ConeGeometry(2.1, 3.8, 6);
      lowCone.translate(0, 4.2, 0);
      const topCone = new THREE.ConeGeometry(1.5, 3.2, 6);
      topCone.translate(0, 6.2, 0);
      const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });

      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
      const lowInst = new THREE.InstancedMesh(lowCone, pineMat, count);
      const topInst = new THREE.InstancedMesh(topCone, pineMat, count);

      layout.trees.forEach((tr, i) => {
        dummy.position.set(tr.x, tr.y, tr.z);
        dummy.rotation.set(0, i * 0.8, 0);
        dummy.scale.set(tr.scale, tr.scale * 1.15, tr.scale);
        dummy.updateMatrix();
        trunkInst.setMatrixAt(i, dummy.matrix);
        lowInst.setMatrixAt(i, dummy.matrix);
        topInst.setMatrixAt(i, dummy.matrix);
        color.setHSL(0.36 + (i % 3) * 0.02, 0.52, 0.22 + (i % 3) * 0.03);
        lowInst.setColorAt(i, color);
        topInst.setColorAt(i, color.clone().offsetHSL(0, 0, 0.05));
      });
      trunkInst.instanceMatrix.needsUpdate = true;
      lowInst.instanceMatrix.needsUpdate = true;
      topInst.instanceMatrix.needsUpdate = true;
      if (lowInst.instanceColor) lowInst.instanceColor.needsUpdate = true;
      if (topInst.instanceColor) topInst.instanceColor.needsUpdate = true;
      trunkInst.computeBoundingSphere();
      lowInst.computeBoundingSphere();
      topInst.computeBoundingSphere();
      group.add(trunkInst, lowInst, topInst);
    } else {
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.34, 4.4, 6);
      trunkGeo.translate(0, 2.2, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b472d, roughness: 0.9 });
      const crownGeo = new THREE.IcosahedronGeometry(2.0, 1);
      crownGeo.translate(0, 4.8, 0);
      const crownTopGeo = new THREE.IcosahedronGeometry(1.4, 0);
      crownTopGeo.translate(0.35, 6.1, 0.2);
      const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, flatShading: true });

      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
      const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, count);
      const crownTopInst = new THREE.InstancedMesh(crownTopGeo, crownMat, count);

      layout.trees.forEach((tr, i) => {
        dummy.position.set(tr.x, tr.y, tr.z);
        dummy.rotation.set(0, i * 1.4, 0);
        dummy.scale.setScalar(tr.scale);
        dummy.updateMatrix();
        trunkInst.setMatrixAt(i, dummy.matrix);
        crownInst.setMatrixAt(i, dummy.matrix);
        crownTopInst.setMatrixAt(i, dummy.matrix);
        color.setHSL(0.28 + (i % 4) * 0.025, 0.48, 0.28 + (i % 3) * 0.04);
        crownInst.setColorAt(i, color);
        crownTopInst.setColorAt(i, color.clone().offsetHSL(0, 0, 0.06));
      });
      trunkInst.instanceMatrix.needsUpdate = true;
      crownInst.instanceMatrix.needsUpdate = true;
      crownTopInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      if (crownTopInst.instanceColor) crownTopInst.instanceColor.needsUpdate = true;
      trunkInst.computeBoundingSphere();
      crownInst.computeBoundingSphere();
      crownTopInst.computeBoundingSphere();
      group.add(trunkInst, crownInst, crownTopInst);
    }
  }

  // 4. Instanced Rocks & Terraced Red Canyon Mesas (Desert & Coastal)
  if (layout.rocks.length > 0) {
    const mesas = layout.rocks.filter((r) => r.isMesa);
    const boulders = layout.rocks.filter((r) => !r.isMesa);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    if (boulders.length > 0) {
      const rockGeo = new THREE.IcosahedronGeometry(2.6, 1);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, flatShading: true });
      const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, boulders.length);
      boulders.forEach((r, i) => {
        dummy.position.set(r.x, r.y + r.sy * 0.4, r.z);
        dummy.rotation.set(i * 0.3, r.rotY, 0);
        dummy.scale.set(r.sx, r.sy, r.sx * 0.9);
        dummy.updateMatrix();
        rockInst.setMatrixAt(i, dummy.matrix);
        color.setHSL(theme === 'desert' ? 0.05 : 0.6, theme === 'desert' ? 0.52 : 0.1, 0.36 + (i % 4) * 0.04);
        rockInst.setColorAt(i, color);
      });
      rockInst.instanceMatrix.needsUpdate = true;
      if (rockInst.instanceColor) rockInst.instanceColor.needsUpdate = true;
      rockInst.computeBoundingSphere();
      group.add(rockInst);
    }

    if (mesas.length > 0) {
      const mesaGeo = new THREE.CylinderGeometry(2.2, 4.1, 6.2, 7);
      mesaGeo.translate(0, 3.1, 0);
      const mesaMat = new THREE.MeshStandardMaterial({
        color: 0xb45309,
        roughness: 0.92,
        flatShading: true,
      });
      const mesaInst = new THREE.InstancedMesh(mesaGeo, mesaMat, mesas.length);
      mesas.forEach((m, i) => {
        dummy.position.set(m.x, m.y - 0.3, m.z);
        dummy.rotation.set(0, m.rotY, 0);
        dummy.scale.set(m.sx, m.sy, m.sx * 0.85);
        dummy.updateMatrix();
        mesaInst.setMatrixAt(i, dummy.matrix);
      });
      mesaInst.instanceMatrix.needsUpdate = true;
      mesaInst.computeBoundingSphere();
      group.add(mesaInst);
    }
  }

  // 5. Instanced Roadside Streetlights (glowing emissive material -> zero PointLights!)
  if (layout.poles.length > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 6.2, 6);
    poleGeo.translate(0, 3.1, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.35 });
    const bulbGeo = new THREE.SphereGeometry(theme === 'night-city' ? 0.36 : 0.26, 6, 5);
    bulbGeo.translate(0, 6.2, 0);
    const bulbMat = new THREE.MeshBasicMaterial({
      color: theme === 'night-city' ? 0x38bdf8 : 0xfde68a,
    });

    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, layout.poles.length);
    const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, layout.poles.length);
    const dummy = new THREE.Object3D();

    layout.poles.forEach((p, idx) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(idx, dummy.matrix);
      bulbInst.setMatrixAt(idx, dummy.matrix);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    bulbInst.instanceMatrix.needsUpdate = true;
    poleInst.computeBoundingSphere();
    bulbInst.computeBoundingSphere();
    group.add(poleInst, bulbInst);
  }

  // 6. Local CC0 cone.glb markers around stunt ramps
  if (track.ramps.length > 0) {
    preloadLocalGlb('/assets/models/cone.glb')
      .then((coneScene) => {
        for (const r of track.ramps) {
          for (const sx of [-r.width * 0.6, r.width * 0.6]) {
            const cone = coneScene.clone(true);
            cone.scale.setScalar(1.3);
            cone.position.set(
              r.x + Math.cos(r.rotY) * sx,
              0.03,
              r.z - Math.sin(r.rotY) * sx,
            );
            group.add(cone);
          }
        }
      })
      .catch(() => {});
  }

  return group;
}

/**
 * Build the 3D Studio Garage Showroom stage (sculpted circular turntable + LED ring).
 */
function buildGarageShowroomStage(): THREE.Group {
  const garage = new THREE.Group();

  const plinthGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, -0.35),
      new THREE.Vector2(4.6, -0.35),
      new THREE.Vector2(4.4, -0.02),
      new THREE.Vector2(3.9, 0.0),
      new THREE.Vector2(0, 0.0),
    ],
    36,
  );
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    metalness: 0.6,
    roughness: 0.25,
  });
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.receiveShadow = true;
  garage.add(plinth);

  const ringGeo = new THREE.RingGeometry(4.05, 4.18, 36);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.01;
  garage.add(ring);

  const floorGeo = new THREE.CircleGeometry(32, 32);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0b0f17,
    metalness: 0.35,
    roughness: 0.35,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.35;
  floor.receiveShadow = true;
  garage.add(floor);

  return garage;
}

export function buildGameWorld(
  track: TrackSpec,
  textures: ProceduralTexturePack,
  mode: GameMode = 'race',
): WorldHandles {
  const worldGroup = new THREE.Group();
  const layout = generateWorldLayout(track);

  // Theme-specific Sky Dome (20x12 sphere for low vertex cost)
  const skyTex =
    track.envTheme === 'night-city'
      ? textures.nightSkyMap
      : track.envTheme === 'desert'
        ? textures.skyMap
        : textures.daySkyMap;

  const skyGeo = new THREE.SphereGeometry(480, 20, 12);
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTex,
    side: THREE.BackSide,
    fog: false,
  });
  worldGroup.add(new THREE.Mesh(skyGeo, skyMat));

  worldGroup.add(buildInstancedNatureAndProps(track, layout, textures));
  worldGroup.add(buildTrackRoadMesh(track, textures, mode));
  worldGroup.add(buildStuntRamps(track.ramps));
  worldGroup.add(buildArchitectureAndLandmarks(track, layout, textures));

  const garageGroup = buildGarageShowroomStage();

  return {
    worldGroup,
    garageGroup,
    layout,
    dispose: () => {
      worldGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material?.dispose();
        }
      });
      garageGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material?.dispose();
        }
      });
    },
  };
}
