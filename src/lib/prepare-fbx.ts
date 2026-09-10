import { buildActiveGeometry } from "@/lib/active-mesh";
import { geometryToFbx } from "@/lib/export-fbx";
import { cubeParamsFrom, useStudio } from "@/lib/studio-store";

export function sanitizeFileStem(name: string) {
  return (name.replace(/[^\w\- ]+/g, "").trim() || "lowpoly_cube")
    .replace(/\s+/g, "_")
    .slice(0, 48);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  const v = Number.parseInt(n.length === 3 ? n.split("").map((c) => c + c).join("") : n, 16);
  if (!Number.isFinite(v)) return [0.77, 0.75, 0.71];
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function buildFbxAscii() {
  const s = useStudio.getState();
  const geo = buildActiveGeometry({
    params: cubeParamsFrom(s),
    imported: s.imported,
  });
  const ascii = geometryToFbx(geo, {
    name: s.name,
    axis: s.axis,
    color: hexToRgb(s.color),
    materials: s.imported?.materials?.map((m) => ({
      name: m.name,
      color: m.color,
      opacity: m.opacity,
    })),
    wireframeOnly: s.exportWireframe,
  });
  geo.dispose();
  return { ascii, filename: `${sanitizeFileStem(s.name)}.fbx` };
}
