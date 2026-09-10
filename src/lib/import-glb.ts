import { applyBoxUvs, ensureOutwardWinding, type PolyMesh } from "./cube.ts";
import type { ObjMaterial } from "./obj-material.ts";
import { groupToPoly } from "./three-to-poly.ts";

export type GlbDocument = {
  poly: PolyMesh;
  materials: ObjMaterial[];
};

const GLB_MAGIC = 0x46546c67;

export function sniffGlb(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) === GLB_MAGIC) return true;
  const head = new TextDecoder("utf-8").decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 96)));
  return /^\s*\{\s*"asset"\s*:/.test(head) && /"meshes"\s*:/.test(head);
}

function disposeObject(root: { traverse: (fn: (o: unknown) => void) => void }) {
  root.traverse((obj) => {
    const o = obj as { geometry?: { dispose: () => void }; material?: { dispose?: () => void } | Array<{ dispose?: () => void }> };
    o.geometry?.dispose();
    const mat = o.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
    else mat?.dispose?.();
  });
}

export async function parseGlb(buffer: ArrayBuffer, extras: File[] = []): Promise<GlbDocument> {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  if (extras.length > 0) {
    const urls = new Map<string, string>();
    for (const file of extras) {
      const url = URL.createObjectURL(file);
      urls.set(file.name.toLowerCase(), url);
    }
    loader.manager.setURLModifier((url) => {
      const base = url.split(/[?#]/)[0]!.split("/").pop()?.toLowerCase() ?? "";
      return urls.get(base) ?? url;
    });
  }

  let gltf;
  try {
    gltf = await loader.parseAsync(buffer, "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not parse GLB";
    throw new Error(msg.replace(/^THREE\.GLTFLoader:\s*/i, "GLB: "));
  }

  const converted = groupToPoly(gltf.scene);
  disposeObject(gltf.scene);
  if (converted.poly.faces.length === 0) throw new Error("GLB has no usable mesh");
  return {
    poly: applyBoxUvs(ensureOutwardWinding(converted.poly)),
    materials: converted.materials,
  };
}

export async function parseGlbFile(file: File, extras: File[] = []): Promise<GlbDocument> {
  return parseGlb(await file.arrayBuffer(), extras);
}
