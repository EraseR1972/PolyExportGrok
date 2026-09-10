import { create } from "zustand";
import { buildAngularFighter } from "@/lib/build-fighter";
import { buildCubeGeometry, flipPolyFaces, type CubeParams, type Pivot, type PolyMesh } from "@/lib/cube";
import type { ImportedModel } from "@/lib/active-mesh";
import { revokeImportedMaps } from "@/lib/active-mesh";
import type { FbxAxis } from "@/lib/export-fbx";
import type { ObjMaterial } from "@/lib/obj-material";
import {
  loadRecents,
  saveRecents,
  upsertRecent,
  recentId,
  type RecentConversion,
} from "@/lib/recents";

export type ShadowMode = "off" | "cast";
export type NormalVis = "facing" | "rgb";

export type ImportProgress = {
  name: string;
  ratio: number;
  phase: string;
};

export type StudioState = CubeParams & {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  showEdges: boolean;
  wireframe: boolean;
  wireframeColor: string;
  wireframeWidth: number;
  includeFaces: boolean;
  autoRotate: boolean;
  showGrid: boolean;
  showAxes: boolean;
  showPivot: boolean;
  axis: FbxAxis;
  name: string;
  linked: boolean;
  imported: ImportedModel | null;
  recents: RecentConversion[];
  importProgress: ImportProgress | null;
  snapMode: "off" | "point";
  lightAz: number;
  lightEl: number;
  lightColor: string;
  lightIntensity: number;
  shadowMode: ShadowMode;
  shadowOpacity: number;
  shadowSoftness: number;
  checkNormals: boolean;
  normalVis: NormalVis;
  checkUvs: boolean;
  exportWireframe: boolean;
  set: (patch: Partial<StudioState>) => void;
  setSize: (axis: "width" | "height" | "depth", value: number) => void;
  applyPreset: (id: string) => void;
  setImported: (model: ImportedModel | null) => void;
  patchMaterial: (name: string, patch: Partial<ObjMaterial>) => void;
  hydrateRecents: () => void;
  rememberConversion: () => void;
  applyRecent: (id: string) => void;
  generateFighter: () => void;
  flipFaces: () => void;
};

export type Preset = {
  id: string;
  label: string;
  patch: Partial<StudioState>;
};

export const PRESETS: Preset[] = [
  {
    id: "meter",
    label: "1 m cube",
    patch: {
      width: 100,
      height: 100,
      depth: 100,
      segments: 1,
      bevel: 0,
      flatShading: true,
      faceColors: false,
      pivot: "center",
      axis: "y-up",
      color: "#c4bfb4",
      roughness: 0.72,
      metalness: 0.04,
      opacity: 1,
      name: "lowpoly_cube",
    },
  },
  {
    id: "ue",
    label: "UE 1 m",
    patch: {
      width: 100,
      height: 100,
      depth: 100,
      segments: 1,
      bevel: 0,
      flatShading: true,
      faceColors: false,
      pivot: "bottom",
      axis: "z-up",
      color: "#c4bfb4",
      roughness: 0.72,
      metalness: 0.04,
      opacity: 1,
      name: "SM_LowPolyCube",
    },
  },
];

const initial: Omit<
  StudioState,
  | "set"
  | "setSize"
  | "applyPreset"
  | "setImported"
  | "patchMaterial"
  | "hydrateRecents"
  | "rememberConversion"
  | "applyRecent"
  | "generateFighter"
  | "flipFaces"
> = {
  width: 100,
  height: 100,
  depth: 100,
  segments: 1,
  bevel: 0,
  flatShading: true,
  faceColors: false,
  pivot: "center" as Pivot,
  originX: 0,
  originY: 0,
  originZ: 0,
  color: "#c4bfb4",
  roughness: 0.72,
  metalness: 0.04,
  opacity: 1,
  showEdges: true,
  wireframe: false,
  wireframeColor: "#f4f1ea",
  wireframeWidth: 1,
  includeFaces: true,
  autoRotate: false,
  showGrid: true,
  showAxes: true,
  showPivot: false,
  axis: "z-up",
  name: "lowpoly_cube",
  linked: true,
  imported: null,
  recents: [],
  importProgress: null,
  snapMode: "off" as const,
  lightAz: 56,
  lightEl: 50,
  lightColor: "#f2e2a4",
  lightIntensity: 1.35,
  shadowMode: "cast" as ShadowMode,
  shadowOpacity: 0.42,
  shadowSoftness: 0.45,
  checkNormals: false,
  normalVis: "facing" as NormalVis,
  checkUvs: false,
  exportWireframe: false,
};

export const useStudio = create<StudioState>((set, get) => ({
  ...initial,
  set: (patch) => set(patch),
  setSize: (axis, value) => {
    const { linked } = get();
    if (linked) set({ width: value, height: value, depth: value });
    else set({ [axis]: value });
  },
  applyPreset: (id) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const w = preset.patch.width ?? get().width;
    const h = preset.patch.height ?? get().height;
    const d = preset.patch.depth ?? get().depth;
    set({ ...preset.patch, originX: 0, originY: 0, originZ: 0, linked: w === h && h === d, imported: null });
  },
  setImported: (model) => {
    const prev = get().imported;
    if (prev && prev !== model) revokeImportedMaps(prev);
    set({ imported: model });
  },
  patchMaterial: (name, patch) => {
    const imported = get().imported;
    if (!imported?.materials?.length) return;
    set({
      imported: {
        ...imported,
        materials: imported.materials.map((m) =>
          m.name === name ? { ...m, ...patch } : m,
        ),
      },
    });
  },
  hydrateRecents: () => set({ recents: loadRecents() }),
  rememberConversion: () => {
    const s = get();
    if (s.imported && s.imported.poly.faces.length > 60_000) return;
    const snap = snapshotMesh(s);
    if (!snap) return;
    const recents = upsertRecent(s.recents, {
      id: recentId(snap.fileName),
      fileName: snap.fileName,
      name: s.name || snap.fileName.replace(/\.(obj|fbx)$/i, ""),
      poly: snap.poly,
      scale: snap.scale,
      axis: s.axis,
      pivot: s.pivot,
      color: s.color,
      materials: s.imported?.materials?.map((m) => ({ ...m, mapUrl: undefined })),
      at: Date.now(),
    });
    saveRecents(recents);
    set({ recents });
  },
  applyRecent: (id) => {
    const row = get().recents.find((r) => r.id === id);
    if (!row) return;
    set({
      imported: {
        fileName: row.fileName,
        poly: row.poly,
        scale: row.scale,
        materials: row.materials,
      },
      name: row.name,
      axis: row.axis,
      pivot: row.pivot,
      color: row.color,
      faceColors: false,
    });
  },
  generateFighter: () => {
    const prev = get().imported;
    if (prev) revokeImportedMaps(prev);
    const { poly, materials } = buildAngularFighter();
    set({
      imported: {
        fileName: "SM_AngularFighter.fbx",
        poly,
        scale: 1,
        materials,
      },
      name: "SM_AngularFighter",
      axis: "z-up",
      pivot: "bottom",
      bevel: 0,
      faceColors: false,
      originX: 0,
      originY: 0,
      originZ: 0,
      color: "#dce0e4",
      snapMode: "off",
    });
  },
  flipFaces: () => {
    const imported = get().imported;
    if (!imported) return;
    set({ imported: { ...imported, poly: flipPolyFaces(imported.poly) } });
  },
}));

export function cubeParamsFrom(state: CubeParams): CubeParams {
  return {
    width: state.width,
    height: state.height,
    depth: state.depth,
    segments: state.segments,
    bevel: state.bevel,
    flatShading: state.flatShading,
    faceColors: state.faceColors,
    pivot: state.pivot,
    originX: state.originX,
    originY: state.originY,
    originZ: state.originZ,
  };
}

function snapshotMesh(s: StudioState): {
  poly: PolyMesh;
  fileName: string;
  scale: number;
} | null {
  if (s.imported) {
    return {
      poly: s.imported.poly,
      fileName: s.imported.fileName,
      scale: s.imported.scale,
    };
  }
  const geo = buildCubeGeometry(cubeParamsFrom(s));
  const poly = geo.userData.polyMesh as PolyMesh | undefined;
  geo.dispose();
  if (!poly) return null;
  return { poly, fileName: `${s.name || "lowpoly_cube"}.fbx`, scale: 1 };
}
