export type MtlDef = {
  name: string;
  kd: [number, number, number];
  ks: [number, number, number];
  ns: number;
  d: number;
  mapKd?: string;
};

export function parseMtl(text: string): MtlDef[] {
  const raw = text.replace(/^\uFEFF/, "");
  const list: MtlDef[] = [];
  let cur: MtlDef | null = null;

  function ensure(): MtlDef {
    if (!cur) {
      cur = blankMat("material");
      list.push(cur);
    }
    return cur;
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    const tag = (sp === -1 ? line : line.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? "" : line.slice(sp + 1).trim();

    if (tag === "newmtl") {
      cur = blankMat(rest || `material_${list.length + 1}`);
      list.push(cur);
    } else if (tag === "kd") {
      const v = parseVec3(rest);
      if (v) ensure().kd = v;
    } else if (tag === "ks") {
      const v = parseVec3(rest);
      if (v) ensure().ks = v;
    } else if (tag === "ns") {
      const n = Number.parseFloat(rest);
      if (Number.isFinite(n)) ensure().ns = n;
    } else if (tag === "d") {
      const n = Number.parseFloat(rest);
      if (Number.isFinite(n)) ensure().d = n;
    } else if (tag === "tr") {
      const n = Number.parseFloat(rest);
      if (Number.isFinite(n)) ensure().d = 1 - n;
    } else if (tag === "map_kd") {
      const file = texturePath(rest);
      if (file) ensure().mapKd = file;
    }
  }

  return list;
}

export function mtlRoughness(ns: number) {
  if (!Number.isFinite(ns) || ns <= 0) return 0.72;
  return Math.min(1, Math.max(0.04, 1 - ns / 1000));
}

export function baseName(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function blankMat(name: string): MtlDef {
  return {
    name,
    kd: [0.77, 0.75, 0.71],
    ks: [0.18, 0.18, 0.18],
    ns: 200,
    d: 1,
  };
}

function parseVec3(rest: string): [number, number, number] | null {
  const nums = rest.split(/\s+/).map(Number);
  if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return null;
  return [
    Math.min(1, Math.max(0, nums[0]!)),
    Math.min(1, Math.max(0, nums[1]!)),
    Math.min(1, Math.max(0, nums[2]!)),
  ];
}

function texturePath(rest: string): string {
  const parts = rest.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < parts.length) {
    const p = parts[i]!;
    if (!p.startsWith("-")) break;
    if (p === "-s" || p === "-o" || p === "-t" || p === "-mm") i += 4;
    else if (
      p === "-clamp" ||
      p === "-blendu" ||
      p === "-blendv" ||
      p === "-imfchan" ||
      p === "-bm" ||
      p === "-boost" ||
      p === "-texres"
    ) {
      i += 2;
    } else i += 1;
  }
  return parts.slice(i).join(" ").replace(/\\/g, "/");
}
