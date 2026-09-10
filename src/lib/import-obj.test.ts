import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { measurePoly } from "./cube.ts";
import { geometryToFbx } from "./export-fbx.ts";
import { parseObj, parseObjDocument, parseObjFile, stemFromFileName } from "./import-obj.ts";
import { parseMtl, mtlRoughness } from "./import-mtl.ts";
import { polyMeshToGeometry } from "./cube.ts";

const cubeObj = `# cube
mtllib cube.mtl
v -0.5 -0.5 -0.5
v  0.5 -0.5 -0.5
v  0.5  0.5 -0.5
v -0.5  0.5 -0.5
v -0.5 -0.5  0.5
v  0.5 -0.5  0.5
v  0.5  0.5  0.5
v -0.5  0.5  0.5
vt 0 0
vt 1 0
vt 1 1
vt 0 1
usemtl red
f 1/1 2/2 3/3 4/4
usemtl blue
f 5/1 8/4 7/3 6/2
f 2/1 6/2 7/3 3/4
f 1/1 4/2 8/3 5/4
f 4/1 3/2 7/3 8/4
f 1/1 5/2 6/3 2/4
`;

describe("import OBJ", () => {
  it("keeps 8 verts and 6 quads", () => {
    const poly = parseObj(cubeObj);
    const stats = measurePoly(poly);
    assert.equal(stats.unique, 8);
    assert.equal(stats.faces, 6);
    assert.equal(stats.triangles, 12);
    assert.equal(poly.faces[0]?.indices.length, 4);
    const face0 = poly.faces[0]!;
    const uvOf = (vi: number) => face0.uvs[face0.indices.indexOf(vi)];
    assert.deepEqual(uvOf(0), [0, 0]);
    assert.deepEqual(uvOf(1), [1, 0]);
    assert.deepEqual(uvOf(2), [1, 1]);
    assert.deepEqual(uvOf(3), [0, 1]);
  });

  it("reads mtllib and usemtl", () => {
    const doc = parseObjDocument(cubeObj);
    assert.deepEqual(doc.mtllibs, ["cube.mtl"]);
    assert.equal(doc.poly.faces[0]?.material, "red");
    assert.equal(doc.poly.faces[1]?.material, "blue");
  });

  it("reads vn and uses them as face normals", () => {
    const poly = parseObj(`o n
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
vn 0 0 1
f 1//1 2//1 3//1 4//1
`);
    const n = poly.faces[0]?.normal ?? [0, 0, 0];
    assert.ok(Math.abs(n[0]) < 0.01);
    assert.ok(Math.abs(n[1]) < 0.01);
    assert.ok(n[2] > 0.99);
  });

  it("reverses winding when vn points opposite the ring", () => {
    const poly = parseObj(`o n
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
vn 0 0 -1
f 1//1 2//1 3//1 4//1
`);
    const n = poly.faces[0]?.normal ?? [0, 0, 0];
    assert.ok(n[2] < -0.99);
    assert.deepEqual(poly.faces[0]?.indices, [3, 2, 1, 0]);
  });

  it("exports imported mesh as FBX quads", () => {
    const poly = parseObj(cubeObj);
    const geo = polyMeshToGeometry(poly, true);
    geo.userData.polyMesh = poly;
    const fbx = geometryToFbx(geo, {
      name: "from_obj",
      axis: "y-up",
      color: [0.7, 0.7, 0.7],
    });
    geo.dispose();
    assert.equal(Number(fbx.match(/Vertices: \*(\d+)/)?.[1]), 24);
    assert.equal(Number(fbx.match(/PolygonVertexIndex: \*(\d+)/)?.[1]), 24);
    const body = fbx.match(/PolygonVertexIndex: \*24 \{\s*a: ([^\n]+)/)?.[1];
    assert.ok(body);
    const idx = body.split(",").map(Number);
    assert.equal(idx.filter((n) => n < 0).length, 6);
  });

  it("builds geometry groups per material", () => {
    const poly = parseObj(cubeObj);
    const geo = polyMeshToGeometry(poly, true, ["red", "blue"]);
    assert.ok(geo.groups.length >= 2);
    assert.equal(geo.groups[0]?.materialIndex, 0);
    geo.dispose();
  });

  it("streams an OBJ from a File", async () => {
    const file = new File([cubeObj], "cube.obj", { type: "text/plain" });
    const doc = await parseObjFile(file);
    assert.equal(doc.poly.faces.length, 6);
    assert.equal(doc.poly.positions.length / 3, 8);
    assert.deepEqual(doc.mtllibs, ["cube.mtl"]);
    assert.equal(doc.poly.faces[0]?.material, "red");
  });

  it("stems file names", () => {
    assert.equal(stemFromFileName("ship hull.obj"), "ship_hull");
  });

  it("rejects empty files", () => {
    assert.throws(() => parseObj("o empty\n"), /no usable mesh/);
  });
});

describe("import MTL", () => {
  it("reads Kd and map_Kd", () => {
    const mats = parseMtl(`
newmtl hull
Kd 0.8 0.1 0.1
Ns 400
map_Kd textures\\hull.png
newmtl glass
Kd 0.2 0.4 0.9
d 0.4
`);
    assert.equal(mats.length, 2);
    assert.equal(mats[0]?.name, "hull");
    assert.deepEqual(mats[0]?.kd, [0.8, 0.1, 0.1]);
    assert.equal(mats[0]?.mapKd, "textures/hull.png");
    assert.equal(mats[1]?.d, 0.4);
    assert.ok(mtlRoughness(400) < mtlRoughness(80));
  });
});
