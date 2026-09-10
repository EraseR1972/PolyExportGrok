import type { Pivot, PolyFace, PolyMesh } from "./cube.ts";
import type { FbxAxis } from "./export-fbx.ts";
import type { ObjMaterial } from "./obj-material.ts";

export const RECENTS_KEY = "polyexport-recents";
export const RECENTS_MAX = 5;

export type RecentConversion = {
  id: string;
  fileName: string;
  name: string;
  poly: PolyMesh;
  scale: number;
  axis: FbxAxis;
  pivot: Pivot;
  color: string;
  materials?: ObjMaterial[];
  at: number;
};

export function recentId(fileName: string) {
  return `recent:${fileName.trim().toLowerCase()}`;
}

export function clonePoly(poly: PolyMesh): PolyMesh {
  return {
    positions: poly.positions.slice(),
    faces: poly.faces.map(
      (face): PolyFace => ({
        indices: face.indices.slice(),
        normal: [face.normal[0], face.normal[1], face.normal[2]],
        uvs: face.uvs.map((uv) => [uv[0], uv[1]] as [number, number]),
        color: face.color
          ? [face.color[0], face.color[1], face.color[2]]
          : undefined,
        material: face.material,
      }),
    ),
  };
}

export function upsertRecent(
  list: RecentConversion[],
  item: RecentConversion,
): RecentConversion[] {
  const id = item.id || recentId(item.fileName);
  const next: RecentConversion = { ...item, id, poly: clonePoly(item.poly) };
  const without = list.filter((row) => row.id !== id);
  return [next, ...without].slice(0, RECENTS_MAX);
}

export function parseRecents(raw: string | null): RecentConversion[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: RecentConversion[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const r = row as Partial<RecentConversion>;
      if (typeof r.fileName !== "string" || !r.poly || !Array.isArray(r.poly.positions)) {
        continue;
      }
      if (r.poly.positions.length < 3) continue;
      out.push({
        id: typeof r.id === "string" ? r.id : recentId(r.fileName),
        fileName: r.fileName,
        name: typeof r.name === "string" ? r.name : r.fileName.replace(/\.obj$/i, ""),
        poly: clonePoly(r.poly as PolyMesh),
        scale: typeof r.scale === "number" && Number.isFinite(r.scale) ? r.scale : 1,
        axis: r.axis === "z-up" ? "z-up" : "y-up",
        pivot: r.pivot === "bottom" ? "bottom" : "center",
        color: typeof r.color === "string" ? r.color : "#c4bfb4",
        materials: Array.isArray(r.materials)
          ? r.materials.map((m) => ({ ...m, mapUrl: undefined }))
          : undefined,
        at: typeof r.at === "number" ? r.at : 0,
      });
    }
    return out.slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

export function loadRecents(): RecentConversion[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecents(window.localStorage.getItem(RECENTS_KEY));
  } catch {
    return [];
  }
}

export function saveRecents(list: RecentConversion[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    try {
      window.localStorage.setItem(
        RECENTS_KEY,
        JSON.stringify(list.map((row) => ({ ...row, poly: { positions: [], faces: [] } }))),
      );
    } catch {
      // quota — keep in-memory only
    }
  }
}
