import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseObj } from "./import-obj.ts";
import { parseGlb } from "./import-glb.ts";
import { buildGlb } from "./export-mesh.ts";
import type { CubeParams } from "./cube.ts";

const cubeObj = `mtllib cube.mtl
v -50 -50 -50
v  50 -50 -50
v  50  50 -50
v -50  50 -50
v -50 -50  50
v  50 -50  50
v  50  50  50
v -50  50  50
usemtl hull
f 1 2 3 4
usemtl glass
f 5 8 7 6
f 2 6 7 3
f 1 4 8 5
f 4 3 7 8
f 1 5 6 2
`;

const params: CubeParams = {
  width: 100,
  height: 100,
  depth: 100,
  segments: 1,
  bevel: 0,
  flatShading: true,
  faceColors: false,
  pivot: "center",
};

describe("GLB export materials", () => {
  it("embeds every material color into the glb", async () => {
    const poly = parseObj(cubeObj);
    const bytes = await buildGlb({
      params,
      imported: {
        fileName: "ship.obj",
        poly,
        scale: 1,
        materials: [
          { name: "hull", color: [0.9, 0.15, 0.1], roughness: 0.4, metalness: 0.2, opacity: 1 },
          { name: "glass", color: [0.12, 0.2, 0.28], roughness: 0.08, metalness: 0.35, opacity: 0.5 },
        ],
      },
      name: "SM_Ship",
      color: "#cccccc",
    });
    assert.ok(bytes.byteLength > 100);
    const doc = await parseGlb(bytes);
    const names = doc.materials.map((m) => m.name);
    assert.ok(names.includes("hull"), `materials ${names.join(",")}`);
    assert.ok(names.includes("glass"), `materials ${names.join(",")}`);
    const hull = doc.materials.find((m) => m.name === "hull")!;
    const glass = doc.materials.find((m) => m.name === "glass")!;
    assert.ok(hull.color[0] > 0.7 && hull.color[1] < 0.3);
    assert.ok(glass.color[2] > 0.2);
    assert.ok(glass.opacity < 0.7);
    const used = new Set(doc.poly.faces.map((f) => f.material));
    assert.ok(used.has("hull"));
    assert.ok(used.has("glass"));
  });
});
