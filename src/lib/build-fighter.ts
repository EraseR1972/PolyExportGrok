import type { ObjMaterial } from "@/lib/obj-material";
import {
  orientPolyOutward,
  placePoly,
  type PolyFace,
  type PolyMesh,
} from "@/lib/cube";

type Half = Array<[number, number]>;

function newell(pos: number[], indices: number[]): [number, number, number] {
  let nx = 0,
    ny = 0,
    nz = 0;
  const n = indices.length;
  for (let i = 0; i < n; i++) {
    const a = indices[i]!;
    const b = indices[(i + 1) % n]!;
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const bx = pos[b * 3]!;
    const by = pos[b * 3 + 1]!;
    const bz = pos[b * 3 + 2]!;
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

class Hull {
  positions: number[] = [];
  faces: PolyFace[] = [];
  private seen = new Map<string, number>();

  vert(x: number, y: number, z: number): number {
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let i = this.seen.get(key);
    if (i !== undefined) return i;
    i = this.positions.length / 3;
    this.seen.set(key, i);
    this.positions.push(x, y, z);
    return i;
  }

  quad(a: number, b: number, c: number, d: number, material: string) {
    if (a === b || b === c || c === d || d === a) return;
    const indices = [a, b, c, d];
    const uniq = new Set(indices);
    if (uniq.size < 3) return;
    const normal = newell(this.positions, indices);
    this.faces.push({
      indices,
      normal,
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      material,
    });
  }

  loft(a: number[], b: number[], material: string, skip = new Set<number>(), flip = false) {
    const n = a.length;
    for (let k = 0; k < n; k++) {
      if (skip.has(k)) continue;
      const k2 = (k + 1) % n;
      if (flip) this.quad(a[k2]!, a[k]!, b[k]!, b[k2]!, material);
      else this.quad(a[k]!, a[k2]!, b[k2]!, b[k]!, material);
    }
  }

  tube(rings: number[][], material: string, capFront = false, capBack = false) {
    for (let i = 0; i < rings.length - 1; i++) {
      this.loft(rings[i]!, rings[i + 1]!, material);
    }
    const first = rings[0]!;
    const last = rings[rings.length - 1]!;
    if (capFront && first.length === 4) this.quad(first[0]!, first[3]!, first[2]!, first[1]!, material);
    if (capBack && last.length === 4) this.quad(last[0]!, last[1]!, last[2]!, last[3]!, material);
  }

  mesh(): PolyMesh {
    return { positions: this.positions, faces: this.faces };
  }
}

function halfSection(w: number, h: number, keel: number): Half {
  return [
    [0, -keel],
    [w * 0.58, -keel * 0.52],
    [w, h * 0.06],
    [w * 0.48, h * 0.7],
    [0, h],
  ];
}

function ringFromHalf(h: Hull, half: Half, z: number): number[] {
  const idx: number[] = [];
  for (const p of half) idx.push(h.vert(p[0], p[1], z));
  for (let i = half.length - 2; i >= 1; i--) {
    idx.push(h.vert(-half[i]![0], half[i]![1], z));
  }
  return idx;
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function pt(h: Hull, i: number): [number, number, number] {
  return [h.positions[i * 3]!, h.positions[i * 3 + 1]!, h.positions[i * 3 + 2]!];
}

function extrudeStrip(
  h: Hull,
  root: [number, number, number, number],
  tipOffset: [number, number, number],
  spans: number,
  material: string,
) {
  const r = root.map((i) => pt(h, i)) as Array<[number, number, number]>;
  const tips = r.map(
    (p) => [p[0] + tipOffset[0], p[1] + tipOffset[1], p[2] + tipOffset[2]] as [number, number, number],
  );
  let prev = root;
  for (let s = 1; s <= spans; s++) {
    const t = s / spans;
    const ring: number[] = tips.map((tip, i) => {
      const p = lerp3(r[i]!, tip, t);
      return h.vert(p[0], p[1], p[2]);
    });
    const next = ring as [number, number, number, number];
    h.quad(prev[0], next[0], next[1], prev[1], material);
    h.quad(prev[1], next[1], next[2], prev[2], material);
    h.quad(prev[2], next[2], next[3], prev[3], material);
    h.quad(prev[3], next[3], next[0], prev[0], material);
    prev = next;
  }
  h.quad(prev[0], prev[3], prev[2], prev[1], material);
}

function diamond(h: Hull, cx: number, cy: number, z: number, rx: number, ry: number): number[] {
  return [
    h.vert(cx + rx, cy, z),
    h.vert(cx, cy + ry, z),
    h.vert(cx - rx, cy, z),
    h.vert(cx, cy - ry, z),
  ];
}

const STATIONS = [
  { z: 420, w: 7, h: 7, keel: 3 },
  { z: 340, w: 24, h: 18, keel: 10 },
  { z: 250, w: 52, h: 30, keel: 16 },
  { z: 150, w: 74, h: 46, keel: 20 },
  { z: 50, w: 84, h: 38, keel: 22 },
  { z: -70, w: 80, h: 34, keel: 21 },
  { z: -210, w: 70, h: 31, keel: 19 },
  { z: -320, w: 58, h: 28, keel: 16 },
  { z: -420, w: 46, h: 24, keel: 13 },
] as const;

const WING_LE = 5;
const WING_TE = 6;

export const FIGHTER_MATERIALS: ObjMaterial[] = [
  { name: "hull", color: [0.86, 0.88, 0.9], roughness: 0.42, metalness: 0.18, opacity: 1 },
  { name: "glass", color: [0.12, 0.2, 0.28], roughness: 0.08, metalness: 0.35, opacity: 0.92 },
  { name: "engine", color: [0.12, 0.12, 0.13], roughness: 0.55, metalness: 0.4, opacity: 1 },
];

export function buildAngularFighter(): { poly: PolyMesh; materials: ObjMaterial[] } {
  const h = new Hull();
  const rings = STATIONS.map((s, i) => {
    let hh = s.h;
    let keel = s.keel;
    if (i === 2 || i === 3) {
      hh *= 1.22;
      keel *= 0.92;
    }
    return ringFromHalf(h, halfSection(s.w, hh, keel), s.z);
  });

  for (let s = 0; s < rings.length - 1; s++) {
    const skip = new Set<number>();
    if (s === WING_LE) {
      skip.add(1);
      skip.add(6);
    }
    const a = rings[s]!;
    const b = rings[s + 1]!;
    const n = a.length;
    for (let k = 0; k < n; k++) {
      if (skip.has(k)) continue;
      const k2 = (k + 1) % n;
      const glass =
        (s === 2 || s === 3) && (k === 3 || k === 4);
      h.quad(a[k2]!, a[k]!, b[k]!, b[k2]!, glass ? "glass" : "hull");
    }
  }

  const le = rings[WING_LE]!;
  const te = rings[WING_TE]!;
  extrudeStrip(h, [le[1]!, le[2]!, te[2]!, te[1]!], [290, 18, -55], 3, "hull");
  extrudeStrip(h, [le[7]!, te[7]!, te[6]!, le[6]!], [-290, 18, -55], 3, "hull");

  const s7 = rings[7]!;
  const s8 = rings[8]!;
  const spineY = (pt(h, s7[4]!)[1] + pt(h, s8[4]!)[1]) / 2;
  const z7 = STATIONS[7]!.z;
  const z8 = STATIONS[8]!.z;
  extrudeStrip(
    h,
    [
      h.vert(5, spineY, z7),
      h.vert(-5, spineY, z7),
      h.vert(-5, spineY, z8),
      h.vert(5, spineY, z8),
    ],
    [0, 108, -18],
    2,
    "hull",
  );

  const tail = rings[8]!;
  const nozzle = tail.map((i) => {
    const p = pt(h, i);
    return h.vert(p[0] * 0.82, p[1] * 0.82, -490);
  });
  h.loft(tail, nozzle, "engine", new Set(), true);

  const eL0 = diamond(h, -28, -5, -424, 10, 8);
  const eL1 = diamond(h, -30, -5, -505, 8, 6);
  const eR0 = diamond(h, 28, -5, -424, 10, 8);
  const eR1 = diamond(h, 30, -5, -505, 8, 6);
  h.loft(eL0, eL1, "engine");
  h.loft(eR0, eR1, "engine");
  h.quad(eL0[0]!, eL0[1]!, eL0[2]!, eL0[3]!, "engine");
  h.quad(eR0[0]!, eR0[1]!, eR0[2]!, eR0[3]!, "engine");

  const nose = rings[0]!;
  if (nose.length === 8) {
    h.quad(nose[0]!, nose[1]!, nose[2]!, nose[3]!, "hull");
    h.quad(nose[0]!, nose[3]!, nose[4]!, nose[7]!, "hull");
    h.quad(nose[7]!, nose[4]!, nose[5]!, nose[6]!, "hull");
  }

  const poly = orientPolyOutward(placePoly(h.mesh(), "bottom"));
  return { poly, materials: FIGHTER_MATERIALS.map((m) => ({ ...m })) };
}
