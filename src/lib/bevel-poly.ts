import {
  boundsOfPoly,
  orientPolyOutward,
  type PolyFace,
  type PolyMesh,
} from "./cube.ts";

type Vec = [number, number, number];

function V(p: number[], i: number): Vec {
  return [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
}

function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: Vec, b: Vec): Vec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a: Vec, s: number): Vec {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a: Vec, b: Vec) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec, b: Vec): Vec {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function len(a: Vec) {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalize(a: Vec): Vec {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function newell(positions: number[], indices: number[]): Vec {
  let nx = 0,
    ny = 0,
    nz = 0;
  const n = indices.length;
  for (let i = 0; i < n; i++) {
    const a = indices[i]!;
    const b = indices[(i + 1) % n]!;
    const ax = positions[a * 3]!,
      ay = positions[a * 3 + 1]!,
      az = positions[a * 3 + 2]!;
    const bx = positions[b * 3]!,
      by = positions[b * 3 + 1]!,
      bz = positions[b * 3 + 2]!;
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  return normalize([nx, ny, nz]);
}

function centroid(positions: number[], indices: number[]): Vec {
  let x = 0,
    y = 0,
    z = 0;
  for (const i of indices) {
    x += positions[i * 3]!;
    y += positions[i * 3 + 1]!;
    z += positions[i * 3 + 2]!;
  }
  const n = indices.length || 1;
  return [x / n, y / n, z / n];
}

function edgeKey(a: number, b: number) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function intersectLines(p1: Vec, r: Vec, p2: Vec, s: Vec, n: Vec): Vec | null {
  const rxs = dot(cross(r, s), n);
  if (Math.abs(rxs) < 1e-10) return null;
  const t = dot(cross(sub(p2, p1), s), n) / rxs;
  if (!Number.isFinite(t)) return null;
  return add(p1, scale(r, t));
}

type EdgeUse = { fi: number; i0: number; i1: number };
type Edge = { faces: EdgeUse[] };

/**
 * Chamfer every hard edge. `amount` is 0–1 relative to the shortest
 * bounding side (same scale as the cube bevel slider).
 */
export function bevelPoly(poly: PolyMesh, amount: number): PolyMesh {
  if (!(amount > 0.001) || poly.faces.length === 0) return poly;
  poly = orientPolyOutward(poly);

  const bounds = boundsOfPoly(poly);
  const minSide = Math.min(bounds.size[0], bounds.size[1], bounds.size[2]);
  if (!(minSide > 0)) return poly;
  const globalD = (minSide / 2) * Math.min(0.45, amount);

  const { positions: src, faces } = poly;
  const nV = src.length / 3;

  const edges = new Map<string, Edge>();
  for (let fi = 0; fi < faces.length; fi++) {
    const idx = faces[fi]!.indices;
    const m = idx.length;
    for (let c = 0; c < m; c++) {
      const a = idx[c]!;
      const b = idx[(c + 1) % m]!;
      const key = edgeKey(a, b);
      let e = edges.get(key);
      if (!e) {
        e = { faces: [] };
        edges.set(key, e);
      }
      e.faces.push({ fi, i0: c, i1: (c + 1) % m });
    }
  }

  const inset: Vec[][] = faces.map(() => []);
  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]!;
    const idx = face.indices;
    const m = idx.length;
    const N = len(face.normal) > 0.1 ? normalize(face.normal) : newell(src, idx);
    const faceCenter = centroid(src, idx);
    for (let c = 0; c < m; c++) {
      const ip = idx[(c - 1 + m) % m]!;
      const ic = idx[c]!;
      const inx = idx[(c + 1) % m]!;
      const P = V(src, ic);
      const A = V(src, ip);
      const B = V(src, inx);
      const ePrev = sub(P, A);
      const eNext = sub(B, P);
      const lenPrev = len(ePrev);
      const lenNext = len(eNext);
      const d = Math.min(globalD, lenPrev * 0.45, lenNext * 0.45);
      if (d < 1e-8 || lenPrev < 1e-8 || lenNext < 1e-8) {
        inset[fi]![c] = P;
        continue;
      }
      const in1 = normalize(cross(N, ePrev));
      const in2 = normalize(cross(N, eNext));
      const p1 = add(A, scale(in1, d));
      const p2 = add(P, scale(in2, d));
      let hit = intersectLines(p1, ePrev, p2, eNext, N);
      if (!hit) {
        hit = add(P, scale(normalize(add(in1, in2)), d));
      }
      const move = sub(hit, P);
      const maxMove = Math.min(lenPrev, lenNext) * 0.49;
      if (len(move) > maxMove) {
        hit = add(P, scale(normalize(move), maxMove));
      }
      if (dot(sub(hit, P), sub(faceCenter, P)) < 0) {
        hit = add(P, scale(normalize(sub(faceCenter, P)), d));
      }
      if (!Number.isFinite(hit[0]) || !Number.isFinite(hit[1]) || !Number.isFinite(hit[2])) {
        hit = P;
      }
      inset[fi]![c] = hit;
    }
  }

  const positions: number[] = [];
  function pushV(v: Vec): number {
    const i = positions.length / 3;
    positions.push(v[0], v[1], v[2]);
    return i;
  }

  const cornerId: number[][] = faces.map(() => []);
  for (let fi = 0; fi < faces.length; fi++) {
    for (let c = 0; c < faces[fi]!.indices.length; c++) {
      cornerId[fi]![c] = pushV(inset[fi]![c]!);
    }
  }

  const newFaces: PolyFace[] = [];
  const center = bounds.center as Vec;

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]!;
    pushOriented(
      cornerId[fi]!.slice(),
      face.uvs.map((uv) => [uv[0], uv[1]] as [number, number]),
      face.material,
    );
  }

  function pushOriented(
    indices: number[],
    uvs: Array<[number, number]>,
    material?: string,
  ) {
    if (indices.length < 3) return;
    let n = newell(positions, indices);
    const mid = centroid(positions, indices);
    if (dot(n, sub(mid, center)) < 0) {
      indices = indices.slice().reverse();
      n = scale(n, -1);
      uvs = uvs.slice().reverse();
    }
    newFaces.push({ indices, normal: n, uvs, material });
  }

  for (const e of edges.values()) {
    if (e.faces.length !== 2) continue;
    const [fa, fb] = e.faces;
    if (!fa || !fb) continue;
    pushOriented(
      [
        cornerId[fa.fi]![fa.i0]!,
        cornerId[fa.fi]![fa.i1]!,
        cornerId[fb.fi]![fb.i0]!,
        cornerId[fb.fi]![fb.i1]!,
      ],
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      faces[fa.fi]?.material,
    );
  }

  const incident: number[][] = Array.from({ length: nV }, () => []);
  for (let fi = 0; fi < faces.length; fi++) {
    const idx = faces[fi]!.indices;
    for (let c = 0; c < idx.length; c++) {
      incident[idx[c]!]!.push(fi);
    }
  }

  for (let vi = 0; vi < nV; vi++) {
    const ring = walkVertex(vi, faces, edges, incident[vi]!);
    if (ring.length < 3) continue;
    const ids = ring.map((r) => cornerId[r.fi]![r.c]!);
    const uvs = ids.map((_, i) => {
      const t = i / ids.length;
      return [t, 0] as [number, number];
    });
    pushOriented(ids, uvs);
  }

  return { positions, faces: newFaces };
}

function walkVertex(
  vi: number,
  faces: PolyFace[],
  edges: Map<string, Edge>,
  faceList: number[],
): Array<{ fi: number; c: number }> {
  const unique = [...new Set(faceList)];
  if (unique.length < 3) return [];

  const cornerOf = (fi: number) => {
    const idx = faces[fi]!.indices;
    for (let c = 0; c < idx.length; c++) if (idx[c] === vi) return c;
    return -1;
  };

  const start = unique[0]!;
  const ordered: Array<{ fi: number; c: number }> = [];
  const seen = new Set<number>();
  let fi = start;
  for (let k = 0; k < unique.length; k++) {
    if (seen.has(fi)) break;
    const c = cornerOf(fi);
    if (c < 0) break;
    seen.add(fi);
    ordered.push({ fi, c });
    const idx = faces[fi]!.indices;
    const nextVi = idx[(c + 1) % idx.length]!;
    const e = edges.get(edgeKey(vi, nextVi));
    const other = e?.faces.find((use) => use.fi !== fi);
    if (!other) break;
    fi = other.fi;
  }
  if (ordered.length !== unique.length) {
    return unique.map((f) => ({ fi: f, c: cornerOf(f) })).filter((r) => r.c >= 0);
  }
  return ordered;
}
