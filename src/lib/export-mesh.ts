import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { type CubeParams } from "@/lib/cube";
import { buildActiveGeometry, type ImportedModel } from "@/lib/active-mesh";
import {
  downloadBuffer,
  downloadText,
  geometryToFbx,
  type FbxAxis,
} from "@/lib/export-fbx";
import type { ObjMaterial } from "@/lib/obj-material";

if (typeof globalThis.FileReader === "undefined") {
  class FileReaderStub {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  }
  (globalThis as { FileReader: unknown }).FileReader = FileReaderStub;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  const v = Number.parseInt(n.length === 3 ? n.split("").map((c) => c + c).join("") : n, 16);
  if (!Number.isFinite(v)) return [0.77, 0.75, 0.71];
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export type ActiveExport = {
  params: CubeParams;
  imported: ImportedModel | null;
  name: string;
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  axis?: FbxAxis;
};

async function loadMap(url: string): Promise<THREE.Texture | undefined> {
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.flipY = true;
    return tex;
  } catch {
    return undefined;
  }
}

function baseMaterial(
  opts: ActiveExport,
  vertexColors: boolean,
  slot?: ObjMaterial,
  index = 0,
): THREE.MeshStandardMaterial {
  const color = slot
    ? new THREE.Color(slot.color[0], slot.color[1], slot.color[2])
    : new THREE.Color(opts.params.faceColors && !opts.imported ? 0xffffff : opts.color);
  return new THREE.MeshStandardMaterial({
    name: slot?.name || (index === 0 ? sanitize(opts.name) : `Mat_${index}`),
    color,
    vertexColors,
    roughness: slot?.roughness ?? opts.roughness ?? 0.72,
    metalness: slot?.metalness ?? opts.metalness ?? 0,
    opacity: slot?.opacity ?? opts.opacity ?? 1,
    transparent: (slot?.opacity ?? opts.opacity ?? 1) < 0.95,
    flatShading: opts.params.flatShading,
    side: THREE.FrontSide,
    depthWrite: true,
  });
}

async function makeExportMesh(opts: ActiveExport) {
  const geometry = buildActiveGeometry({ params: opts.params, imported: opts.imported });
  const vertexColors = Boolean(geometry.getAttribute("color"));
  const slots = opts.imported?.materials ?? [];
  let material: THREE.Material | THREE.Material[];
  if (slots.length > 0) {
    material = await Promise.all(
      slots.map(async (slot, i) => {
        const mat = baseMaterial(opts, vertexColors, slot, i);
        if (slot.mapUrl) {
          const tex = await loadMap(slot.mapUrl);
          if (tex) mat.map = tex;
        }
        return mat;
      }),
    );
    if (geometry.groups.length === 0 && geometry.getAttribute("position")) {
      geometry.addGroup(0, geometry.getAttribute("position")!.count, 0);
    }
  } else {
    material = baseMaterial(opts, vertexColors);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = sanitize(opts.name);
  return mesh;
}

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of mats) {
    const std = mat as THREE.MeshStandardMaterial;
    std.map?.dispose();
    mat.dispose();
  }
}

export async function exportFbx(opts: ActiveExport & { axis: FbxAxis; wireframeOnly?: boolean }) {
  const geo = buildActiveGeometry({ params: opts.params, imported: opts.imported });
  const ascii = geometryToFbx(geo, {
    name: opts.name,
    axis: opts.axis,
    color: hexToRgb(opts.color),
    wireframeOnly: opts.wireframeOnly,
    materials: opts.imported?.materials?.map((m) => ({
      name: m.name,
      color: m.color,
      opacity: m.opacity,
    })),
  });
  geo.dispose();
  return downloadText(`${sanitize(opts.name)}.fbx`, ascii, "application/octet-stream");
}

export async function exportObj(opts: ActiveExport) {
  const mesh = await makeExportMesh(opts);
  const text = new OBJExporter().parse(mesh);
  disposeMesh(mesh);
  return downloadText(`${sanitize(opts.name)}.obj`, text, "text/plain");
}

export async function buildGlb(opts: ActiveExport): Promise<ArrayBuffer> {
  const mesh = await makeExportMesh(opts);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true, embedImages: true });
  disposeMesh(mesh);
  if (!(result instanceof ArrayBuffer)) throw new Error("GLB export failed");
  return result;
}

export async function exportGlb(opts: ActiveExport) {
  const bytes = await buildGlb(opts);
  return downloadBuffer(`${sanitize(opts.name)}.glb`, bytes, "model/gltf-binary");
}

function sanitize(name: string) {
  return (name.replace(/[^\w\- ]+/g, "").trim() || "lowpoly_cube")
    .replace(/\s+/g, "_")
    .slice(0, 48);
}
