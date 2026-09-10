import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCubeGeometry, measurePoly } from "./cube.ts";
import { bevelPoly } from "./bevel-poly.ts";

describe("bevelPoly", () => {
  it("leaves a mesh unchanged at amount 0", () => {
    const geo = buildCubeGeometry({
      width: 100,
      height: 100,
      depth: 100,
      segments: 1,
      bevel: 0,
      flatShading: true,
      faceColors: false,
      pivot: "center",
    });
    const poly = geo.userData.polyMesh;
    const out = bevelPoly(poly, 0);
    assert.equal(out.faces.length, 6);
    assert.equal(out.positions.length, 24);
    geo.dispose();
  });

  it("chamfers a cube into 6 faces + 12 edges + 8 corners", () => {
    const geo = buildCubeGeometry({
      width: 100,
      height: 100,
      depth: 100,
      segments: 1,
      bevel: 0,
      flatShading: true,
      faceColors: false,
      pivot: "center",
    });
    const poly = geo.userData.polyMesh;
    const out = bevelPoly(poly, 0.16);
    geo.dispose();
    assert.equal(out.faces.length, 26);
    assert.equal(out.positions.length / 3, 24);
    const stats = measurePoly(out);
    assert.equal(stats.faces, 26);
    for (let i = 0; i < out.positions.length; i++) {
      assert.equal(Number.isFinite(out.positions[i]), true);
    }
    const max = Math.max(...out.positions.map(Math.abs));
    assert.ok(max <= 50.01);
    assert.ok(max > 40);
  });
});
