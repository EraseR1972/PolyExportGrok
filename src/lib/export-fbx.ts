import type { BufferGeometry } from "three";
import type { PolyMesh } from "@/lib/cube";
import { saveBlob } from "./download-file.ts";

export type FbxAxis = "y-up" | "z-up";

export type FbxExportOptions = {
  name: string;
  axis: FbxAxis;
  color: [number, number, number];
  specular?: number;
  wireframeOnly?: boolean;
  materials?: Array<{
    name: string;
    color: [number, number, number];
    opacity?: number;
  }>;
};

type ExtractedMesh = {
  vertices: number[];
  polygonIndex: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  polygonCount: number;
  faceMaterials: number[];
};

function keyPos(x: number, y: number, z: number) {
  return `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
}

function convertAxis(x: number, y: number, z: number, axis: FbxAxis) {
  // Y-up (Three.js) → Z-up (Unreal): +90° around X, baked into vertices
  // so the mesh stands at identity rotation. (x, y, z) → (x, -z, y)
  if (axis === "z-up") return { x, y: -z, z: y };
  return { x, y, z };
}

function materialSlot(name: string | undefined, names: string[]) {
  if (!name || names.length === 0) return 0;
  const i = names.indexOf(name);
  return i >= 0 ? i : 0;
}

function extractFromPoly(poly: PolyMesh, axis: FbxAxis, materialNames: string[]): ExtractedMesh {
  const vertices: number[] = [];
  for (let i = 0; i < poly.positions.length; i += 3) {
    const p = convertAxis(poly.positions[i]!, poly.positions[i + 1]!, poly.positions[i + 2]!, axis);
    vertices.push(p.x, p.y, p.z);
  }

  const polygonIndex: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const faceMaterials: number[] = [];

  for (const face of poly.faces) {
    const n = convertAxis(face.normal[0], face.normal[1], face.normal[2], axis);
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    const nx = n.x / len;
    const ny = n.y / len;
    const nz = n.z / len;
    for (let k = 0; k < face.indices.length; k++) {
      const idx = face.indices[k]!;
      const last = k === face.indices.length - 1;
      polygonIndex.push(last ? -(idx + 1) : idx);
      normals.push(nx, ny, nz);
      const uv = face.uvs[k] ?? [0, 0];
      uvs.push(uv[0], uv[1]);
      if (face.color) colors.push(face.color[0], face.color[1], face.color[2], 1);
    }
    faceMaterials.push(materialSlot(face.material, materialNames));
  }

  return {
    vertices,
    polygonIndex,
    normals,
    uvs,
    colors,
    polygonCount: poly.faces.length,
    faceMaterials,
  };
}

function extractMesh(
  geo: BufferGeometry,
  axis: FbxAxis,
  materialNames: string[] = [],
): ExtractedMesh {
  const poly = geo.userData.polyMesh as PolyMesh | undefined;
  if (poly && poly.faces.length > 0) return extractFromPoly(poly, axis, materialNames);

  const source = geo.index ? geo.toNonIndexed() : geo;
  const pos = source.getAttribute("position");
  const nrm = source.getAttribute("normal");
  const uv = source.getAttribute("uv");
  const col = source.getAttribute("color");
  if (!pos) {
    if (source !== geo) source.dispose();
    return {
      vertices: [],
      polygonIndex: [],
      normals: [],
      uvs: [],
      colors: [],
      polygonCount: 0,
      faceMaterials: [],
    };
  }

  const vertexMap = new Map<string, number>();
  const vertices: number[] = [];
  const polygonIndex: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const faceMaterials: number[] = [];

  const triCount = Math.floor(pos.count / 3);
  for (let t = 0; t < triCount; t++) {
    const face: number[] = [];
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      const p = convertAxis(pos.getX(i), pos.getY(i), pos.getZ(i), axis);
      const key = keyPos(p.x, p.y, p.z);
      let idx = vertexMap.get(key);
      if (idx === undefined) {
        idx = vertices.length / 3;
        vertexMap.set(key, idx);
        vertices.push(p.x, p.y, p.z);
      }
      face.push(idx);

      if (nrm) {
        const n = convertAxis(nrm.getX(i), nrm.getY(i), nrm.getZ(i), axis);
        const len = Math.hypot(n.x, n.y, n.z) || 1;
        normals.push(n.x / len, n.y / len, n.z / len);
      }
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      if (col) {
        colors.push(col.getX(i), col.getY(i), col.getZ(i), 1);
      }
    }
    polygonIndex.push(face[0]!, face[1]!, -(face[2]! + 1));
    faceMaterials.push(0);
  }

  if (source !== geo) source.dispose();
  return { vertices, polygonIndex, normals, uvs, colors, polygonCount: triCount, faceMaterials };
}

function parsePolygons(index: number[]): number[][] {
  const faces: number[][] = [];
  let cur: number[] = [];
  for (const raw of index) {
    if (raw < 0) {
      cur.push(-raw - 1);
      if (cur.length >= 2) faces.push(cur);
      cur = [];
    } else {
      cur.push(raw);
    }
  }
  return faces;
}

function toWireframe(mesh: ExtractedMesh): ExtractedMesh {
  const seen = new Set<string>();
  const polygonIndex: number[] = [];
  const normals: number[] = [];
  const faceMaterials: number[] = [];
  const pos = mesh.vertices;

  for (const face of parsePolygons(mesh.polygonIndex)) {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const a = face[i]!;
      const b = face[(i + 1) % n]!;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (lo === hi) continue;
      const key = `${lo}:${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      polygonIndex.push(a, -(b + 1));
      const ax = pos[a * 3] ?? 0;
      const ay = pos[a * 3 + 1] ?? 0;
      const az = pos[a * 3 + 2] ?? 0;
      const bx = pos[b * 3] ?? 0;
      const by = pos[b * 3 + 1] ?? 0;
      const bz = pos[b * 3 + 2] ?? 0;
      let dx = bx - ax;
      let dy = by - ay;
      let dz = bz - az;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      normals.push(dx, dy, dz, dx, dy, dz);
      faceMaterials.push(0);
    }
  }

  return {
    vertices: mesh.vertices,
    polygonIndex,
    normals,
    uvs: [],
    colors: [],
    polygonCount: polygonIndex.length / 2,
    faceMaterials,
  };
}

function fmt(n: number, digits = 6) {
  if (!Number.isFinite(n)) return "0";
  const v = Math.abs(n) < 1e-12 ? 0 : n;
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

function fbxArray(name: string, values: number[], indent: string, int = false) {
  const body = values.map((v) => (int ? String(v) : fmt(v))).join(",");
  return `${indent}${name}: *${values.length} {\n${indent}\ta: ${body}\n${indent}}`;
}

function nowStamp() {
  const d = new Date();
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}
