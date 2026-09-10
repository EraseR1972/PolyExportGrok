import { applyBoxUvs, type PolyFace, type PolyMesh } from "./cube.ts";
import { baseName, mtlRoughness, parseMtl } from "./import-mtl.ts";
import type { ObjMaterial } from "./obj-material.ts";

function resolveIndex(raw: number, count: number): number {
  if (raw < 0) return count + raw;
  return raw - 1;
}

function parseIndexTriple(token: string): [number, number, number] {
  const parts = token.split("/");
  const v = Number.parseInt(parts[0] ?? "", 10);
  const vt = parts[1] ? Number.parseInt(parts[1], 10) : NaN;
  const vn = parts[2] ? Number.parseInt(parts[2], 10) : NaN;
  return [v, vt, vn];
}

export function faceNormal(
  positions: number[],
  indices: number[],
): [number, number, number] {
  let nx = 0,
    ny = 0,
    nz = 0;
  const n = indices.length;
  for (let i = 0; i < n; i++) {
    const a = indices[i]!;
    const b = indices[(i + 1) % n]!;
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const bx = positions[b * 3]!;
    const by = positions[b * 3 + 1]!;
    const bz = positions[b * 3 + 2]!;
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function averageNormal(
  list: Array<[number, number, number]>,
): [number, number, number] | null {
  if (list.length === 0) return null;
  let x = 0,
    y = 0,
    z = 0;
  for (const n of list) {
    x += n[0];
    y += n[1];
    z += n[2];
  }
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/** Prefer authored normals from the file. Reverse winding if it disagrees. */
export function alignFaceToNormal(
  positions: number[],
  indices: number[],
  uvs: Array<[number, number]>,
  authored: [number, number, number] | null,
): { indices: number[]; uvs: Array<[number, number]>; normal: [number, number, number] } {
  const geometric = faceNormal(positions, indices);
  if (!authored) return { indices, uvs, normal: geometric };
  if (geometric[0] * authored[0] + geometric[1] * authored[1] + geometric[2] * authored[2] < 0) {
    indices.reverse();
    uvs.reverse();
  }
  return { indices, uvs, normal: authored };
}

export type ObjDocument = {
  poly: PolyMesh;
  mtllibs: string[];
};

export type ObjProgress = (ratio: number, phase: string) => void;

const MAX_OBJ_BYTES = 4 * 1024 * 1024 * 1024;

function createObjParser() {
  const positions: number[] = [];
  const tex: Array<[number, number]> = [];
  const nrms: Array<[number, number, number]> = [];
  const faces: PolyFace[] = [];
  const mtllibs: string[] = [];
  const matIntern = new Map<string, string>();
  let currentMtl: string | undefined;
  let vertexCount = 0;
  let first = true;

  function intern(name: string) {
    const hit = matIntern.get(name);
    if (hit) return hit;
    matIntern.set(name, name);
    return name;
  }

  function feedLine(rawLine: string) {
    let line = rawLine;
    if (first) {
      first = false;
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    }
    line = line.trim();
    if (!line || line.charCodeAt(0) === 35) return;
    const sp = line.indexOf(" ");
    const tag = sp === -1 ? line : line.slice(0, sp);
    const rest = sp === -1 ? "" : line.slice(sp + 1).trim();

    if (tag === "v") {
      const nums = rest.split(/\s+/);
      const x = Number(nums[0]);
      const y = Number(nums[1]);
      const z = Number(nums[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      positions.push(x, y, z);
      vertexCount += 1;
    } else if (tag === "vt") {
      const nums = rest.split(/\s+/);
      const u = Number(nums[0]);
      const v = Number(nums[1]);
      tex.push([Number.isFinite(u) ? u : 0, Number.isFinite(v) ? v : 0]);
    } else if (tag === "vn") {
      const nums = rest.split(/\s+/);
      const x = Number(nums[0]);
      const y = Number(nums[1]);
      const z = Number(nums[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      const len = Math.hypot(x, y, z) || 1;
      nrms.push([x / len, y / len, z / len]);
    } else if (tag === "mtllib") {
      for (const name of rest.split(/\s+/).filter(Boolean)) {
        mtllibs.push(name.replace(/\\/g, "/"));
      }
    } else if (tag === "usemtl") {
      currentMtl = rest ? intern(rest) : undefined;
    } else if (tag === "f") {
      const tokens = rest.split(/\s+/).filter(Boolean);
      if (tokens.length < 3) return;
      const indices: number[] = [];
      const uvs: Array<[number, number]> = [];
      const cornerN: Array<[number, number, number]> = [];
      for (const token of tokens) {
        const [vi, vti, vni] = parseIndexTriple(token);
        if (!Number.isFinite(vi) || vi === 0) return;
        const idx = resolveIndex(vi, vertexCount);
        if (idx < 0 || idx >= vertexCount) return;
        indices.push(idx);
        if (Number.isFinite(vti) && vti !== 0) {
          const uvi = resolveIndex(vti, tex.length);
          uvs.push(tex[uvi] ?? [0, 0]);
        } else {
          uvs.push([0, 0]);
        }
        if (Number.isFinite(vni) && vni !== 0) {
          const ni = resolveIndex(vni, nrms.length);
          const nn = nrms[ni];
          if (nn) cornerN.push(nn);
        }
      }
      if (indices.length < 3) return;
      const aligned = alignFaceToNormal(positions, indices, uvs, averageNormal(cornerN));
      faces.push({
        indices: aligned.indices,
        normal: aligned.normal,
        uvs: aligned.uvs,
        material: currentMtl,
      });
    }
  }

  function finish(): ObjDocument {
    if (vertexCount < 3 || faces.length === 0) {
      throw new Error("OBJ has no usable mesh");
    }
    return { poly: applyBoxUvs({ positions, faces }), mtllibs };
  }

  return { feedLine, finish };
}

export function parseObj(text: string): PolyMesh {
  return parseObjDocument(text).poly;
}

export function parseObjDocument(text: string): ObjDocument {
  const parser = createObjParser();
  const raw = text.replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) parser.feedLine(line);
  return parser.finish();
}

function yieldToMain() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function parseObjFile(file: File, onProgress?: ObjProgress): Promise<ObjDocument> {
  const parser = createObjParser();
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  let carry = "";
  let offset = 0;
  let sinceYield = 0;
  const total = Math.max(1, file.size);

  onProgress?.(0, `Reading ${formatBytes(file.size)}`);

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    offset += value.byteLength;
    sinceYield += value.byteLength;
    carry += decoder.decode(value, { stream: true });
    let start = 0;
    for (let i = 0; i < carry.length; i++) {
      if (carry.charCodeAt(i) !== 10) continue;
      let line = carry.slice(start, i);
      if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
      parser.feedLine(line);
      start = i + 1;
    }
    if (start) carry = carry.slice(start);
    if (sinceYield >= 2 * 1024 * 1024) {
      sinceYield = 0;
      onProgress?.(Math.min(0.97, offset / total), `Reading ${formatBytes(file.size)}`);
      await yieldToMain();
    }
  }
  carry += decoder.decode();
  if (carry) parser.feedLine(carry.replace(/\r$/, ""));
  onProgress?.(0.98, "Building mesh");
  const doc = parser.finish();
  onProgress?.(1, "Building mesh");
  return doc;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) {
    const mb = n / (1024 * 1024);
    return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function stemFromFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "mesh";
  const noExt = base.replace(/\.(obj|fbx|lwo|lwob|glb|gltf)$/i, "");
  const cleaned = noExt.replace(/[^\w\- ]+/g, "").trim() || "mesh";
  return cleaned.replace(/\s+/g, "_").slice(0, 48);
}

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif)$/i;

export type ObjBundle = {
  fileName: string;
  poly: PolyMesh;
  materials: ObjMaterial[];
  missingMtl: boolean;
  mapsLoaded: number;
  bytes: number;
};

function fileIndex(files: File[]) {
  const map = new Map<string, File>();
  for (const file of files) {
    const name = baseName(file.name).toLowerCase();
    if (!map.has(name)) map.set(name, file);
  }
  return map;
}

export async function readObjBundle(
  files: File[] | FileList,
  onProgress?: ObjProgress,
): Promise<ObjBundle> {
  const list = [...files];
  const byName = fileIndex(list);
  const objFile =
    list.find((f) => /\.obj$/i.test(f.name)) ??
    (list.length === 1 && !IMAGE_EXT.test(list[0]!.name) ? list[0]! : undefined);
  if (!objFile) throw new Error("Choose an .obj file");
  const name = objFile.name || "mesh.obj";
  if (objFile.size > MAX_OBJ_BYTES) {
    throw new Error("OBJ is larger than 4 GB");
  }

  const doc = await parseObjFile(objFile, onProgress);
  const used = new Set<string>();
  for (const face of doc.poly.faces) {
    if (face.material) used.add(face.material);
  }

  onProgress?.(1, "Loading materials");

  const mtlFiles: File[] = [];
  for (const lib of doc.mtllibs) {
    const hit = byName.get(baseName(lib).toLowerCase());
    if (hit) mtlFiles.push(hit);
  }
  if (mtlFiles.length === 0) {
    const loose = list.find((f) => /\.mtl$/i.test(f.name));
    if (loose) mtlFiles.push(loose);
  }

  const defs = [];
  for (const mtl of mtlFiles) {
    defs.push(...parseMtl(await mtl.text()));
  }
  const defByName = new Map(defs.map((d) => [d.name, d]));

  const materials: ObjMaterial[] = [];
  const seen = new Set<string>();
  const names = used.size > 0 ? [...used] : defs.map((d) => d.name);
  for (const matName of names) {
    if (seen.has(matName)) continue;
    seen.add(matName);
    const def = defByName.get(matName);
    const mapPath = def?.mapKd;
    const mapFile = mapPath ? byName.get(baseName(mapPath).toLowerCase()) : undefined;
    let color = def?.kd ?? ([0.77, 0.75, 0.71] as [number, number, number]);
    if (mapFile && color[0] + color[1] + color[2] < 0.04) color = [1, 1, 1];
    materials.push({
      name: matName,
      color,
      roughness: mtlRoughness(def?.ns ?? 200),
      metalness: 0.04,
      opacity: def?.d ?? 1,
      mapName: mapFile ? mapFile.name : mapPath ? baseName(mapPath) : undefined,
      mapUrl: mapFile ? URL.createObjectURL(mapFile) : undefined,
    });
  }

  return {
    fileName: name,
    poly: doc.poly,
    materials,
    missingMtl: Boolean(doc.mtllibs.length || used.size) && mtlFiles.length === 0,
    mapsLoaded: materials.filter((m) => m.mapUrl).length,
    bytes: objFile.size,
  };
}

export async function readObjFile(file: File): Promise<{
  fileName: string;
  poly: PolyMesh;
}> {
  const bundle = await readObjBundle([file]);
  return { fileName: bundle.fileName, poly: bundle.poly };
}
