import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAngularFighter } from "./build-fighter.ts";
import { geometryToFbx } from "./export-fbx.ts";
import { polyMeshToGeometry } from "./cube.ts";

describe("angular fighter", () => {
  it("is one quad mesh with mirrored verts", () => {
    const { poly } = buildAngularFighter();
    assert.ok(poly.faces.length > 40);
    for (const f of poly.faces) {
      assert.equal(f.indices.length, 4);
    }
    const verts: Array<[number, number, number]> = [];
    for (let i = 0; i < poly.positions.length; i += 3) {
      verts.push([poly.positions[i]!, poly.positions[i + 1]!, poly.positions[i + 2]!]);
    }
    const right = verts.filter((v) => v[0] > 2);
    let hits = 0;
    for (const v of right) {
      const mate = verts.some(
        (o) =>
          Math.abs(o[0] + v[0]) < 0.6 &&
          Math.abs(o[1] - v[1]) < 0.6 &&
          Math.abs(o[2] - v[2]) < 0.6,
      );
      if (mate) hits += 1;
    }
    assert.ok(hits / right.length > 0.9, `symmetry ${hits}/${right.length}`);
  });

  it("exports z-up FBX", () => {
    const { poly, materials } = buildAngularFighter();
    const geo = polyMeshToGeometry(poly, true, materials.map((m) => m.name));
    geo.userData.polyMesh = poly;
    const fbx = geometryToFbx(geo, {
      name: "SM_AngularFighter",
      axis: "z-up",
      color: [0.86, 0.88, 0.9],
      materials: materials.map((m) => ({ name: m.name, color: m.color })),
    });
    geo.dispose();
    assert.match(fbx, /P: "UpAxis", "int", "Integer", "",2/);
    assert.match(fbx, /Material::hull/);
    assert.match(fbx, /Material::glass/);
  });

  it("has outward face normals on nose, wings, keel", () => {
    const { poly } = buildAngularFighter();
    let noseZ = 0,
      noseN = 0;
    let leftX = 0,
      leftN = 0;
    let rightX = 0,
      rightN = 0;
    let keelY = 0,
      keelN = 0;
    for (const face of poly.faces) {
      let x = 0,
        y = 0,
        z = 0;
      for (const i of face.indices) {
        x += poly.positions[i * 3]!;
        y += poly.positions[i * 3 + 1]!;
        z += poly.positions[i * 3 + 2]!;
      }
      const inv = 1 / face.indices.length;
      x *= inv;
      y *= inv;
      z *= inv;
      if (z > 400) {
        noseZ += face.normal[2];
        noseN += 1;
      }
      if (x > 250) {
        rightX += face.normal[0];
        rightN += 1;
      }
      if (x < -250) {
        leftX += face.normal[0];
        leftN += 1;
      }
      if (y < 18 && Math.abs(x) < 40) {
        keelY += face.normal[1];
        keelN += 1;
      }
    }
    assert.ok(noseN && noseZ / noseN > 0.2, `nose ${noseZ / noseN}`);
    assert.ok(keelN && keelY / keelN < -0.2, `keel ${keelY / keelN}`);
    assert.ok(rightN && rightX / rightN >= 0, `right wing ${rightX / rightN}`);
    assert.ok(leftN && leftX / leftN <= 0, `left wing ${leftX / leftN}`);
  });
});
