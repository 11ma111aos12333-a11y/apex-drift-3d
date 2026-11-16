import { TrackSpec, TrackWaypoint } from '../types/game';

function generateLoopWaypoints(
  points: Array<[number, number, number, 'asphalt' | 'desert' | 'coastal']>,
  width: number,
  samplesPerSeg = 7,
  tension = 0.5,
): TrackWaypoint[] {
  const out: TrackWaypoint[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom spline with configurable tension (lower tension = crisper city 90-degree corners)
      const c = tension;
      const x =
        c *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        c *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const z =
        c *
        (2 * p1[2] +
          (-p0[2] + p2[2]) * t +
          (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 +
          (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3);

      out.push({
        x,
        y,
        z,
        width,
        surface: p1[3],
      });
    }
  }
  return out;
}

/**
 * Generate crisp urban corners (sharp 90-degree city intersections with smooth short apex fillets).
 */
function generateUrbanWaypoints(
  corners: Array<[number, number]>,
  width: number,
  cornerRadius = 16,
  samplesPerEdge = 6,
): TrackWaypoint[] {
  const out: TrackWaypoint[] = [];
  const n = corners.length;

  for (let i = 0; i < n; i++) {
    const prev = corners[(i - 1 + n) % n];
    const curr = corners[i];
    const next = corners[(i + 1) % n];

    const vInX = curr[0] - prev[0];
    const vInZ = curr[1] - prev[1];
    const lenIn = Math.hypot(vInX, vInZ) || 1;

    const vOutX = next[0] - curr[0];
    const vOutZ = next[1] - curr[1];
    const lenOut = Math.hypot(vOutX, vOutZ) || 1;

    const r = Math.min(cornerRadius, lenIn * 0.35, lenOut * 0.35);

    // Entry fillet point before corner
    const pStartX = curr[0] - (vInX / lenIn) * r;
    const pStartZ = curr[1] - (vInZ / lenIn) * r;
    // Exit fillet point after corner
    const pEndX = curr[0] + (vOutX / lenOut) * r;
    const pEndZ = curr[1] + (vOutZ / lenOut) * r;

    // Straight approach from previous exit to this corner entry
    const prevPrev = corners[(i - 2 + n) % n];
    const vPrevInX = prev[0] - prevPrev[0];
    const vPrevInZ = prev[1] - prevPrev[1];
    const lenPrevIn = Math.hypot(vPrevInX, vPrevInZ) || 1;
    const rPrev = Math.min(cornerRadius, lenPrevIn * 0.35, lenIn * 0.35);
    const segStartX = prev[0] + (vInX / lenIn) * rPrev;
    const segStartZ = prev[1] + (vInZ / lenIn) * rPrev;

    for (let s = 0; s < samplesPerEdge; s++) {
      const t = s / samplesPerEdge;
      out.push({
        x: segStartX + (pStartX - segStartX) * t,
        y: 0,
        z: segStartZ + (pStartZ - segStartZ) * t,
        width,
        surface: 'asphalt',
      });
    }

    // Crisp quadratic corner fillet
    for (let s = 0; s < 4; s++) {
      const t = s / 4;
      const omt = 1 - t;
      out.push({
        x: omt * omt * pStartX + 2 * omt * t * curr[0] + t * t * pEndX,
        y: 0,
        z: omt * omt * pStartZ + 2 * omt * t * curr[1] + t * t * pEndZ,
        width,
        surface: 'asphalt',
      });
    }
  }
  return out;
}

export const TRACKS: TrackSpec[] = [
  {
    id: 'neon-night-city',
    nameAr: 'المدينة الليلية النيون',
    nameEn: 'Neon Night City',
    envType: 'city',
    envTheme: 'night-city',
    roadWidth: 17,
    defaultLaps: 2,
    waypoints: generateUrbanWaypoints(
      [
        [0, 30],
        [0, -135],
        [150, -135],
        [150, -35],
        [235, -35],
        [235, 115],
        [95, 115],
        [95, 30],
      ],
      17,
      15,
      6,
    ),
    ramps: [
      { x: 150, y: 0, z: -85, rotY: Math.PI, width: 7.5, length: 12, height: 1.9 },
      { x: 165, y: 0, z: 115, rotY: Math.PI * 0.5, width: 7.5, length: 12, height: 2.0 },
    ],
  },
  {
    id: 'desert-canyon',
    nameAr: 'الصحراء والكثبان الذهبية',
    nameEn: 'Desert Canyon & Dunes',
    envType: 'desert',
    envTheme: 'desert',
    roadWidth: 19,
    defaultLaps: 2,
    waypoints: generateLoopWaypoints(
      [
        [0, 0, 0, 'desert'],
        [0, 0, -110, 'desert'],
        [-80, 0, -185, 'desert'],
        [-190, 0, -160, 'desert'],
        [-225, 0, -50, 'desert'],
        [-150, 0, 40, 'desert'],
        [-195, 0, 140, 'desert'],
        [-85, 0, 175, 'desert'],
        [0, 0, 100, 'desert'],
      ],
      19,
      7,
    ),
    ramps: [
      { x: -135, y: 0, z: -175, rotY: Math.PI * 0.45, width: 8.5, length: 14, height: 2.6 },
      { x: -140, y: 0, z: 158, rotY: -Math.PI * 0.5, width: 8.5, length: 13, height: 2.3 },
    ],
  },
  {
    id: 'coastal-mountain',
    nameAr: 'طريق الساحل الجبلي',
    nameEn: 'Coastal Mountain Road',
    envType: 'coastal',
    envTheme: 'coastal',
    roadWidth: 17.5,
    defaultLaps: 2,
    waypoints: generateLoopWaypoints(
      [
        [0, 0, 0, 'asphalt'],
        [0, 0, -105, 'coastal'],
        [68, 0, -185, 'coastal'],
        [175, 0, -190, 'coastal'],
        [240, 0, -105, 'coastal'],
        [195, 0, -25, 'coastal'],
        [235, 0, 65, 'coastal'],
        [145, 0, 140, 'asphalt'],
        [25, 0, 105, 'asphalt'],
      ],
      17.5,
      7,
    ),
    ramps: [
      { x: 0, y: 0, z: -55, rotY: 0, width: 7, length: 12, height: 2.0 },
      { x: 120, y: 0, z: -188, rotY: -Math.PI * 0.5, width: 7.5, length: 12, height: 2.1 },
    ],
  },
  {
    id: 'grand-prix-circuit',
    nameAr: 'حلبة السباق الاحترافية GP',
    nameEn: 'Grand Prix Pro Circuit',
    envType: 'city',
    envTheme: 'grand-prix',
    roadWidth: 18.5,
    defaultLaps: 3,
    waypoints: generateLoopWaypoints(
      [
        [0, 0, 0, 'asphalt'],
        [0, 0, -155, 'asphalt'], // Long high-speed main DRS straight
        [55, 0, -205, 'asphalt'], // Fast Turn 1 sweep
        [145, 0, -175, 'asphalt'],
        [110, 0, -90, 'asphalt'], // Technical chicane entry
        [185, 0, -35, 'asphalt'], // Chicane exit
        [210, 0, 65, 'asphalt'], // Wide parabola
        [120, 0, 130, 'asphalt'], // Tight final hairpin
        [35, 0, 95, 'asphalt'],
      ],
      18.5,
      8,
    ),
    ramps: [],
  },
];

export function getTrackById(id: string): TrackSpec {
  if (id === 'coastal-horizon') return TRACKS[2];
  if (id === 'neon-grand-prix') return TRACKS[3];
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
