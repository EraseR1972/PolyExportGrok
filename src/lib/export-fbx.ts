import type { BufferGeometry } from "three";
import type { PolyMesh } from "@/lib/cube";
import { saveBlob } from "./download-file.ts";

export type FbxAxis = "y-up" | "z-up";

export type FbxExportOptions = {
  name: string;
  axis: FbxAxis;
  color: [number, number, number];
  specular?: number;
  wireframeOnly?: boolean;
  materials?: Array<{
    name: string;
    color: [number, number, number];
    opacity?: number;
  }>;
};

type ExtractedMesh = {
  vertices: number[];
  polygonIndex: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  polygonCount: number;
  faceMaterials: number[];
};

function keyPos(x: number, y: number, z: number) {
  return `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
}

function convertAxis(x: number, y: number, z: number, axis: FbxAxis) {
  // Y-up (Three.js) → Z-up (Unreal): +90° around X, baked into vertices
  // so the mesh stands at identity rotation. (x, y, z) → (x, -z, y)
  if (axis === "z-up") return { x, y: -z, z: y };
  return { x, y, z };
}

function materialSlot(name: string | undefined, names: string[]) {
  if (!name || names.length === 0) return 0;
  const i = names.indexOf(name);
  return i >= 0 ? i : 0;
}

function extractFromPoly(poly: PolyMesh, axis: FbxAxis, materialNames: string[]): ExtractedMesh {
  const vertices: number[] = [];
  for (let i = 0; i < poly.positions.length; i += 3) {
    const p = convertAxis(poly.positions[i]!, poly.positions[i + 1]!, poly.positions[i + 2]!, axis);
    vertices.push(p.x, p.y, p.z);
  }

  const polygonIndex: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const faceMaterials: number[] = [];

  for (const face of poly.faces) {
    const n = convertAxis(face.normal[0], face.normal[1], face.normal[2], axis);
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    const nx = n.x / len;
    const ny = n.y / len;
    const nz = n.z / len;
    for (let k = 0; k < face.indices.length; k++) {
      const idx = face.indices[k]!;
      const last = k === face.indices.length - 1;
      polygonIndex.push(last ? -(idx + 1) : idx);
      normals.push(nx, ny, nz);
      const uv = face.uvs[k] ?? [0, 0];
      uvs.push(uv[0], uv[1]);
      if (face.color) colors.push(face.color[0], face.color[1], face.color[2], 1);
    }
    faceMaterials.push(materialSlot(face.material, materialNames));
  }

  return {
    vertices,
    polygonIndex,
    normals,
    uvs,
    colors,
    polygonCount: poly.faces.length,
    faceMaterials,
  };
}

function extractMesh(
  geo: BufferGeometry,
  axis: FbxAxis,
  materialNames: string[] = [],
): ExtractedMesh {
  const poly = geo.userData.polyMesh as PolyMesh | undefined;
  if (poly && poly.faces.length > 0) return extractFromPoly(poly, axis, materialNames);

  const source = geo.index ? geo.toNonIndexed() : geo;
  const pos = source.getAttribute("position");
  const nrm = source.getAttribute("normal");
  const uv = source.getAttribute("uv");
  const col = source.getAttribute("color");
  if (!pos) {
    if (source !== geo) source.dispose();
    return {
      vertices: [],
      polygonIndex: [],
      normals: [],
      uvs: [],
      colors: [],
      polygonCount: 0,
      faceMaterials: [],
    };
  }

  const vertexMap = new Map<string, number>();
  const vertices: number[] = [];
  const polygonIndex: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const faceMaterials: number[] = [];

  const triCount = Math.floor(pos.count / 3);
  for (let t = 0; t < triCount; t++) {
    const face: number[] = [];
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      const p = convertAxis(pos.getX(i), pos.getY(i), pos.getZ(i), axis);
      const key = keyPos(p.x, p.y, p.z);
      let idx = vertexMap.get(key);
      if (idx === undefined) {
        idx = vertices.length / 3;
        vertexMap.set(key, idx);
        vertices.push(p.x, p.y, p.z);
      }
      face.push(idx);

      if (nrm) {
        const n = convertAxis(nrm.getX(i), nrm.getY(i), nrm.getZ(i), axis);
        const len = Math.hypot(n.x, n.y, n.z) || 1;
        normals.push(n.x / len, n.y / len, n.z / len);
      }
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      if (col) {
        colors.push(col.getX(i), col.getY(i), col.getZ(i), 1);
      }
    }
    polygonIndex.push(face[0]!, face[1]!, -(face[2]! + 1));
    faceMaterials.push(0);
  }

  if (source !== geo) source.dispose();
  return { vertices, polygonIndex, normals, uvs, colors, polygonCount: triCount, faceMaterials };
}

function parsePolygons(index: number[]): number[][] {
  const faces: number[][] = [];
  let cur: number[] = [];
  for (const raw of index) {
    if (raw < 0) {
      cur.push(-raw - 1);
      if (cur.length >= 2) faces.push(cur);
      cur = [];
    } else {
      cur.push(raw);
    }
  }
  return faces;
}

function toWireframe(mesh: ExtractedMesh): ExtractedMesh {
  const seen = new Set<string>();
  const polygonIndex: number[] = [];
  const normals: number[] = [];
  const faceMaterials: number[] = [];
  const pos = mesh.vertices;

  for (const face of parsePolygons(mesh.polygonIndex)) {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const a = face[i]!;
      const b = face[(i + 1) % n]!;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (lo === hi) continue;
      const key = `${lo}:${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      polygonIndex.push(a, -(b + 1));
      const ax = pos[a * 3] ?? 0;
      const ay = pos[a * 3 + 1] ?? 0;
      const az = pos[a * 3 + 2] ?? 0;
      const bx = pos[b * 3] ?? 0;
      const by = pos[b * 3 + 1] ?? 0;
      const bz = pos[b * 3 + 2] ?? 0;
      let dx = bx - ax;
      let dy = by - ay;
      let dz = bz - az;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      normals.push(dx, dy, dz, dx, dy, dz);
      faceMaterials.push(0);
    }
  }

  return {
    vertices: mesh.vertices,
    polygonIndex,
    normals,
    uvs: [],
    colors: [],
    polygonCount: polygonIndex.length / 2,
    faceMaterials,
  };
}

function fmt(n: number, digits = 6) {
  if (!Number.isFinite(n)) return "0";
  const v = Math.abs(n) < 1e-12 ? 0 : n;
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

function fbxArray(name: string, values: number[], indent: string, int = false) {
  const body = values.map((v) => (int ? String(v) : fmt(v))).join(",");
  return `${indent}${name}: *${values.length} {\n${indent}\ta: ${body}\n${indent}}`;
}

function nowStamp() {
  const d = new Date();
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

export function geometryToFbx(geo: BufferGeometry, options: FbxExportOptions): string {
  const modelName = sanitizeName(options.name);
  const materials =
    options.materials && options.materials.length > 0
      ? options.materials
      : [{ name: `${modelName}Mat`, color: options.color }];
  let mesh = extractMesh(
    geo,
    options.axis,
    materials.map((m) => m.name),
  );
  if (options.wireframeOnly) mesh = toWireframe(mesh);
  if (mesh.polygonCount < 1 || mesh.vertices.length < 6) {
    throw new Error("Nothing to export");
  }
  const t = nowStamp();
  const upAxis = options.axis === "z-up" ? 2 : 1;
  const frontAxis = options.axis === "z-up" ? 1 : 2;
  const frontAxisSign = options.axis === "z-up" ? -1 : 1;
  const originalUpAxis = options.axis === "z-up" ? 1 : -1;
  const spec = options.specular ?? 0.18;
  const smoothing = Array.from({ length: mesh.polygonCount }, () => 0);

  const geoId = 1000000001;
  const modelId = 1000000002;
  const matIds = materials.map((_, i) => 1000000003 + i);

  const layers: string[] = [
    layerElem("LayerElementNormal", 0),
    layerElem("LayerElementSmoothing", 0),
    layerElem("LayerElementMaterial", 0),
  ];
  if (mesh.uvs.length) layers.push(layerElem("LayerElementUV", 0));
  if (mesh.colors.length) layers.push(layerElem("LayerElementColor", 0));

  const normalBlock =
    mesh.normals.length > 0
      ? `\n\t\t\tLayerElementNormal: 0 {\n\t\t\t\tVersion: 101\n\t\t\t\tName: \"\"\n\t\t\t\tMappingInformationType: \"ByPolygonVertex\"\n\t\t\t\tReferenceInformationType: \"Direct\"\n${fbxArray(\"Normals\", mesh.normals, \"\\t\\t\\t\\t\")}\n\t\t\t}`
      : \"\";

  const smoothingBlock =
    mesh.polygonCount > 0
      ? `\n\t\t\tLayerElementSmoothing: 0 {\n\t\t\t\tVersion: 102\n\t\t\t\tName: \"\"\n\t\t\t\tMappingInformationType: \"ByPolygon\"\n\t\t\t\tReferenceInformationType: \"Direct\"\n${fbxArray(\"Smoothing\", smoothing, \"\\t\\t\\t\\t\", true)}\n\t\t\t}`
      : \"\";

  const uvBlock =
    mesh.uvs.length > 0
      ? `\n\t\t\tLayerElementUV: 0 {\n\t\t\t\tVersion: 101\n\t\t\t\tName: \"UVMap\"\n\t\t\t\tMappingInformationType: \"ByPolygonVertex\"\n\t\t\t\tReferenceInformationType: \"Direct\"\n${fbxArray(\"UV\", mesh.uvs, \"\\t\\t\\t\\t\")}\n\t\t\t}`
      : \"\";

  const colorBlock =
    mesh.colors.length > 0
      ? `\n\t\t\tLayerElementColor: 0 {\n\t\t\t\tVersion: 101\n\t\t\t\tName: \"Col\"\n\t\t\t\tMappingInformationType: \"ByPolygonVertex\"\n\t\t\t\tReferenceInformationType: \"Direct\"\n${fbxArray(\"Colors\", mesh.colors, \"\\t\\t\\t\\t\")}\n\t\t\t}`
      : \"\";

  return `; FBX 7.4.0 project file\n; Generated by PolyExport\n; ${mesh.vertices.length / 3} verts · ${mesh.polygonCount} ${options.wireframeOnly ? \"edges\" : \"faces\"} · ${options.axis}\n; Units: centimeters (100 = 1 meter in Unreal)\n; ----------------------------------------------------\n\nFBXHeaderExtension:  {\n\tFBXHeaderVersion: 1003\n\tFBXVersion: 7400\n\tCreationTimeStamp:  {\n\t\tVersion: 1000\n\t\tYear: ${t.year}\n\t\tMonth: ${t.month}\n\t\tDay: ${t.day}\n\t\tHour: ${t.hour}\n\t\tMinute: ${t.minute}\n\t\tSecond: ${t.second}\n\t\tMillisecond: 0\n\t}\n\tCreator: \"PolyExport\"\n\tOtherFlags:  {\n\t\tFlagPLE: 0\n\t}\n}\nGlobalSettings:  {\n\tVersion: 1000\n\tProperties70:  {\n\t\tP: \"UpAxis\", \"int\", \"Integer\", \"\",${upAxis}\n\t\tP: \"UpAxisSign\", \"int\", \"Integer\", \"\",1\n\t\tP: \"FrontAxis\", \"int\", \"Integer\", \"\",${frontAxis}\n\t\tP: \"FrontAxisSign\", \"int\", \"Integer\", \"\",${frontAxisSign}\n\t\tP: \"CoordAxis\", \"int\", \"Integer\", \"\",0\n\t\tP: \"CoordAxisSign\", \"int\", \"Integer\", \"\",1\n\t\tP: \"OriginalUpAxis\", \"int\", \"Integer\", \"\",${originalUpAxis}\n\t\tP: \"OriginalUpAxisSign\", \"int\", \"Integer\", \"\",1\n\t\tP: \"UnitScaleFactor\", \"double\", \"Number\", \"\",1\n\t\tP: \"OriginalUnitScaleFactor\", \"double\", \"Number\", \"\",1\n\t\tP: \"AmbientColor\", \"ColorRGB\", \"Color\", \"\",0.1,0.1,0.1\n\t\tP: \"DefaultCamera\", \"KString\", \"\", \"\", \"Producer Perspective\"\n\t\tP: \"TimeMode\", \"enum\", \"\", \"\",6\n\t\tP: \"TimeSpanStart\", \"KTime\", \"Time\", \"\",0\n\t\tP: \"TimeSpanStop\", \"KTime\", \"Time\", \"\",46186158000\n\t}\n}\nDocuments:  {\n\tCount: 1\n\tDocument: 1000000000, \"Scene\", \"Scene\" {\n\t\tProperties70:  {\n\t\t\tP: \"SourceObject\", \"object\", \"\", \"\"\n\t\t\tP: \"ActiveAnimStackName\", \"KString\", \"\", \"\", \"\"\n\t\t}\n\t\tRootNode: 0\n\t}\n}\nReferences:  {\n}\nDefinitions:  {\n\tVersion: 100\n\tCount: 4\n\tObjectType: \"GlobalSettings\" {\n\t\tCount: 1\n\t}\n\tObjectType: \"Model\" {\n\t\tCount: 1\n\t}\n\tObjectType: \"Geometry\" {\n\t\tCount: 1\n\t}\n\tObjectType: \"Material\" {\n\t\tCount: ${materials.length}\n\t}\n}\nObjects:  {\n\tGeometry: ${geoId}, \"Geometry::${modelName}\", \"Mesh\" {\n\t\tProperties70:  {\n\t\t\tP: \"Color\", \"ColorRGB\", \"Color\", \"\",${fmt(materials[0]!.color[0], 4)},${fmt(materials[0]!.color[1], 4)},${fmt(materials[0]!.color[2], 4)}\n\t\t}\n\t\tGeometryVersion: 124\n${fbxArray(\"Vertices\", mesh.vertices, \"\\t\\t\")}\n${fbxArray(\"PolygonVertexIndex\", mesh.polygonIndex, \"\\t\\t\", true)}${normalBlock}${smoothingBlock}${uvBlock}${colorBlock}\n${materialLayer(mesh, materials.length)}\n\t\t\tLayer: 0 {\n\t\t\t\tVersion: 100\n${layers.join(\"\\n\")}\n\t\t\t}\n\t}\n\tModel: ${modelId}, \"Model::${modelName}\", \"Mesh\" {\n\t\tVersion: 232\n\t\tProperties70:  {\n\t\t\tP: \"RotationActive\", \"bool\", \"\", \"\",1\n\t\t\tP: \"InheritType\", \"enum\", \"\", \"\",1\n\t\t\tP: \"ScalingMax\", \"Vector3D\", \"Vector\", \"\",0,0,0\n\t\t\tP: \"DefaultAttributeIndex\", \"int\", \"Integer\", \"\",0\n\t\t\tP: \"Lcl Translation\", \"Lcl Translation\", \"\", \"A\",0,0,0\n\t\t\tP: \"Lcl Rotation\", \"Lcl Rotation\", \"\", \"A\",0,0,0\n\t\t\tP: \"Lcl Scaling\", \"Lcl Scaling\", \"\", \"A\",1,1,1\n\t\t}\n\t\tShading: T\n\t\tCulling: \"CullingOff\"\n\t}\n${materials\n  .map((m, i) => materialObject(matIds[i]!, m.name, m.color, spec, m.opacity ?? 1))\n  .join(\"\\n\")}\n}\nConnections:  {\n\tC: \"OO\",${modelId},0\n\tC: \"OO\",${geoId},${modelId}\n${matIds.map((id) => `\\tC: \"OO\",${id},${modelId}`).join(\"\\n\")}\n}\nTakes:  {\n\tCurrent: \"\"\n}\n`;
}

function materialLayer(mesh: ExtractedMesh, matCount: number) {
  if (matCount <= 1) {
    return `\\t\\t\\tLayerElementMaterial: 0 {\n\\t\\t\\t\\tVersion: 101\n\\t\\t\\t\\tName: \"\"\n\\t\\t\\t\\tMappingInformationType: \"AllSame\"\n\\t\\t\\t\\tReferenceInformationType: \"IndexToDirect\"\n\\t\\t\\t\\tMaterials: *1 {\n\\t\\t\\t\\t\\ta: 0\n\\t\\t\\t\\t}\n\\t\\t\\t}`;
  }
  return `\\t\\t\\tLayerElementMaterial: 0 {\n\\t\\t\\t\\tVersion: 101\n\\t\\t\\t\\tName: \"\"\n\\t\\t\\t\\tMappingInformationType: \"ByPolygon\"\n\\t\\t\\t\\tReferenceInformationType: \"IndexToDirect\"\n${fbxArray(\"Materials\", mesh.faceMaterials, \"\\t\\t\\t\\t\", true)}\n\\t\\t\\t}`;
}

function materialObject(
  id: number,
  name: string,
  color: [number, number, number],
  spec: number,
  opacity: number,
) {
  const [cr, cg, cb] = color;
  return `\\tMaterial: ${id}, \"Material::${sanitizeName(name)}\", \"\" {\n\\t\\tVersion: 102\n\\t\\tShadingModel: \"phong\"\n\\t\\tMultiLayer: 0\n\\t\\tProperties70:  {\n\\t\\t\\tP: \"Diffuse\", \"Vector3D\", \"Vector\", \"\",${fmt(cr, 4)},${fmt(cg, 4)},${fmt(cb, 4)}\n\\t\\t\\tP: \"DiffuseColor\", \"Color\", \"\", \"A\",${fmt(cr, 4)},${fmt(cg, 4)},${fmt(cb, 4)}\n\\t\\t\\tP: \"DiffuseFactor\", \"Number\", \"\", \"A\",1\n\\t\\t\\tP: \"Specular\", \"Vector3D\", \"Vector\", \"\",${fmt(spec, 4)},${fmt(spec, 4)},${fmt(spec, 4)}\n\\t\\t\\tP: \"SpecularColor\", \"Color\", \"\", \"A\",${fmt(spec, 4)},${fmt(spec, 4)},${fmt(spec, 4)}\n\\t\\t\\tP: \"Shininess\", \"double\", \"Number\", \"\",32\n\\t\\t\\tP: \"ShininessExponent\", \"Number\", \"\", \"A\",32\n\\t\\t\\tP: \"Emissive\", \"Vector3D\", \"Vector\", \"\",0,0,0\n\\t\\t\\tP: \"AmbientColor\", \"Color\", \"\", \"A\",0.05,0.05,0.05\n\\t\\t\\tP: \"Opacity\", \"double\", \"Number\", \"\",${fmt(opacity, 4)}\n\\t\\t}\n\\t}`;
}

function layerElem(type: string, index: number) {
  return `\\t\\t\\t\\tLayerElement:  {\n\\t\\t\\t\\t\\tType: \"${type}\"\n\\t\\t\\t\\t\\tTypedIndex: ${index}\n\\t\\t\\t\\t}`;
}

function sanitizeName(name: string) {
  const cleaned = name.replace(/[^\\w\\- ]+/g, \"\").trim() || \"Cube\";
  return cleaned.replace(/\\s+/g, \"_\").slice(0, 48);
}

export function downloadText(filename: string, contents: string, mime: string) {
  return saveBlob(filename, contents, mime);
}

export function downloadBuffer(filename: string, data: ArrayBuffer, mime: string) {
  return saveBlob(filename, data, mime);
}
