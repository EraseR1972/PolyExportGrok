import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyBoxUvs, buildCubeGeometry, measureGeometry, polyMeshToNormalPreview, tessellateFace, faceTriDot } from "./cube.ts";
import { geometryToFbx } from "./export-fbx.ts";

const base = {
  width: 100,
  height: 100,
  depth: 100,
  segments: 1,
  bevel: 0,
  flatShading: true,
  faceColors: false,
  pivot: "center" as const,
};

describe("low poly cube", () => {
  it("is 8 verts and 6 quads", () => {
    const geo = buildCubeGeometry(base);
    const stats = measureGeometry(geo);
    assert.equal(stats.unique, 8);
    assert.equal(stats.faces, 6);
    assert.equal(stats.triangles, 12);
    geo.dispose();
  });

  it("writes FBX with 8 unique vertices and 6 quad polygons", () => {
    const geo = buildCubeGeometry(base);
    const fbx = geometryToFbx(geo, {
      name: "lowpoly_cube",
      axis: "y-up",
      color: [0.77, 0.75, 0.71],
    });
    geo.dispose();

    const verts = fbx.match(/Vertices: \*(\d+)/);
    const polys = fbx.match(/PolygonVertexIndex: \*(\d+)/);
    assert.equal(Number(verts?.[1]), 24);
    assert.equal(Number(polys?.[1]), 24);

    const body = fbx.match(/PolygonVertexIndex: \*24 \{\s*a: ([^\n]+)/);
    assert.ok(body?.[1]);
    const idx = body[1].split(",").map(Number);
    const ends = idx.filter((n) => n < 0);
    assert.equal(ends.length, 6);
    assert.equal(idx.length, 24);
  });

  it("bakes height onto Z for Unreal z-up", () => {
    const geo = buildCubeGeometry({
      ...base,
      height: 200,
      depth: 40,
      pivot: "bottom",
    });
    const fbx = geometryToFbx(geo, {
      name: "SM_LowPolyCube",
      axis: "z-up",
      color: [0.77, 0.75, 0.71],
    });
    geo.dispose();
    assert.match(fbx, /P: "UpAxis", "int", "Integer", "",2/);
    assert.match(fbx, /P: "FrontAxisSign", "int", "Integer", "",-1/);
    const verts = fbx.match(/Vertices: \*24 \{\s*a: ([^\n]+)/);
    assert.ok(verts?.[1]);
    const nums = verts[1].split(",").map(Number);
    const ys = nums.filter((_, i) => i % 3 === 1);
    const zs = nums.filter((_, i) => i % 3 === 2);
    assert.ok(Math.max(...zs) > 199 && Math.max(...zs) < 201);
    assert.ok(Math.min(...zs) > -1 && Math.min(...zs) < 1);
    assert.ok(Math.max(...ys) > 19 && Math.max(...ys) < 21);
    assert.ok(Math.min(...ys) < -19 && Math.min(...ys) > -21);
  });

  it("subdivides into quads", () => {
    const geo = buildCubeGeometry({ ...base, segments: 2 });
    const stats = measureGeometry(geo);
    assert.equal(stats.faces, 24);
    assert.equal(stats.unique, 26);
    geo.dispose();
  });

  it("tessellates a non-planar n-gon without inverted tris", () => {
    const pos = [
      0, 0, 0, 10, 0, 1, 10, 8, 0, 5, 10, 2, 0, 8, 0,
    ];
    const nrm: [number, number, number] = [0, 0, 1];
    const tris = tessellateFace(pos, [0, 1, 2, 3, 4], nrm);
    assert.ok(tris.length >= 3);
    for (const [ia, ib, ic] of tris) {
      assert.ok(faceTriDot(pos, ia, ib, ic, nrm) >= -1e-8);
    }
  });

  it("normal preview uses face normals not winding of a flipped tessellation", () => {
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
    geo.dispose();
    const preview = polyMeshToNormalPreview(poly);
    const nrm = preview.getAttribute("normal")!;
    let minY = Infinity;
    for (let i = 0; i < nrm.count; i++) {
      const ny = nrm.getY(i);
      const nx = nrm.getX(i);
      const nz = nrm.getZ(i);
      const len = Math.hypot(nx, ny, nz);
      assert.ok(Math.abs(len - 1) < 0.02);
      minY = Math.min(minY, ny);
    }
    assert.ok(minY < -0.9);
    preview.dispose();
  });

  it("fills box UVs only on faces that have no unwrap", () => {
    const poly = {
      positions: [
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
      ],
      faces: [
        {
          indices: [0, 1, 2, 3],
          normal: [0, 0, 1] as [number, number, number],
          uvs: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ] as Array<[number, number]>,
        },
        {
          indices: [4, 5, 6, 7],
          normal: [0, 0, 1] as [number, number, number],
          uvs: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ] as Array<[number, number]>,
        },
      ],
    };
    const out = applyBoxUvs(poly);
    assert.deepEqual(out.faces[0]?.uvs, [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    const mapped = out.faces[1]!.uvs;
    const spanU = Math.max(...mapped.map((u) => u[0])) - Math.min(...mapped.map((u) => u[0]));
    const spanV = Math.max(...mapped.map((u) => u[1])) - Math.min(...mapped.map((u) => u[1]));
    assert.ok(spanU * spanV > 0.01);
  });
});
