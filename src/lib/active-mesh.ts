import * as THREE from "three";
import {
  applyOrigin,
  boundsOfPoly,
  buildCubeGeometry,
  measureGeometry,
  measurePoly,
  originOf,
  placePoly,
  polyMeshToGeometry,
  scalePoly,
  type CubeParams,
  type MeshStats,
  type Pivot,
  type PolyBounds,
  type PolyMesh,
} from "@/lib/cube";
import { bevelPoly } from "@/lib/bevel-poly";
import type { ObjMaterial } from "@/lib/obj-material";

export type ImportedModel = {
  fileName: string;
  poly: PolyMesh;
  scale: number;
  materials?: ObjMaterial[];
};

export function placedImport(
  model: ImportedModel,
  pivot: Pivot,
  origin: [number, number, number] = [0, 0, 0],
): PolyMesh {
  return applyOrigin(placePoly(scalePoly(model.poly, model.scale), pivot), origin);
}

export const BEVEL_FACE_CAP = 40_000;

export function activeImportedPoly(opts: {
  params: CubeParams;
  imported: ImportedModel;
}): PolyMesh {
  let poly = placedImport(opts.imported, opts.params.pivot, originOf(opts.params));
  if (opts.params.bevel > 0 && poly.faces.length <= BEVEL_FACE_CAP) {
    poly = bevelPoly(poly, opts.params.bevel);
  }
  return poly;
}

export function buildActiveGeometry(opts: {
  params: CubeParams;
  imported: ImportedModel | null;
}): THREE.BufferGeometry {
  if (!opts.imported) return buildCubeGeometry(opts.params);
  const poly = activeImportedPoly({ params: opts.params, imported: opts.imported });
  const names = opts.imported.materials?.map((m) => m.name);
  const geo = polyMeshToGeometry(poly, opts.params.flatShading, names);
  geo.userData.polyMesh = poly;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function measureActive(opts: {
  params: CubeParams;
  imported: ImportedModel | null;
}): MeshStats {
  if (opts.imported) {
    return measurePoly(activeImportedPoly({ params: opts.params, imported: opts.imported }));
  }
  const geo = buildCubeGeometry(opts.params);
  const stats = measureGeometry(geo);
  geo.dispose();
  return stats;
}

export function boundsActive(opts: {
  params: CubeParams;
  imported: ImportedModel | null;
}): PolyBounds {
  if (opts.imported) {
    return boundsOfPoly(activeImportedPoly({ params: opts.params, imported: opts.imported }));
  }
  const { width, height, depth, pivot } = opts.params;
  const [ox, oy, oz] = originOf(opts.params);
  const minY = (pivot === "bottom" ? 0 : -height / 2) - oy;
  const maxY = minY + height;
  return {
    min: [-width / 2 - ox, minY, -depth / 2 - oz],
    max: [width / 2 - ox, maxY, depth / 2 - oz],
    size: [width, height, depth],
    center: [-ox, (minY + maxY) / 2, -oz],
  };
}

export function revokeImportedMaps(model: ImportedModel | null | undefined) {
  if (!model?.materials) return;
  for (const mat of model.materials) {
    if (mat.mapUrl) URL.revokeObjectURL(mat.mapUrl);
  }
}
