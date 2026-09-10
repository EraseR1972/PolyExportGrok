import { readObjBundle, type ObjBundle, type ObjProgress } from "./import-obj.ts";
import { parseFbxFile, sniffFbx } from "./import-fbx.ts";
import { parseGlbFile, sniffGlb } from "./import-glb.ts";
import { parseLwoFile } from "./import-lwo.ts";
import type { ObjMaterial } from "./obj-material.ts";
import type { PolyMesh } from "./cube.ts";

export type MeshKind = "obj" | "fbx" | "lwo" | "glb";

export type MeshBundle = ObjBundle & { kind: MeshKind };

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|mtl)$/i;

export function meshKindOf(name: string): MeshKind | null {
  if (/\.fbx$/i.test(name)) return "fbx";
  if (/\.(glb|gltf)$/i.test(name)) return "glb";
  if (/\.(lwo|lwob)$/i.test(name)) return "lwo";
  if (/\.obj$/i.test(name)) return "obj";
  return null;
}

export function sniffKind(name: string, buffer?: ArrayBuffer): MeshKind | null {
  const named = meshKindOf(name);
  if (named) return named;
  if (!buffer || buffer.byteLength < 8) return null;
  if (sniffFbx(buffer)) return "fbx";
  if (sniffGlb(buffer)) return "glb";
  const latin = new TextDecoder("latin1").decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16)));
  if (latin.startsWith("FORM")) return "lwo";
  const utf = new TextDecoder("utf-8").decode(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 160)),
  );
  if (/(^|\n)\s*(v |o |g |s |mtllib |usemtl |vn |vt |f )/.test(utf)) return "obj";
  return null;
}

export function pickMeshFile(files: File[]): File | undefined {
  const list = files.filter((f) => !IMAGE_EXT.test(f.name));
  return (
    list.find((f) => meshKindOf(f.name) === "fbx") ??
    list.find((f) => meshKindOf(f.name) === "glb") ??
    list.find((f) => meshKindOf(f.name) === "lwo") ??
    list.find((f) => meshKindOf(f.name) === "obj") ??
    list[0]
  );
}

function wrap(
  kind: MeshKind,
  fileName: string,
  poly: PolyMesh,
  materials: ObjMaterial[],
  bytes: number,
): MeshBundle {
  return {
    kind,
    fileName,
    poly,
    materials,
    missingMtl: false,
    mapsLoaded: materials.filter((m) => m.mapUrl).length,
    bytes,
  };
}

export async function readMeshBundle(
  files: File[] | FileList,
  onProgress?: ObjProgress,
): Promise<MeshBundle> {
  const list = [...files];
  let mesh = pickMeshFile(list);
  if (!mesh) throw new Error("Choose an .obj, .fbx, .glb, or .lwo file");

  let peek = await mesh.slice(0, 160).arrayBuffer();
  let kind = sniffKind(mesh.name, peek);
  if (!kind) {
    for (const file of list) {
      const head = await file.slice(0, 160).arrayBuffer();
      const guessed = sniffKind(file.name, head);
      if (guessed) {
        mesh = file;
        peek = head;
        kind = guessed;
        break;
      }
    }
  }
  if (!kind) {
    throw new Error("Could not read this file. Use OBJ, FBX, GLB, or LWO.");
  }

  if (kind === "obj") {
    const bundle = await readObjBundle(list, onProgress);
    return { ...bundle, kind: "obj" };
  }

  const extras = list.filter((f) => f !== mesh);
  onProgress?.(0.08, kind === "fbx" ? "Reading FBX" : kind === "glb" ? "Reading GLB" : "Reading LWO");
  if (kind === "fbx") {
    const doc = await parseFbxFile(mesh);
    onProgress?.(1, "Building mesh");
    return wrap("fbx", mesh.name || "model.fbx", doc.poly, doc.materials, mesh.size);
  }
  if (kind === "glb") {
    const doc = await parseGlbFile(mesh, extras);
    onProgress?.(1, "Building mesh");
    return wrap("glb", mesh.name || "model.glb", doc.poly, doc.materials, mesh.size);
  }
  const doc = await parseLwoFile(mesh);
  onProgress?.(1, "Building mesh");
  return wrap("lwo", mesh.name || "model.lwo", doc.poly, doc.materials, mesh.size);
}
