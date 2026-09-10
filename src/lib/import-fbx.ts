import { applyBoxUvs, type PolyFace, type PolyMesh } from "./cube.ts";
import { alignFaceToNormal, averageNormal } from "./import-obj.ts";
import type { ObjMaterial } from "./obj-material.ts";
import { groupToPoly } from "./three-to-poly.ts";

export type FbxDocument = {
  poly: PolyMesh;
  materials: ObjMaterial[];
};

function extractBlocks(text: string, kind: string): string[] {
  const tag = `${kind}:`;
  const blocks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = text.indexOf(tag, i);
    if (hit < 0) break;
    const prev = hit === 0 ? 10 : text.charCodeAt(hit - 1);
    if (prev > 32 && prev !== 123 && prev !== 10 && prev !== 13 && prev !== 9) {
      i = hit + tag.length;
      continue;
    }
    const brace = text.indexOf("{", hit);
    if (brace < 0) break;
    let depth = 1;
    let j = brace + 1;
    while (j < text.length && depth > 0) {
      const c = text.charCodeAt(j);
      if (c === 123) depth += 1;
      else if (c === 125) depth -= 1;
      j += 1;
    }
    blocks.push(text.slice(hit, j));
    i = j;
  }
  return blocks;
}

function parseNumberList(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(/[,\s]+/)) {
    if (!tok) continue;
    const n = Number(tok);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function parseFbxArray(block: string, key: string): number[] {
  const tag = `${key}:`;
  let from = 0;
  while (from < block.length) {
    const start = block.indexOf(tag, from);
    if (start < 0) return [];
    const prev = start === 0 ? 10 : block.charCodeAt(start - 1);
    if (prev > 32 && prev !== 123 && prev !== 10 && prev !== 13 && prev !== 9) {
      from = start + tag.length;
      continue;
    }
    const rest = block.slice(start + tag.length);
    const brace = rest.search(/\{/);
    const inlineEnd = rest.search(/\n\s*[A-Za-z]/);
    if (brace >= 0 && (inlineEnd < 0 || brace < inlineEnd) && brace < 80) {
      const aPos = rest.indexOf("a:", brace);
      if (aPos < 0) return [];
      const end = rest.indexOf("}", aPos);
      if (end < 0) return [];
      return parseNumberList(rest.slice(aPos + 2, end));
    }
    const chunk = inlineEnd >= 0 ? rest.slice(0, inlineEnd) : rest.slice(0, 200_000);
    return parseNumberList(chunk.replace(/^\s*\*\d+/, ""));
  }
  return [];
}

function mappingType(block: string, layer: string): string {
  const i = block.indexOf(layer);
  if (i < 0) return "";
  const slice = block.slice(i, i + 800);
  const m = slice.match(/MappingInformationType:\s*"([^"]+)"/);
  return m?.[1] ?? "";
}

function referenceType(block: string, layer: string): string {
  const i = block.indexOf(layer);
  if (i < 0) return "";
  const slice = block.slice(i, i + 800);
  const m = slice.match(/ReferenceInformationType:\s*"([^"]+)"/);
  return m?.[1] ?? "";
}

function polygonsFromIndex(index: number[]): number[][] {
  const faces: number[][] = [];
  let cur: number[] = [];
  for (const raw of index) {
    if (raw < 0) {
      cur.push(-raw - 1);
      if (cur.length >= 3) faces.push(cur);
      cur = [];
    } else {
      cur.push(raw);
    }
  }
  return faces;
}

function parseMaterials(text: string): ObjMaterial[] {
  const mats: ObjMaterial[] = [];
  for (const block of extractBlocks(text, "Material")) {
    const nameMatch = block.match(/"Material::([^"]+)"/);
    const name = nameMatch?.[1]?.trim() || `Mat${mats.length + 1}`;
    const colorMatch =
      block.match(/"DiffuseColor"[^,]*,[^,]*,[^,]*,[^,]*,\s*([-\d.eE]+),\s*([-\d.eE]+),\s*([-\d.eE]+)/) ??
      block.match(/"Diffuse"[^,]*,[^,]*,[^,]*,[^,]*,\s*([-\d.eE]+),\s*([-\d.eE]+),\s*([-\d.eE]+)/);
    const color: [number, number, number] = colorMatch
      ? [Number(colorMatch[1]), Number(colorMatch[2]), Number(colorMatch[3])]
      : [0.77, 0.75, 0.71];
    const opMatch = block.match(/"Opacity"[^,]*,[^,]*,[^,]*,[^,]*,\s*([-\d.eE]+)/);
    mats.push({
      name,
      color: color.map((c) => (Number.isFinite(c) ? c : 0.7)) as [number, number, number],
      roughness: 0.72,
      metalness: 0.04,
      opacity: opMatch ? Number(opMatch[1]) : 1,
    });
  }
  return mats;
}

function isZUp(text: string): boolean {
  return /P:\s*"UpAxis",\s*"int",\s*"Integer",\s*"",\s*2/.test(text);
}

function convertZUp(x: number, y: number, z: number) {
  return { x, y: z, z: -y };
}

function geometryBlockToMesh(
  block: string,
  materials: ObjMaterial[],
  zUp: boolean,
): PolyMesh | null {
  if (!block.includes("Vertices") || !block.includes("PolygonVertexIndex")) return null;
  const verts = parseFbxArray(block, "Vertices");
  const index = parseFbxArray(block, "PolygonVertexIndex");
  if (verts.length < 9 || index.length < 3) return null;

  const positions: number[] = [];
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i]!;
    const y = verts[i + 1]!;
    const z = verts[i + 2]!;
    if (zUp) {
      const p = convertZUp(x, y, z);
      positions.push(p.x, p.y, p.z);
    } else {
      positions.push(x, y, z);
    }
  }

  const polys = polygonsFromIndex(index);
  if (polys.length === 0) return null;

  const uvDirect = parseFbxArray(block, "UV");
  const uvIndex = parseFbxArray(block, "UVIndex");
  const uvRef = referenceType(block, "LayerElementUV");
  const uvMap = mappingType(block, "LayerElementUV");
  const nDirect = parseFbxArray(block, "Normals");
  const nIndex = parseFbxArray(block, "NormalIndex");
  const nRef = referenceType(block, "LayerElementNormal");
  const nMap = mappingType(block, "LayerElementNormal");
  const matDirect = parseFbxArray(block, "Materials");
  const matMap = mappingType(block, "LayerElementMaterial");

  let corner = 0;
  const faces: PolyFace[] = [];
  for (let f = 0; f < polys.length; f++) {
    const indices = polys[f]!;
    const uvs: Array<[number, number]> = [];
    const cornerN: Array<[number, number, number]> = [];
    for (let k = 0; k < indices.length; k++) {
      let ui =
        uvMap === "ByVertice" || uvMap === "ByVertex" ? indices[k]! : corner + k;
      if (uvRef === "IndexToDirect" && uvIndex.length > ui) ui = uvIndex[ui]!;
      const u = uvDirect[ui * 2] ?? 0;
      const v = uvDirect[ui * 2 + 1] ?? 0;
      uvs.push([u, v]);
      if (nDirect.length >= 3) {
        let ni =
          nMap === "ByVertice" || nMap === "ByVertex" ? indices[k]! : corner + k;
        if (nRef === "IndexToDirect" && nIndex.length > ni) ni = nIndex[ni]!;
        let nx = nDirect[ni * 3] ?? 0;
        let ny = nDirect[ni * 3 + 1] ?? 0;
        let nz = nDirect[ni * 3 + 2] ?? 0;
        if (zUp) {
          const p = convertZUp(nx, ny, nz);
          nx = p.x;
          ny = p.y;
          nz = p.z;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        cornerN.push([nx / len, ny / len, nz / len]);
      }
    }
    corner += indices.length;
    let matIdx = 0;
    if (matMap === "ByPolygon" && matDirect.length > f) matIdx = matDirect[f]!;
    else if (matDirect.length === 1) matIdx = matDirect[0]!;
    const mat = materials[matIdx];
    const aligned = alignFaceToNormal(positions, indices, uvs, averageNormal(cornerN));
    faces.push({
      indices: aligned.indices,
      uvs: aligned.uvs,
      normal: aligned.normal,
      material: mat?.name,
    });
  }

  return { positions, faces };
}

function mergePoly(parts: PolyMesh[]): PolyMesh {
  const positions: number[] = [];
  const faces: PolyFace[] = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    positions.push(...part.positions);
    for (const face of part.faces) {
      faces.push({
        ...face,
        indices: face.indices.map((i) => i + offset),
      });
    }
  }
  return { positions, faces };
}

export function parseFbxAscii(text: string): FbxDocument {
  const materials = parseMaterials(text);
  const zUp = isZUp(text);
  const parts: PolyMesh[] = [];
  for (const block of extractBlocks(text, "Geometry")) {
    const mesh = geometryBlockToMesh(block, materials, zUp);
    if (mesh) parts.push(mesh);
  }
  if (parts.length === 0) throw new Error("FBX has no usable mesh");
  const poly = applyBoxUvs(parts.length === 1 ? parts[0]! : mergePoly(parts));
  return { poly, materials };
}

function isFbxBinary(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 21) return false;
  const sig = new TextDecoder("latin1").decode(new Uint8Array(buffer, 0, 21));
  return sig.startsWith("Kaydara FBX Binary");
}

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function parseFbxWithThree(buffer: ArrayBuffer): Promise<FbxDocument> {
  const [{ FBXLoader }, three] = await Promise.all([
    import("three/addons/loaders/FBXLoader.js"),
    import("three"),
  ]);
  const manager = new three.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
    return PIXEL;
  });
  let group;
  try {
    group = new FBXLoader(manager).parse(buffer, "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not parse FBX";
    throw new Error(msg.replace(/^THREE\.FBXLoader:\s*/i, "FBX: "));
  }
  const converted = groupToPoly(group);
  if (converted.poly.faces.length === 0) throw new Error("FBX has no usable mesh");
  return {
    poly: applyBoxUvs(converted.poly),
    materials: converted.materials,
  };
}

export function sniffFbx(buffer: ArrayBuffer): boolean {
  if (isFbxBinary(buffer)) return true;
  const head = new TextDecoder("utf-8").decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 96)));
  return /FBXHeaderExtension|; FBX|FBXVersion|Kaydara FBX/i.test(head);
}

export async function parseFbxBuffer(buffer: ArrayBuffer): Promise<FbxDocument> {
  if (isFbxBinary(buffer)) return parseFbxWithThree(buffer);
  const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
  if (/FBXHeaderExtension|FBXVersion|Objects:|; FBX/.test(text)) {
    try {
      const doc = parseFbxAscii(text);
      if (doc.poly.faces.length > 0) return doc;
    } catch {
      /* Blender / Maya ASCII variants go through Three */
    }
    return parseFbxWithThree(buffer);
  }
  try {
    return await parseFbxWithThree(buffer);
  } catch {
    throw new Error("Not a valid FBX file");
  }
}

export async function parseFbxFile(file: File): Promise<FbxDocument> {
  return parseFbxBuffer(await file.arrayBuffer());
}
