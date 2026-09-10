import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCubeGeometry } from "./cube.ts";
import { geometryToFbx } from "./export-fbx.ts";
import { parseObj } from "./import-obj.ts";
import { polyMeshToGeometry } from "./cube.ts";

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
usemtl deck
f 5 8 7 6
f 2 6 7 3
f 1 4 8 5
f 4 3 7 8
f 1 5 6 2
`;

describe("FBX export", () => {
  it("writes Unreal Z-up metadata and identity transform", () => {
    const geo = buildCubeGeometry({
      width: 100,
      height: 100,
      depth: 100,
      segments: 1,
      bevel: 0,
      flatShading: true,
      faceColors: false,
      pivot: "bottom",
    });
    const fbx = geometryToFbx(geo, {
      name: "SM_LowPolyCube",
      axis: "z-up",
      color: [0.77, 0.75, 0.71],
    });
    geo.dispose();
    assert.match(fbx, /FBXVersion: 7400/);
    assert.match(fbx, /P: "UpAxis", "int", "Integer", "",2/);
    assert.match(fbx, /P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0/);
    assert.match(fbx, /P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1/);
    assert.match(fbx, /UnitScaleFactor", "double", "Number", "",1/);
  });

  it("writes one phong material for the cube", () => {
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
    const fbx = geometryToFbx(geo, {
      name: "lowpoly_cube",
      axis: "y-up",
      color: [0.8, 0.2, 0.1],
    });
    geo.dispose();
    assert.match(fbx, /ObjectType: "Material" \{\s*Count: 1/);
    assert.match(fbx, /MappingInformationType: "AllSame"/);
    assert.match(fbx, /DiffuseColor", "Color", "", "A",0\.8000,0\.2000,0\.1000/);
  });

  it("writes OBJ materials per face", () => {
    const poly = parseObj(cubeObj);
    const geo = polyMeshToGeometry(poly, true, ["hull", "deck"]);
    geo.userData.polyMesh = poly;
    const fbx = geometryToFbx(geo, {
      name: "ship",
      axis: "z-up",
      color: [0.7, 0.7, 0.7],
      materials: [
        { name: "hull", color: [0.9, 0.15, 0.1] },
        { name: "deck", color: [0.15, 0.45, 0.85] },
      ],
    });
    geo.dispose();
    assert.match(fbx, /ObjectType: "Material" \{\s*Count: 2/);
    assert.match(fbx, /MappingInformationType: "ByPolygon"/);
    assert.match(fbx, /Material::hull/);
    assert.match(fbx, /Material::deck/);
    const mats = fbx.match(/Materials: \*6 \{\s*a: ([^\n]+)/);
    assert.ok(mats?.[1]);
    assert.equal(mats[1], "0,1,1,1,1,1");
    assert.match(fbx, /C: "OO",1000000003,1000000002/);
    assert.match(fbx, /C: "OO",1000000004,1000000002/);
  });

  it("exports unique edges and drops faces", () => {
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
    const fbx = geometryToFbx(geo, {
      name: "wire_cube",
      axis: "y-up",
      color: [0.8, 0.8, 0.8],
      wireframeOnly: true,
    });
    geo.dispose();
    assert.match(fbx, /12 edges/);
    const idx = fbx.match(/PolygonVertexIndex: \*(\d+)/);
    assert.equal(idx?.[1], "24");
  });

  it("refuses empty geometry", () => {
    const geo = polyMeshToGeometry({ positions: [], faces: [] }, true);
    assert.throws(
      () =>
        geometryToFbx(geo, {
          name: "empty",
          axis: "y-up",
          color: [1, 1, 1],
        }),
      /Nothing to export/,
    );
    geo.dispose();
  });
});
