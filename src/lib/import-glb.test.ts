import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGlb, sniffGlb } from "./import-glb.ts";
import { measurePoly } from "./cube.ts";
import { meshKindOf, pickMeshFile } from "./import-mesh.ts";

function pad4(n: number) {
  return (n + 3) & ~3;
}

function cubeGlb(): ArrayBuffer {
  const positions = [
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
    0.5, -0.5, 0.5, 0.5,
  ];
  const indices = [
    0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3, 3, 7, 6, 3, 6, 2, 0, 1, 5, 0, 5, 4,
  ];
  const json = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: "VEC3",
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: 72 },
    ],
    buffers: [{ byteLength: 168 }],
  });
  const jsonPad = pad4(json.length);
  const jsonBytes = new Uint8Array(jsonPad);
  jsonBytes.set(new TextEncoder().encode(json));
  jsonBytes.fill(0x20, json.length);

  const bin = new ArrayBuffer(168);
  new Float32Array(bin, 0, 24).set(positions);
  new Uint16Array(bin, 96, 36).set(indices);

  const total = 12 + 8 + jsonBytes.length + 8 + 168;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20).set(jsonBytes);
  const binAt = 20 + jsonBytes.length;
  dv.setUint32(binAt, 168, true);
  dv.setUint32(binAt + 4, 0x004e4942, true);
  new Uint8Array(out, binAt + 8).set(new Uint8Array(bin));
  return out;
}

describe("import GLB", () => {
  it("sniffs glTF binary magic", () => {
    const buf = cubeGlb();
    assert.equal(sniffGlb(buf), true);
    assert.equal(meshKindOf("hero.GLB"), "glb");
    assert.equal(meshKindOf("hero.gltf"), "glb");
    const files = [new File(["x"], "a.obj"), new File(["x"], "b.glb")];
    assert.equal(pickMeshFile(files)?.name, "b.glb");
  });

  it("reads a GLB cube as 8 verts and 12 tris", async () => {
    const doc = await parseGlb(cubeGlb());
    const stats = measurePoly(doc.poly);
    assert.equal(stats.unique, 8);
    assert.equal(stats.faces, 12);
    for (const face of doc.poly.faces) {
      assert.equal(face.indices.length, 3);
    }
    let outward = 0;
    for (const face of doc.poly.faces) {
      let cx = 0,
        cy = 0,
        cz = 0;
      for (const i of face.indices) {
        cx += doc.poly.positions[i * 3]!;
        cy += doc.poly.positions[i * 3 + 1]!;
        cz += doc.poly.positions[i * 3 + 2]!;
      }
      const inv = 1 / face.indices.length;
      const facing =
        face.normal[0] * cx * inv + face.normal[1] * cy * inv + face.normal[2] * cz * inv;
      if (facing > 0) outward += 1;
    }
    assert.equal(outward, 12);
  });
});
