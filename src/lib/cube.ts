import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type Pivot = "center" | "bottom";

export type CubeParams = {
  width: number;
  height: number;
  depth: number;
  segments: number;
  bevel: number;
  flatShading: boolean;
  faceColors: boolean;
  pivot: Pivot;
  originX?: number;
  originY?: number;
  originZ?: number;
};

export const FACE_COLORS = [
  new THREE.Color("#c45c4a"),
  new THREE.Color("#7a342e"),
  new THREE.Color("#6aaa6a"),
  new THREE.Color("#3d6b3d"),
  new THREE.Color("#5a7ec4"),
  new THREE.Color("#334a7a"),
] as const;

export type PolyFace = {
  indices: number[];
  normal: [number, number, number];
  uvs: Array<[number, number]>;
  color?: [number, number, number];
  material?: string;
};

export type PolyMesh = {
  positions: number[];
  faces: PolyFace[];
};

export type MeshStats = {
  vertices: number;
  triangles: number;
  unique: number;
  faces: number;
};

export function faceTriDot(
  pos: number[],
  a: number,
  b: number,
  c: number,
  nrm: [number, number, number],
): number {
  const ax = pos[a * 3]!;
  const ay = pos[a * 3 + 1]!;
  const az = pos[a * 3 + 2]!;
  const bx = pos[b * 3]! - ax;
  const by = pos[b * 3 + 1]! - ay;
  const bz = pos[b * 3 + 2]! - az;
  const cx = pos[c * 3]! - ax;
  const cy = pos[c * 3 + 1]! - ay;
  const cz = pos[c * 3 + 2]! - az;
  return (
    (by * cz - bz * cy) * nrm[0] +
    (bz * cx - bx * cz) * nrm[1] +
    (bx * cy - by * cx) * nrm[2]
  );
}

function dist2(pos: number[], a: number, b: number) {
  const dx = pos[a * 3]! - pos[b * 3]!;
  const dy = pos[a * 3 + 1]! - pos[b * 3 + 1]!;
  const dz = pos[a * 3 + 2]! - pos[b * 3 + 2]!;
  return dx * dx + dy * dy + dz * dz;
}

/** Offset triples into `indices`. GPU winding follows the stored face normal. */
export function tessellateFace(
  pos: number[],
  indices: number[],
  nrm: [number, number, number],
): Array<[number, number, number]> {
  const n = indices.length;
  if (n < 3) return [];
  const orient = (ia: number, ib: number, ic: number): [number, number, number] => {
    const a = indices[ia]!;
    const b = indices[ib]!;
    const c = indices[ic]!;
    if (faceTriDot(pos, a, b, c, nrm) < 0) return [ia, ic, ib];
    return [ia, ib, ic];
  };
  if (n === 3) return [orient(0, 1, 2)];
  if (n === 4) {
    const d02 = dist2(pos, indices[0]!, indices[2]!);
    const d13 = dist2(pos, indices[1]!, indices[3]!);
    if (d13 < d02) return [orient(0, 1, 3), orient(1, 2, 3)];
    return [orient(0, 1, 2), orient(0, 2, 3)];
  }
  for (let o = 0; o < n; o++) {
    const tris: Array<[number, number, number]> = [];
    let ok = true;
    for (let k = 1; k < n - 1; k++) {
      const ia = o;
      const ib = (o + k) % n;
      const ic = (o + k + 1) % n;
      if (faceTriDot(pos, indices[ia]!, indices[ib]!, indices[ic]!, nrm) < -1e-10) {
        ok = false;
        break;
      }
      tris.push([ia, ib, ic]);
    }
    if (ok) return tris;
  }
  const fallback: Array<[number, number, number]> = [];
  for (let t = 1; t < n - 1; t++) fallback.push(orient(0, t, t + 1));
  return fallback;
}

export function polyBoundaryPoints(poly: PolyMesh): Array<[number, number, number]> {
  const seen = new Set<string>();
  const pts: Array<[number, number, number]> = [];
  const p = poly.positions;
  for (const face of poly.faces) {
    const idx = face.indices;
    const n = idx.length;
    for (let i = 0; i < n; i++) {
      const a = idx[i]!;
      const b = idx[(i + 1) % n]!;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}:${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(
        [p[a * 3]!, p[a * 3 + 1]!, p[a * 3 + 2]!],
        [p[b * 3]!, p[b * 3 + 1]!, p[b * 3 + 2]!],
      );
    }
  }
  return pts;
}

export function buildCubeGeometry(params: CubeParams): THREE.BufferGeometry {
  const { width, height, depth, segments, bevel, flatShading, faceColors, pivot } =
    params;
  const origin = originOf(params);
  const seg = Math.max(1, Math.round(segments));
  const minSide = Math.min(width, height, depth);
  const radius =
    bevel <= 0 ? 0 : Math.min((minSide / 2) * 0.92, (minSide / 2) * bevel);

  if (radius > 0.05) {
    let geo: THREE.BufferGeometry = new RoundedBoxGeometry(
      width,
      height,
      depth,
      Math.max(1, seg),
      radius,
    );
    if (flatShading || faceColors) {
      const exploded = geo.index ? geo.toNonIndexed() : geo;
      if (exploded !== geo) geo.dispose();
      geo = exploded;
      geo.computeVertexNormals();
    }
    if (faceColors) applyFaceColors(geo);
    if (pivot === "bottom") geo.translate(0, height / 2, 0);
    if (origin[0] || origin[1] || origin[2]) geo.translate(-origin[0], -origin[1], -origin[2]);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  const poly = applyOrigin(
    buildBoxPolyMesh({
      width,
      height,
      depth,
      segments: seg,
      faceColors,
      pivot,
    }),
    origin,
  );
  const geo = polyMeshToGeometry(poly, flatShading);
  geo.userData.polyMesh = poly;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function buildBoxPolyMesh(opts: {
  width: number;
  height: number;
  depth: number;
  segments: number;
  faceColors: boolean;
  pivot: Pivot;
}): PolyMesh {
  const { width, height, depth, segments: seg, faceColors, pivot } = opts;
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;
  const yOff = pivot === "bottom" ? hh : 0;

  const positions: number[] = [];
  const seen = new Map<string, number>();

  function vert(i: number, j: number, k: number): number {
    const x = (i / seg) * width - hw;
    const y = (j / seg) * height - hh + yOff;
    const z = (k / seg) * depth - hd;
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    let idx = seen.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      seen.set(key, idx);
      positions.push(x, y, z);
    }
    return idx;
  }

  const faces: PolyFace[] = [];

  function quad(
    indices: number[],
    normal: [number, number, number],
    uvs: Array<[number, number]>,
    colorIndex: number,
  ) {
    const c = FACE_COLORS[colorIndex]!;
    faces.push({
      indices,
      normal,
      uvs,
      color: faceColors ? [c.r, c.g, c.b] : undefined,
    });
  }

  for (let j = 0; j < seg; j++) {
    for (let k = 0; k < seg; k++) {
      quad(
        [vert(seg, j, k + 1), vert(seg, j, k), vert(seg, j + 1, k), vert(seg, j + 1, k + 1)],
        [1, 0, 0],
        [
          [1 - (k + 1) / seg, j / seg],
          [1 - k / seg, j / seg],
          [1 - k / seg, (j + 1) / seg],
          [1 - (k + 1) / seg, (j + 1) / seg],
        ],
        0,
      );
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let k = 0; k < seg; k++) {
      quad(
        [vert(0, j, k), vert(0, j, k + 1), vert(0, j + 1, k + 1), vert(0, j + 1, k)],
        [-1, 0, 0],
        [
          [k / seg, j / seg],
          [(k + 1) / seg, j / seg],
          [(k + 1) / seg, (j + 1) / seg],
          [k / seg, (j + 1) / seg],
        ],
        1,
      );
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < seg; k++) {
      quad(
        [vert(i, seg, k + 1), vert(i + 1, seg, k + 1), vert(i + 1, seg, k), vert(i, seg, k)],
        [0, 1, 0],
        [
          [i / seg, 1 - (k + 1) / seg],
          [(i + 1) / seg, 1 - (k + 1) / seg],
          [(i + 1) / seg, 1 - k / seg],
          [i / seg, 1 - k / seg],
        ],
        2,
      );
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < seg; k++) {
      quad(
        [vert(i, 0, k), vert(i + 1, 0, k), vert(i + 1, 0, k + 1), vert(i, 0, k + 1)],
        [0, -1, 0],
        [
          [i / seg, k / seg],
          [(i + 1) / seg, k / seg],
          [(i + 1) / seg, (k + 1) / seg],
          [i / seg, (k + 1) / seg],
        ],
        3,
      );
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      quad(
        [vert(i, j, seg), vert(i + 1, j, seg), vert(i + 1, j + 1, seg), vert(i, j + 1, seg)],
        [0, 0, 1],
        [
          [i / seg, j / seg],
          [(i + 1) / seg, j / seg],
          [(i + 1) / seg, (j + 1) / seg],
          [i / seg, (j + 1) / seg],
        ],
        4,
      );
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      quad(
        [vert(i + 1, j, 0), vert(i, j, 0), vert(i, j + 1, 0), vert(i + 1, j + 1, 0)],
        [0, 0, -1],
        [
          [1 - (i + 1) / seg, j / seg],
          [1 - i / seg, j / seg],
          [1 - i / seg, (j + 1) / seg],
          [1 - (i + 1) / seg, (j + 1) / seg],
        ],
        5,
      );
    }
  }

  return { positions, faces };
}

const INDEXED_FACE_MIN = 12_000;

export function polyMeshToGeometry(
  poly: PolyMesh,
  flatShading: boolean,
  materialOrder?: string[],
): THREE.BufferGeometry {
  if (poly.faces.length >= INDEXED_FACE_MIN) {
    return polyMeshToIndexedGeometry(poly, materialOrder);
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  let hasColor = false;
  const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
  const order = materialOrder ?? [];
  const indexOf = (name: string | undefined) => {
    if (!name || order.length === 0) return 0;
    const i = order.indexOf(name);
    return i >= 0 ? i : 0;
  };
  const faces =
    order.length > 0
      ? [...poly.faces].sort((a, b) => indexOf(a.material) - indexOf(b.material))
      : poly.faces;
  let groupMat = -1;
  let groupStart = 0;
  const flushGroup = (nextMat: number) => {
    if (groupMat < 0) {
      groupMat = nextMat;
      groupStart = 0;
      return;
    }
    const count = positions.length / 3 - groupStart;
    if (count > 0) groups.push({ start: groupStart, count, materialIndex: groupMat });
    groupMat = nextMat;
    groupStart = positions.length / 3;
  };

  for (const face of faces) {
    const idx = face.indices;
    if (idx.length < 3) continue;
    if (order.length > 0) {
      const mi = indexOf(face.material);
      if (mi !== groupMat) flushGroup(mi);
    }
    const tris = tessellateFace(poly.positions, idx, face.normal);
    for (const [ia, ib, ic] of tris) {
      for (const o of [ia, ib, ic]) {
        const vi = idx[o]!;
        positions.push(
          poly.positions[vi * 3]!,
          poly.positions[vi * 3 + 1]!,
          poly.positions[vi * 3 + 2]!,
        );
        normals.push(face.normal[0], face.normal[1], face.normal[2]);
        const uv = face.uvs[o] ?? [0, 0];
        uvs.push(uv[0], uv[1]);
        if (face.color) {
          hasColor = true;
          colors.push(face.color[0], face.color[1], face.color[2]);
        }
      }
    }
  }
  if (order.length > 0) flushGroup(groupMat);
  if (groups.length === 0 && order.length > 0 && positions.length >= 3) {
    groups.push({ start: 0, count: positions.length / 3, materialIndex: 0 });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (hasColor) {
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  if (!flatShading) {
    geo.computeVertexNormals();
  }
  return geo;
}

function applyFaceColors(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  if (!pos || !nrm) return;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let color: THREE.Color;
    if (ax >= ay && ax >= az) color = nx >= 0 ? FACE_COLORS[0] : FACE_COLORS[1];
    else if (ay >= ax && ay >= az) color = ny >= 0 ? FACE_COLORS[2] : FACE_COLORS[3];
    else color = nz >= 0 ? FACE_COLORS[4] : FACE_COLORS[5];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export function measureGeometry(geo: THREE.BufferGeometry): MeshStats {
  const poly = geo.userData.polyMesh as PolyMesh | undefined;
  if (poly) return measurePoly(poly);
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const triangles = index ? index.count / 3 : pos ? pos.count / 3 : 0;
  const vertices = pos ? pos.count : 0;
  const unique = countUniquePositions(geo);
  return { vertices, triangles, unique, faces: triangles };
}

function countUniquePositions(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute("position");
  if (!pos) return 0;
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    seen.add(
      `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`,
    );
  }
  return seen.size;
}

export function measurePoly(poly: PolyMesh): MeshStats {
  const unique = poly.positions.length / 3;
  const faces = poly.faces.length;
  const triangles = poly.faces.reduce((n, f) => n + Math.max(0, f.indices.length - 2), 0);
  return { vertices: unique, triangles, unique, faces };
}

export function scalePoly(poly: PolyMesh, scale: number): PolyMesh {
  if (scale === 1) return poly;
  const positions = new Array<number>(poly.positions.length);
  for (let i = 0; i < poly.positions.length; i++) positions[i] = poly.positions[i]! * scale;
  return { positions, faces: poly.faces };
}

export type PolyBounds = {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
};

export function boundsOfPoly(poly: PolyMesh): PolyBounds {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  const p = poly.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!,
      y = p[i + 1]!,
      z = p[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

export function hasMappedUvs(poly: PolyMesh): boolean {
  for (const face of poly.faces) {
    if (faceHasUvs(face)) return true;
  }
  return false;
}

function faceHasUvs(face: PolyFace): boolean {
  if (face.uvs.length < 3) return false;
  let minU = Infinity,
    minV = Infinity,
    maxU = -Infinity,
    maxV = -Infinity;
  let area = 0;
  const u0 = face.uvs[0]!;
  for (let i = 0; i < face.uvs.length; i++) {
    const uv = face.uvs[i]!;
    if (uv[0] < minU) minU = uv[0];
    if (uv[1] < minV) minV = uv[1];
    if (uv[0] > maxU) maxU = uv[0];
    if (uv[1] > maxV) maxV = uv[1];
    if (i >= 2) {
      const a = face.uvs[i - 1]!;
      area += (a[0] - u0[0]) * (uv[1] - u0[1]) - (a[1] - u0[1]) * (uv[0] - u0[0]);
    }
  }
  return Math.abs(area) > 1e-10 || (maxU - minU) * (maxV - minV) > 1e-10;
}

function boxUvForFace(
  poly: PolyMesh,
  face: PolyFace,
  b: ReturnType<typeof boundsOfPoly>,
): Array<[number, number]> {
  const sx = b.size[0] || 1;
  const sy = b.size[1] || 1;
  const sz = b.size[2] || 1;
  const ax = Math.abs(face.normal[0]);
  const ay = Math.abs(face.normal[1]);
  const az = Math.abs(face.normal[2]);
  return face.indices.map((i) => {
    const x = poly.positions[i * 3]!;
    const y = poly.positions[i * 3 + 1]!;
    const z = poly.positions[i * 3 + 2]!;
    if (ax >= ay && ax >= az) return [(z - b.min[2]) / sz, (y - b.min[1]) / sy] as [number, number];
    if (ay >= ax && ay >= az) return [(x - b.min[0]) / sx, (z - b.min[2]) / sz] as [number, number];
    return [(x - b.min[0]) / sx, (y - b.min[1]) / sy] as [number, number];
  });
}

export function applyBoxUvs(poly: PolyMesh): PolyMesh {
  const b = boundsOfPoly(poly);
  let changed = false;
  const faces = poly.faces.map((face) => {
    if (faceHasUvs(face)) return face;
    changed = true;
    return { ...face, uvs: boxUvForFace(poly, face, b) };
  });
  return changed ? { positions: poly.positions, faces } : poly;
}

export function placePoly(poly: PolyMesh, pivot: Pivot): PolyMesh {
  const b = boundsOfPoly(poly);
  const ox = b.center[0];
  const oz = b.center[2];
  const oy = pivot === "bottom" ? b.min[1] : b.center[1];
  const positions = poly.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]! -= ox;
    positions[i + 1]! -= oy;
    positions[i + 2]! -= oz;
  }
  return { positions, faces: poly.faces };
}

export function guessImportScale(poly: PolyMesh): number {
  const b = boundsOfPoly(poly);
  const maxDim = Math.max(b.size[0], b.size[1], b.size[2]);
  if (maxDim > 0 && maxDim < 8) return 100;
  return 1;
}

export function originOf(params: {
  originX?: number;
  originY?: number;
  originZ?: number;
}): [number, number, number] {
  return [params.originX ?? 0, params.originY ?? 0, params.originZ ?? 0];
}

export function applyOrigin(poly: PolyMesh, origin: [number, number, number]): PolyMesh {
  const [ox, oy, oz] = origin;
  if (ox === 0 && oy === 0 && oz === 0) return poly;
  const positions = poly.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]! -= ox;
    positions[i + 1]! -= oy;
    positions[i + 2]! -= oz;
  }
  return { positions, faces: poly.faces };
}

export function orientPolyOutward(poly: PolyMesh): PolyMesh {
  const b = boundsOfPoly(poly);
  const cx = b.center[0];
  const cy = b.center[1];
  const cz = b.center[2];
  let inward = 0;
  let outward = 0;
  for (const face of poly.faces) {
    let sx = 0,
      sy = 0,
      sz = 0;
    for (const i of face.indices) {
      sx += poly.positions[i * 3]!;
      sy += poly.positions[i * 3 + 1]!;
      sz += poly.positions[i * 3 + 2]!;
    }
    const n = face.indices.length || 1;
    const dx = sx / n - cx;
    const dy = sy / n - cy;
    const dz = sz / n - cz;
    const facing =
      face.normal[0] * dx + face.normal[1] * dy + face.normal[2] * dz;
    if (facing < 0) inward += 1;
    else outward += 1;
  }
  if (inward <= outward) return poly;
  const faces = poly.faces.map((face) => ({
    ...face,
    indices: face.indices.slice().reverse(),
    uvs: face.uvs.slice().reverse(),
    normal: [-face.normal[0], -face.normal[1], -face.normal[2]] as [
      number,
      number,
      number,
    ],
  }));
  return { positions: poly.positions, faces };
}

export function flipPolyFaces(poly: PolyMesh): PolyMesh {
  const faces = poly.faces.map((face) => ({
    ...face,
    indices: face.indices.slice().reverse(),
    uvs: face.uvs.slice().reverse(),
    normal: [-face.normal[0], -face.normal[1], -face.normal[2]] as [
      number,
      number,
      number,
    ],
  }));
  return { positions: poly.positions, faces };
}

/** Fan signed volume (×6). Negative means the stored winding is inward. */
export function polySignedVolume(poly: PolyMesh): number {
  let v = 0;
  const p = poly.positions;
  for (const face of poly.faces) {
    const idx = face.indices;
    if (idx.length < 3) continue;
    const i0 = idx[0]!;
    const ax = p[i0 * 3]!;
    const ay = p[i0 * 3 + 1]!;
    const az = p[i0 * 3 + 2]!;
    for (let t = 1; t < idx.length - 1; t++) {
      const i1 = idx[t]!;
      const i2 = idx[t + 1]!;
      const bx = p[i1 * 3]!;
      const by = p[i1 * 3 + 1]!;
      const bz = p[i1 * 3 + 2]!;
      const cx = p[i2 * 3]!;
      const cy = p[i2 * 3 + 1]!;
      const cz = p[i2 * 3 + 2]!;
      v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
  }
  return v;
}

export function ensureOutwardWinding(poly: PolyMesh): PolyMesh {
  const b = boundsOfPoly(poly);
  const scale = Math.max(b.size[0] * b.size[1] * b.size[2], 1e-8);
  if (polySignedVolume(poly) >= -1e-6 * scale) return poly;
  return flipPolyFaces(poly);
}

export function polyMeshToUvPreview(poly: PolyMesh): THREE.BufferGeometry {
  return polyMeshToGeometry(applyBoxUvs(poly), true);
}
export function polyMeshToNormalPreview(poly: PolyMesh): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const face of poly.faces) {
    const idx = face.indices;
    if (idx.length < 3) continue;
    const n = face.normal;
    const tris = tessellateFace(poly.positions, idx, n);
    for (const tri of tris) {
      for (const o of tri) {
        const vi = idx[o]!;
        positions.push(
          poly.positions[vi * 3]!,
          poly.positions[vi * 3 + 1]!,
          poly.positions[vi * 3 + 2]!,
        );
        normals.push(n[0], n[1], n[2]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

export function polyMeshNormalTicks(poly: PolyMesh, maxFaces = 5000): Float32Array {
  const b = boundsOfPoly(poly);
  const scale = Math.max(b.size[0], b.size[1], b.size[2], 1) * 0.07;
  const step = poly.faces.length > maxFaces ? Math.ceil(poly.faces.length / maxFaces) : 1;
  const pts: number[] = [];
  for (let f = 0; f < poly.faces.length; f += step) {
    const face = poly.faces[f]!;
    if (face.indices.length < 3) continue;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const i of face.indices) {
      cx += poly.positions[i * 3]!;
      cy += poly.positions[i * 3 + 1]!;
      cz += poly.positions[i * 3 + 2]!;
    }
    const inv = 1 / face.indices.length;
    cx *= inv;
    cy *= inv;
    cz *= inv;
    const nx = face.normal[0];
    const ny = face.normal[1];
    const nz = face.normal[2];
    const len = Math.hypot(nx, ny, nz) || 1;
    pts.push(cx, cy, cz, cx + (nx / len) * scale, cy + (ny / len) * scale, cz + (nz / len) * scale);
  }
  return new Float32Array(pts);
}

function polyMeshToIndexedGeometry(
  poly: PolyMesh,
  materialOrder?: string[],
): THREE.BufferGeometry {
  const order = materialOrder ?? [];
  const indexOf = (name: string | undefined) => {
    if (!name || order.length === 0) return 0;
    const i = order.indexOf(name);
    return i >= 0 ? i : 0;
  };
  const faces =
    order.length > 0
      ? [...poly.faces].sort((a, b) => indexOf(a.material) - indexOf(b.material))
      : poly.faces;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const map = new Map<number, number>();
  let hasColor = false;
  const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
  let groupMat = -1;
  let groupStart = 0;

  const weld = (
    vi: number,
    uv: [number, number],
    n: [number, number, number],
    col?: [number, number, number],
  ) => {
    const uq = Math.round(uv[0] * 4095) & 4095;
    const vq = Math.round(uv[1] * 4095) & 4095;
    const key = vi * 16777216 + uq * 4096 + vq;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      map.set(key, idx);
      positions.push(
        poly.positions[vi * 3]!,
        poly.positions[vi * 3 + 1]!,
        poly.positions[vi * 3 + 2]!,
      );
      normals.push(n[0], n[1], n[2]);
      uvs.push(uv[0], uv[1]);
      if (col) {
        hasColor = true;
        colors.push(col[0], col[1], col[2]);
      }
    }
    return idx;
  };

  for (const face of faces) {
    const mi = indexOf(face.material);
    if (order.length && mi !== groupMat) {
      if (groupMat >= 0) {
        const count = index.length - groupStart;
        if (count) groups.push({ start: groupStart, count, materialIndex: groupMat });
      }
      groupMat = mi;
      groupStart = index.length;
    }
    const idx = face.indices;
    if (idx.length < 3) continue;
    const tris = tessellateFace(poly.positions, idx, face.normal);
    for (const [ia, ib, ic] of tris) {
      index.push(
        weld(idx[ia]!, face.uvs[ia] ?? [0, 0], face.normal, face.color),
        weld(idx[ib]!, face.uvs[ib] ?? [0, 0], face.normal, face.color),
        weld(idx[ic]!, face.uvs[ic] ?? [0, 0], face.normal, face.color),
      );
    }
  }
  if (order.length && groupMat >= 0) {
    const count = index.length - groupStart;
    if (count) groups.push({ start: groupStart, count, materialIndex: groupMat });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (hasColor) {
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  geo.setIndex(index);
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  return geo;
}
