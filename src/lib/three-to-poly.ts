import type { BufferGeometry, Material, Mesh, Object3D, Texture } from "three";
import { Color, Matrix4, Vector3 } from "three";
import type { PolyFace, PolyMesh } from "./cube.ts";
import { alignFaceToNormal, averageNormal } from "./import-obj.ts";
import type { ObjMaterial } from "./obj-material.ts";

function colorOf(mat: Material | Material[]): [number, number, number] {
  const m = Array.isArray(mat) ? mat[0] : mat;
  const c = (m as Material & { color?: Color })?.color;
  if (c && typeof c.r === "number") return [c.r, c.g, c.b];
  return [0.77, 0.75, 0.71];
}

function nameOf(mat: Material | undefined, fallback: string) {
  return (mat?.name && mat.name.trim()) || fallback;
}

function opacityOf(mat: Material | undefined) {
  const o = (mat as Material & { opacity?: number } | undefined)?.opacity;
  return typeof o === "number" ? o : 1;
}

function roughnessOf(mat: Material | undefined) {
  const r = (mat as Material & { roughness?: number } | undefined)?.roughness;
  return typeof r === "number" ? r : 0.72;
}

function metalnessOf(mat: Material | undefined) {
  const m = (mat as Material & { metalness?: number } | undefined)?.metalness;
  return typeof m === "number" ? m : 0.04;
}

function mapUrlOf(mat: Material | undefined): string | undefined {
  const map = (mat as Material & { map?: Texture | null } | undefined)?.map;
  const img = map?.image as { src?: string } | undefined;
  if (img && typeof img.src === "string" && img.src.length > 0) return img.src;
  return undefined;
}

function harvest(mat: Material | undefined, fallback: string): ObjMaterial {
  return {
    name: nameOf(mat, fallback),
    color: mat ? colorOf(mat) : [0.77, 0.75, 0.71],
    roughness: roughnessOf(mat),
    metalness: metalnessOf(mat),
    opacity: opacityOf(mat),
    mapUrl: mapUrlOf(mat),
  };
}

export function geometryToPoly(
  geo: BufferGeometry,
  matrix: Matrix4,
  materialName?: string | string[],
): PolyMesh {
  const source = geo.index ? geo.toNonIndexed() : geo;
  const pos = source.getAttribute("position");
  const uv = source.getAttribute("uv");
  const nrm = source.getAttribute("normal");
  if (!pos) {
    if (source !== geo) source.dispose();
    return { positions: [], faces: [] };
  }

  const names = Array.isArray(materialName) ? materialName : [materialName];
  const groups =
    source.groups.length > 0
      ? source.groups
      : [{ start: 0, count: pos.count, materialIndex: 0 }];

  const vertexMap = new Map<string, number>();
  const positions: number[] = [];
  const faces: PolyFace[] = [];
  const tmp = new Vector3();
  const tmpN = new Vector3();

  for (const group of groups) {
    const matName = names[group.materialIndex ?? 0] ?? names[0];
    const triStart = Math.floor(group.start / 3);
    const triEnd = Math.floor((group.start + group.count) / 3);
    for (let t = triStart; t < triEnd; t++) {
      const indices: number[] = [];
      const uvs: Array<[number, number]> = [];
      const cornerN: Array<[number, number, number]> = [];
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        if (i >= pos.count) break;
        tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix);
        const key = `${tmp.x.toFixed(6)},${tmp.y.toFixed(6)},${tmp.z.toFixed(6)}`;
        let idx = vertexMap.get(key);
        if (idx === undefined) {
          idx = positions.length / 3;
          vertexMap.set(key, idx);
          positions.push(tmp.x, tmp.y, tmp.z);
        }
        indices.push(idx);
        if (uv) uvs.push([uv.getX(i), uv.getY(i)]);
        else uvs.push([0, 0]);
        if (nrm) {
          tmpN.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).transformDirection(matrix);
          const len = tmpN.length() || 1;
          cornerN.push([tmpN.x / len, tmpN.y / len, tmpN.z / len]);
        }
      }
      if (indices.length < 3) continue;
      const aligned = alignFaceToNormal(positions, indices, uvs, averageNormal(cornerN));
      faces.push({
        indices: aligned.indices,
        uvs: aligned.uvs,
        normal: aligned.normal,
        material: matName,
      });
    }
  }

  if (source !== geo) source.dispose();
  return { positions, faces };
}

export function groupToPoly(root: Object3D): { poly: PolyMesh; materials: ObjMaterial[] } {
  const materials: ObjMaterial[] = [];
  const seen = new Map<string, ObjMaterial>();
  const parts: PolyMesh[] = [];
  root.updateMatrixWorld(true);

  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const names = list.map((mat, i) => {
      const fallback = `${mesh.name || "Mat"}_${i}`;
      const harvested = harvest(mat, fallback);
      if (!seen.has(harvested.name)) {
        seen.set(harvested.name, harvested);
        materials.push(harvested);
      }
      return harvested.name;
    });
    parts.push(geometryToPoly(mesh.geometry, mesh.matrixWorld, names));
  });

  const positions: number[] = [];
  const faces: PolyFace[] = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    positions.push(...part.positions);
    for (const face of part.faces) {
      faces.push({ ...face, indices: face.indices.map((i) => i + offset) });
    }
  }
  return { poly: { positions, faces }, materials };
}
