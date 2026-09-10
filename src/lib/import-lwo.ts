import { applyBoxUvs, ensureOutwardWinding, type PolyFace, type PolyMesh } from "./cube.ts";
import { alignFaceToNormal, averageNormal } from "./import-obj.ts";
import type { ObjMaterial } from "./obj-material.ts";

export type LwoDocument = {
  poly: PolyMesh;
  materials: ObjMaterial[];
};

class BeReader {
  dv: DataView;
  offset = 0;
  bytes: Uint8Array;
  decoder = new TextDecoder("latin1");

  constructor(buffer: ArrayBuffer) {
    this.dv = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }

  remaining() {
    return this.dv.byteLength - this.offset;
  }

  skip(n: number) {
    this.offset += n;
  }

  align2() {
    if (this.offset & 1) this.offset += 1;
  }

  u8() {
    const v = this.dv.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16() {
    const v = this.dv.getUint16(this.offset);
    this.offset += 2;
    return v;
  }

  i16() {
    const v = this.dv.getInt16(this.offset);
    this.offset += 2;
    return v;
  }

  u32() {
    const v = this.dv.getUint32(this.offset);
    this.offset += 4;
    return v;
  }

  f32() {
    const v = this.dv.getFloat32(this.offset);
    this.offset += 4;
    return v;
  }

  id4() {
    const s = this.decoder.decode(this.bytes.subarray(this.offset, this.offset + 4));
    this.offset += 4;
    return s;
  }

  vx() {
    const a = this.u8();
    if (a !== 0xff) {
      this.offset -= 1;
      return this.u16();
    }
    return (this.u8() << 16) | this.u16();
  }

  cstr(): string {
    const start = this.offset;
    while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0) this.offset += 1;
    const s = this.decoder.decode(this.bytes.subarray(start, this.offset));
    this.offset += 1;
    if ((this.offset - start) % 2 === 1) this.offset += 1;
    return s;
  }

  stringArray(end: number): string[] {
    const out: string[] = [];
    while (this.offset < end) {
      const s = this.cstr();
      if (s) out.push(s);
    }
    this.offset = end;
    return out;
  }
}

type Layer = {
  points: number[];
  faces: Array<{ indices: number[]; material?: string }>;
  uvByVert: Map<number, [number, number]>;
  uvByPolyVert: Map<string, [number, number]>;
  nByVert: Map<number, [number, number, number]>;
  nByPolyVert: Map<string, [number, number, number]>;
};

function defaultMat(name: string, color: [number, number, number] = [0.77, 0.75, 0.71]): ObjMaterial {
  return { name, color, roughness: 0.72, metalness: 0.04, opacity: 1 };
}

export function lightWaveFaceNormal(
  appPos: number[],
  indices: number[],
): [number, number, number] | null {
  if (indices.length < 3) return null;
  const i0 = indices[0]!;
  const i1 = indices[1]!;
  const il = indices[indices.length - 1]!;
  const p0x = -appPos[i0 * 3]!;
  const p0y = appPos[i0 * 3 + 1]!;
  const p0z = appPos[i0 * 3 + 2]!;
  const ax = -appPos[il * 3]! - p0x;
  const ay = appPos[il * 3 + 1]! - p0y;
  const az = appPos[il * 3 + 2]! - p0z;
  const bx = -appPos[i1 * 3]! - p0x;
  const by = appPos[i1 * 3 + 1]! - p0y;
  const bz = appPos[i1 * 3 + 2]! - p0z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  return [-nx / len, ny / len, nz / len];
}

function parseSurf(r: BeReader, end: number): ObjMaterial {
  const name = r.cstr();
  if (r.offset < end) {
    const maybeSrc = r.bytes[r.offset];
    if (maybeSrc === 0) r.cstr();
    else if (maybeSrc >= 32 && maybeSrc < 127) r.cstr();
  }
  let color: [number, number, number] = [0.77, 0.75, 0.71];
  while (r.offset + 8 <= end) {
    const id = r.id4();
    const size = r.u32();
    const chunkEnd = Math.min(r.offset + size, end);
    if (id === "COLR" && size >= 12) {
      color = [r.f32(), r.f32(), r.f32()];
    }
    r.offset = chunkEnd;
    if (size & 1) r.offset += 1;
  }
  r.offset = end;
  return defaultMat(name || "Default", color);
}

function parsePolsLwo2(r: BeReader, end: number): number[][] {
  const type = r.id4();
  const faces: number[][] = [];
  if (type !== "FACE" && type !== "PTCH" && type !== "MBAL" && type !== "BONE") {
    r.offset = end;
    return faces;
  }
  while (r.offset + 2 <= end) {
    const packed = r.u16();
    const n = packed & 1023;
    const indices: number[] = [];
    for (let i = 0; i < n && r.offset < end; i++) indices.push(r.vx());
    if (n >= 2) faces.push(indices);
  }
  r.offset = end;
  return faces;
}

function parsePolsLwob(r: BeReader, end: number): number[][] {
  const faces: number[][] = [];
  while (r.offset + 2 <= end) {
    const n = r.u16();
    const indices: number[] = [];
    for (let i = 0; i < n && r.offset + 2 <= end; i++) {
      let idx = r.i16();
      if (i === n - 1 && idx < 0) idx = -idx - 1;
      indices.push(idx);
    }
    if (n >= 2) faces.push(indices);
  }
  r.offset = end;
  return faces;
}

export function parseLwo(buffer: ArrayBuffer): LwoDocument {
  const r = new BeReader(buffer);
  if (r.remaining() < 12 || r.id4() !== "FORM") throw new Error("Not a valid LWO file");
  const formSize = r.u32();
  const formEnd = Math.min(r.offset + formSize, buffer.byteLength);
  const kind = r.id4();
  if (kind !== "LWO2" && kind !== "LWO3" && kind !== "LWOB") {
    throw new Error(`Unsupported LWO type ${kind}`);
  }
  const lwob = kind === "LWOB";

  const tags: string[] = [];
  const materials: ObjMaterial[] = [];
  const layers: Layer[] = [];
  let current: Layer | null = null;

  function ensureLayer(): Layer {
    if (!current) {
      current = {
        points: [],
        faces: [],
        uvByVert: new Map(),
        uvByPolyVert: new Map(),
        nByVert: new Map(),
        nByPolyVert: new Map(),
      };
      layers.push(current);
    }
    return current;
  }

  function walk(end: number) {
    while (r.offset + 8 <= end) {
      const id = r.id4();
      const size = r.u32();
      const chunkEnd = Math.min(r.offset + size, end);
      if (id === "FORM") {
        if (r.offset + 4 <= chunkEnd) r.id4();
        walk(chunkEnd);
      } else if (id === "PNTS") {
        current = {
        points: [],
        faces: [],
        uvByVert: new Map(),
        uvByPolyVert: new Map(),
        nByVert: new Map(),
        nByPolyVert: new Map(),
      };
        layers.push(current);
        while (r.offset + 12 <= chunkEnd) {
          const x = r.f32();
          const y = r.f32();
          const z = r.f32();
          current.points.push(-x, y, z);
        }
      } else if (id === "POLS") {
        const layer = ensureLayer();
        const polys = lwob ? parsePolsLwob(r, chunkEnd) : parsePolsLwo2(r, chunkEnd);
        for (const indices of polys) layer.faces.push({ indices });
      } else if (id === "TAGS") {
        tags.push(...r.stringArray(chunkEnd));
      } else if (id === "PTAG") {
        const layer = current;
        const type = r.offset + 4 <= chunkEnd ? r.id4() : "";
        if (layer && type === "SURF") {
          let face = 0;
          while (r.offset + 2 <= chunkEnd) {
            const polyIndex = r.vx();
            const tag = r.u16();
            const name = tags[tag];
            const target = layer.faces[polyIndex] ?? layer.faces[face];
            if (target && name) target.material = name;
            face += 1;
          }
        }
      } else if (id === "SURF") {
        materials.push(parseSurf(r, chunkEnd));
      } else if (id === "VMAP" || id === "VMAD") {
        const layer = current;
        const type = r.offset + 4 <= chunkEnd ? r.id4() : "";
        const dim = r.offset + 2 <= chunkEnd ? r.u16() : 0;
        r.cstr();
        if (layer && type === "TXUV" && dim === 2) {
          while (r.offset + 2 <= chunkEnd) {
            const vert = r.vx();
            if (id === "VMAD") {
              const poly = r.vx();
              const u = r.f32();
              const v = r.f32();
              layer.uvByPolyVert.set(`${poly}:${vert}`, [u, v]);
            } else {
              const u = r.f32();
              const v = r.f32();
              layer.uvByVert.set(vert, [u, v]);
            }
          }
        } else if (layer && type === "NORM" && dim === 3) {
          while (r.offset + 2 <= chunkEnd) {
            const vert = r.vx();
            const poly = id === "VMAD" ? r.vx() : -1;
            const nx = r.f32();
            const ny = r.f32();
            const nz = r.f32();
            const n: [number, number, number] = [-nx, ny, nz];
            const len = Math.hypot(n[0], n[1], n[2]) || 1;
            n[0] /= len;
            n[1] /= len;
            n[2] /= len;
            if (id === "VMAD") layer.nByPolyVert.set(`${poly}:${vert}`, n);
            else layer.nByVert.set(vert, n);
          }
        }
      }
      r.offset = chunkEnd;
      if (size & 1) r.offset += 1;
    }
  }

  walk(formEnd);

  const positions: number[] = [];
  const faces: PolyFace[] = [];
  for (const layer of layers) {
    const offset = positions.length / 3;
    positions.push(...layer.points);
    for (let fi = 0; fi < layer.faces.length; fi++) {
      const face = layer.faces[fi]!;
      if (face.indices.length < 3) continue;
      const indices = face.indices.map((i) => i + offset);
      const uvs = face.indices.map(
        (vert) =>
          layer.uvByPolyVert.get(`${fi}:${vert}`) ??
          layer.uvByVert.get(vert) ??
          ([0, 0] as [number, number]),
      );
      const authored =
        averageNormal(
          face.indices
            .map(
              (vert) =>
                layer.nByPolyVert.get(`${fi}:${vert}`) ?? layer.nByVert.get(vert),
            )
            .filter((n): n is [number, number, number] => Boolean(n)),
        ) ?? lightWaveFaceNormal(positions, indices);
      const aligned = alignFaceToNormal(positions, indices, uvs, authored);
      faces.push({
        indices: aligned.indices,
        uvs: aligned.uvs,
        normal: aligned.normal,
        material: face.material,
      });
    }
  }

  if (faces.length === 0 || positions.length < 9) throw new Error("LWO has no usable mesh");

  const used = new Set(faces.map((f) => f.material).filter(Boolean) as string[]);
  const mats =
    materials.length > 0
      ? materials
      : [...used].map((name) => defaultMat(name));

  return { poly: applyBoxUvs(ensureOutwardWinding({ positions, faces })), materials: mats };
}

export async function parseLwoFile(file: File): Promise<LwoDocument> {
  return parseLwo(await file.arrayBuffer());
}
