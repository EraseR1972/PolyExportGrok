import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  Line,
  OrbitControls,
  TransformControls,
} from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { boundsActive, buildActiveGeometry } from "@/lib/active-mesh";
import { polyBoundaryPoints, polyMeshNormalTicks, polyMeshToGeometry, polyMeshToNormalPreview, polyMeshToUvPreview, type PolyMesh } from "@/lib/cube";
import { cubeParamsFrom, useStudio } from "@/lib/studio-store";

function useActiveBounds() {
  const width = useStudio((s) => s.width);
  const height = useStudio((s) => s.height);
  const depth = useStudio((s) => s.depth);
  const segments = useStudio((s) => s.segments);
  const bevel = useStudio((s) => s.bevel);
  const pivot = useStudio((s) => s.pivot);
  const originX = useStudio((s) => s.originX ?? 0);
  const originY = useStudio((s) => s.originY ?? 0);
  const originZ = useStudio((s) => s.originZ ?? 0);
  const imported = useStudio((s) => s.imported);
  const importScale = imported?.scale ?? 1;
  return useMemo(() => {
    const s = useStudio.getState();
    return boundsActive({ params: cubeParamsFrom(s), imported: s.imported });
  }, [width, height, depth, segments, bevel, pivot, originX, originY, originZ, imported, importScale]);
}

function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const shadowMode = useStudio((s) => s.shadowMode);
  const wireframe = useStudio((s) => s.wireframe);
  const includeFaces = useStudio((s) => s.includeFaces);
  const shadowsOn = (!wireframe || includeFaces) && shadowMode !== "off";

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const env = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
      envScene.dispose();
    };
  }, [gl, scene]);

  useEffect(() => {
    scene.environmentIntensity = shadowsOn ? 0.22 : 0.85;
  }, [scene, shadowsOn]);

  return null;
}

function Cage({
  geometry,
  color,
  lineWidth,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  lineWidth: number;
}) {
  const points = useMemo(() => {
    const poly = geometry.userData.polyMesh as PolyMesh | undefined;
    if (poly?.faces?.length) return polyBoundaryPoints(poly);
    const src = new THREE.WireframeGeometry(geometry);
    const arr = src.attributes.position?.array;
    src.dispose();
    const pts: Array<[number, number, number]> = [];
    if (!arr) return pts;
    for (let i = 0; i + 2 < arr.length; i += 3) {
      pts.push([arr[i]!, arr[i + 1]!, arr[i + 2]!]);
    }
    return pts;
  }, [geometry]);

  if (points.length < 2) return null;

  return (
    <Line
      segments
      points={points}
      color={color}
      lineWidth={lineWidth}
      depthTest
      toneMapped={false}
    />
  );
}

function makeUvChecker() {
  const size = 512;
  const cells = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();
  const step = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f4f1ea" : "#c45c4a";
      ctx.fillRect(x * step, y * step, step, step);
    }
  }
  ctx.strokeStyle = "#1c1c1c";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  ctx.fillStyle = "#1c1c1c";
  ctx.font = "bold 56px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("U →", size - 150, 64);
  ctx.fillText("V ↑", 16, size - 24);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function NormalCheck({ poly }: { poly: PolyMesh }) {
  const geometry = useMemo(() => polyMeshToNormalPreview(poly), [poly]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const ticks = useMemo(() => polyMeshNormalTicks(poly), [poly]);
  const tickGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(ticks, 3));
    return g;
  }, [ticks]);
  useEffect(() => () => tickGeo.dispose(), [tickGeo]);
  const shader = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        vertexShader: `\n          void main() {\n            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n          }\n        `,
        fragmentShader: `\n          void main() {\n            // Winding, not interpolated n·v — n·v flickers red on silhouettes when zoomed out.\n            vec3 col = gl_FrontFacing ? vec3(0.30, 0.55, 1.0) : vec3(0.89, 0.29, 0.29);\n            gl_FragColor = vec4(col, 1.0);\n            // Back faces lose the z-fight against the same triangle's front at grazing angles.\n            gl_FragDepth = gl_FragCoord.z + (gl_FrontFacing ? 0.0 : 0.0002);\n          }\n        `,
      }),
    [],
  );
  useEffect(() => () => shader.dispose(), [shader]);

  return (
    <group>
      <mesh geometry={geometry} material={shader} frustumCulled={false} />
      {ticks.length >= 6 ? (
        <lineSegments geometry={tickGeo} frustumCulled={false}>
          <lineBasicMaterial color="#f4e27a" />
        </lineSegments>
      ) : null}
    </group>
  );
}

function NormalRgb({
  geometry,
  poly,
}: {
  geometry: THREE.BufferGeometry;
  poly?: PolyMesh;
}) {
  const shaded = useMemo(() => {
    if (!poly?.faces.length) return geometry;
    return polyMeshToGeometry(poly, false);
  }, [geometry, poly]);
  useEffect(() => {
    if (shaded === geometry) return;
    return () => shaded.dispose();
  }, [shaded, geometry]);
  const shader = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.FrontSide,
        depthWrite: true,
        vertexShader: `\n          varying vec3 vN;\n          void main() {\n            vN = normalize(normalMatrix * normal);\n            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n          }\n        `,
        fragmentShader: `\n          varying vec3 vN;\n          void main() {\n            vec3 n = normalize(vN);\n            gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);\n          }\n        `,
      }),
    [],
  );
  useEffect(() => () => shader.dispose(), [shader]);
  return <mesh geometry={shaded} material={shader} frustumCulled={false} />;
}

function UvCheck({ poly, map }: { poly: PolyMesh; map: THREE.Texture }) {
  const geometry = useMemo(() => polyMeshToUvPreview(poly), [poly]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshStandardMaterial
        map={map}
        color="#ffffff"
        roughness={0.85}
        metalness={0}
        flatShading
        envMapIntensity={0.15}
        side={THREE.DoubleSide}
        depthWrite
      />
    </mesh>
  );
}

function StudioMesh() {
  const width = useStudio((s) => s.width);
  const height = useStudio((s) => s.height);
  const depth = useStudio((s) => s.depth);
  const segments = useStudio((s) => s.segments);
  const bevel = useStudio((s) => s.bevel);
  const flatShading = useStudio((s) => s.flatShading);
  const faceColors = useStudio((s) => s.faceColors);
  const pivot = useStudio((s) => s.pivot);
  const originX = useStudio((s) => s.originX ?? 0);
  const originY = useStudio((s) => s.originY ?? 0);
  const originZ = useStudio((s) => s.originZ ?? 0);
  const color = useStudio((s) => s.color);
  const roughness = useStudio((s) => s.roughness);
  const metalness = useStudio((s) => s.metalness);
  const opacity = useStudio((s) => s.opacity);
  const showEdges = useStudio((s) => s.showEdges);
  const wireframe = useStudio((s) => s.wireframe);
  const wireframeColor = useStudio((s) => s.wireframeColor);
  const includeFaces = useStudio((s) => s.includeFaces);
  const checkNormals = useStudio((s) => s.checkNormals);
  const normalVis = useStudio((s) => s.normalVis);
  const checkUvs = useStudio((s) => s.checkUvs);
  const uvChecker = useMemo(() => makeUvChecker(), []);
  useEffect(() => () => uvChecker.dispose(), [uvChecker]);
  const shadowMode = useStudio((s) => s.shadowMode);
  const showSolid = !checkNormals && !checkUvs && (!wireframe || includeFaces);
  const shadowsOn = showSolid && shadowMode !== "off";
  const wireframeWidth = useStudio((s) => s.wireframeWidth);
  const imported = useStudio((s) => s.imported);
  const importScale = imported?.scale ?? 1;
  const importName = imported?.fileName ?? "";
  const matKey =
    imported?.materials
      ?.map((m) => `${m.name}:${m.mapUrl ?? ""}:${m.color.join(",")}:${m.roughness}:${m.opacity}`)
      .join("|") ?? "";

  const geometry = useMemo(() => {
    const s = useStudio.getState();
    return buildActiveGeometry({
      params: cubeParamsFrom(s),
      imported: s.imported,
    });
  }, [
    width,
    height,
    depth,
    segments,
    bevel,
    flatShading,
    faceColors,
    pivot,
    originX,
    originY,
    originZ,
    imported,
    importScale,
    importName,
    matKey,
  ]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const objMaterials = useMemo(() => {
    const mats = imported?.materials;
    if (!mats?.length) return null;
    return mats.map((m) => {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(m.color[0], m.color[1], m.color[2]),
        roughness: m.roughness,
        metalness: m.metalness,
        transparent: m.opacity < 0.95,
        opacity: m.opacity,
        depthWrite: m.opacity >= 0.95,
        flatShading,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        envMapIntensity: flatShading ? 0.55 : 0.9,
        side: THREE.DoubleSide,
        shadowSide: THREE.FrontSide,
      });
      if (m.mapUrl) {
        const tex = new THREE.TextureLoader().load(m.mapUrl);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = true;
        mat.map = tex;
      }
      return mat;
    });
  }, [imported?.materials, matKey, flatShading]);

  useEffect(
    () => () => {
      objMaterials?.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
    },
    [objMaterials],
  );

  const depthMat = useMemo(
    () =>
      new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        side: THREE.FrontSide,
      }),
    [],
  );
  useEffect(() => () => depthMat.dispose(), [depthMat]);
  const useVertexColors = Boolean(faceColors && !imported && showSolid);
  const snapMode = useStudio((s) => s.snapMode);

  function snapToPoint(point: THREE.Vector3) {
    const pos = geometry.getAttribute("position");
    if (!pos) return;
    let bestX = 0,
      bestY = 0,
      bestZ = 0,
      bestD = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const d = (x - point.x) ** 2 + (y - point.y) ** 2 + (z - point.z) ** 2;
      if (d < bestD) {
        bestD = d;
        bestX = x;
        bestY = y;
        bestZ = z;
      }
    }
    const s = useStudio.getState();
    s.set({
      originX: (s.originX ?? 0) + bestX,
      originY: (s.originY ?? 0) + bestY,
      originZ: (s.originZ ?? 0) + bestZ,
      snapMode: "off",
    });
  }

  return (
    <group>
      <mesh
        name="studio-mesh"
        geometry={geometry}
        material={showSolid ? (objMaterials ?? undefined) : undefined}
        visible={showSolid}
        castShadow={shadowsOn}
        receiveShadow={shadowsOn}
        customDepthMaterial={shadowsOn ? depthMat : undefined}
        frustumCulled={false}
        onClick={
          snapMode === "point"
            ? (e) => {
                e.stopPropagation();
                snapToPoint(e.point);
              }
            : undefined
        }
      >
        {showSolid && !objMaterials ? (
          <meshStandardMaterial
            color={useVertexColors ? "#ffffff" : color}
            vertexColors={useVertexColors}
            roughness={roughness}
            metalness={metalness}
            opacity={opacity}
            transparent={opacity < 0.95}
            depthWrite={opacity >= 0.95}
            flatShading={flatShading}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            envMapIntensity={flatShading ? 0.55 : 0.9}
            side={THREE.DoubleSide}
            shadowSide={THREE.FrontSide}
          />
        ) : null}
        {showEdges && showSolid && !wireframe ? (
          <Cage geometry={geometry} color="#f4f1ea" lineWidth={0.7} />
        ) : null}
      </mesh>
      {checkUvs && geometry.userData.polyMesh ? (
        <group>
          <UvCheck poly={geometry.userData.polyMesh as PolyMesh} map={uvChecker} />
          <Cage geometry={geometry} color="#1a1a1a" lineWidth={0.45} />
        </group>
      ) : null}
      {checkUvs && !geometry.userData.polyMesh ? (
        <mesh geometry={geometry} frustumCulled={false}>
          <meshStandardMaterial
            map={uvChecker}
            color="#ffffff"
            roughness={0.85}
            metalness={0}
            flatShading
            side={THREE.DoubleSide}
            depthWrite
          />
        </mesh>
      ) : null}
      {checkNormals && normalVis === "rgb" ? (
        <NormalRgb
          geometry={geometry}
          poly={geometry.userData.polyMesh as PolyMesh | undefined}
        />
      ) : checkNormals ? (
        <group
          onClick={
            snapMode === "point"
              ? (e) => {
                  e.stopPropagation();
                  snapToPoint(e.point);
                }
              : undefined
          }
        >
          {geometry.userData.polyMesh ? (
            <NormalCheck poly={geometry.userData.polyMesh as PolyMesh} />
          ) : (
            <>
              <mesh geometry={geometry} frustumCulled={false}>
                <meshBasicMaterial color="#4d8dff" side={THREE.FrontSide} polygonOffset polygonOffsetFactor={1} />
              </mesh>
              <mesh geometry={geometry} frustumCulled={false}>
                <meshBasicMaterial color="#e24b4b" side={THREE.BackSide} polygonOffset polygonOffsetFactor={1} />
              </mesh>
            </>
          )}
          <Cage geometry={geometry} color="#1a1a1a" lineWidth={0.45} />
        </group>
      ) : null}
      {wireframe ? (
        <Cage geometry={geometry} color={wireframeColor} lineWidth={wireframeWidth} />
      ) : null}
      <VertexDots geometry={geometry} />
    </group>
  );
}

function Ground() {
  const bounds = useActiveBounds();
  const showGrid = useStudio((s) => s.showGrid);
  const wireframe = useStudio((s) => s.wireframe);
  const includeFaces = useStudio((s) => s.includeFaces);
  const shadowMode = useStudio((s) => s.shadowMode);

  const y = bounds.min[1];
  const span = Math.max(bounds.size[0], bounds.size[2], 100);
  const shadowsOn = (!wireframe || includeFaces) && shadowMode !== "off";
  const floorSize = Math.max(900, span * 12);

  return (
    <>
      {shadowsOn ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, y - 0.4, 0]}
          receiveShadow
        >
          <planeGeometry args={[floorSize, floorSize]} />
          <meshStandardMaterial
            color="#3a3c42"
            roughness={0.94}
            metalness={0}
            envMapIntensity={0.15}
          />
        </mesh>
      ) : showGrid ? (
        <Grid
          infiniteGrid
          fadeDistance={Math.max(720, span * 6)}
          fadeStrength={1.4}
          cellSize={10}
          cellThickness={0.55}
          cellColor="#2a2b2f"
          sectionSize={100}
          sectionThickness={1.05}
          sectionColor="#3d3f46"
          position={[0, y - 0.2, 0]}
        />
      ) : null}
    </>
  );
}

function SceneLights() {
  const az = useStudio((s) => s.lightAz);
  const el = useStudio((s) => s.lightEl);
  const lightColor = useStudio((s) => s.lightColor);
  const intensity = useStudio((s) => s.lightIntensity);
  const shadowMode = useStudio((s) => s.shadowMode);
  const shadowSoftness = useStudio((s) => s.shadowSoftness);
  const wireframe = useStudio((s) => s.wireframe);
  const includeFaces = useStudio((s) => s.includeFaces);
  const bounds = useActiveBounds();
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useRef<THREE.Object3D>(null);
  const cx = bounds.center[0];
  const cy = bounds.center[1];
  const cz = bounds.center[2];
  const span = Math.max(bounds.size[0], bounds.size[1], bounds.size[2], 80);
  const dist = Math.max(280, span * 2.5);
  const half = span * 1.8;
  const pos = useMemo(() => {
    const ar = (az * Math.PI) / 180;
    const er = (el * Math.PI) / 180;
    return [
      cx + dist * Math.cos(er) * Math.sin(ar),
      cy + dist * Math.sin(er),
      cz + dist * Math.cos(er) * Math.cos(ar),
    ] as [number, number, number];
  }, [az, el, dist, cx, cy, cz]);
  const shadowsOn = (!wireframe || includeFaces) && shadowMode !== "off";
  const key = Math.max(0, intensity);
  const fill = shadowsOn ? key * 0.06 : key * 0.24;
  const rim = shadowsOn ? key * 0.04 : key * 0.15;
  const radius = 0.4 + shadowSoftness * 12;

  useLayoutEffect(() => {
    const l = light.current;
    const t = target.current;
    if (!l || !t) return;
    t.position.set(cx, cy, cz);
    t.updateMatrixWorld();
    l.target = t;
    l.castShadow = shadowsOn;
    const cam = l.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = Math.max(0.5, dist - span * 2.5);
    cam.far = dist + span * 6;
    cam.updateProjectionMatrix();
    l.shadow.bias = -0.0008;
    l.shadow.normalBias = Math.max(0.12, span * 0.003);
    l.shadow.radius = radius;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.autoUpdate = true;
    l.shadow.needsUpdate = true;
    l.target.updateMatrixWorld();
  }, [cx, cy, cz, pos, shadowsOn, radius, key, half, dist, span]);

  return (
    <>
      <hemisphereLight args={["#e4e8e4", "#2a2b2f", shadowsOn ? 0.22 : 0.7]} />
      <ambientLight intensity={shadowsOn ? 0.06 : 0.22} />
      <object3D ref={target} position={[cx, cy, cz]} />
      <directionalLight
        ref={light}
        color={lightColor}
        position={pos}
        intensity={key}
        castShadow={shadowsOn}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
        shadow-radius={radius}
        shadow-camera-near={Math.max(1, dist - span * 2)}
        shadow-camera-far={dist + span * 4}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
      />
      <directionalLight
        color={lightColor}
        position={[-pos[0] * 0.6, Math.max(40, pos[1] * 0.35), -pos[2] * 0.45]}
        intensity={fill}
      />
      <directionalLight
        color={lightColor}
        position={[pos[2] * 0.25, 40, -pos[0] * 0.25]}
        intensity={rim}
      />
      <mesh position={pos} renderOrder={8}>
        <sphereGeometry args={[Math.max(6, span * 0.035), 16, 12]} />
        <meshBasicMaterial color={lightColor} depthTest={false} />
      </mesh>
    </>
  );
}

function Framing() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const width = useStudio((s) => s.width);
  const height = useStudio((s) => s.height);
  const depth = useStudio((s) => s.depth);
  const segments = useStudio((s) => s.segments);
  const bevel = useStudio((s) => s.bevel);
  const pivot = useStudio((s) => s.pivot);
  const imported = useStudio((s) => s.imported);
  const importScale = imported?.scale ?? 1;

  useEffect(() => {
    const s = useStudio.getState();
    const b = boundsActive({ params: cubeParamsFrom(s), imported: s.imported });
    const maxDim = Math.max(b.size[0], b.size[1], b.size[2], 1);
    const portrait = size.height > size.width * 1.08;
    const dist = maxDim * (portrait ? 2.35 : 2.05);
    const cy = b.center[1];
    camera.up.set(0, 1, 0);
    camera.position.set(dist * 0.78, dist * 0.48 + cy, dist * 1.02);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = portrait ? 42 : 32;
      camera.near = Math.max(0.05, maxDim * 0.002);
      camera.far = Math.max(4000, maxDim * 80);
      camera.updateProjectionMatrix();
    }
    camera.lookAt(0, cy, 0);
  }, [camera, size.width, size.height, width, height, depth, segments, bevel, pivot, imported, importScale]);

  return null;
}

function AxisCross({
  size,
  radius,
}: {
  size: number;
  radius: number;
}) {
  return (
    <group>
      <mesh renderOrder={12}>
        <sphereGeometry args={[radius, 20, 16]} />
        <meshBasicMaterial color="#f4f1ea" depthTest={false} />
      </mesh>
      <Line
        points={[
          [-size, 0, 0],
          [size, 0, 0],
        ]}
        color="#c45c4a"
        lineWidth={2.4}
        worldUnits={false}
        renderOrder={11}
      />
      <Line
        points={[
          [0, -size, 0],
          [0, size, 0],
        ]}
        color="#6aaa6a"
        lineWidth={2.4}
        worldUnits={false}
        renderOrder={11}
      />
      <Line
        points={[
          [0, 0, -size],
          [0, 0, size],
        ]}
        color="#5a7ec4"
        lineWidth={2.4}
        worldUnits={false}
        renderOrder={11}
      />
    </group>
  );
}

function MeshCenterMarker() {
  const width = useStudio((s) => s.width);
  const height = useStudio((s) => s.height);
  const depth = useStudio((s) => s.depth);
  const segments = useStudio((s) => s.segments);
  const bevel = useStudio((s) => s.bevel);
  const pivot = useStudio((s) => s.pivot);
  const originX = useStudio((s) => s.originX ?? 0);
  const originY = useStudio((s) => s.originY ?? 0);
  const originZ = useStudio((s) => s.originZ ?? 0);
  const imported = useStudio((s) => s.imported);
  const importScale = imported?.scale ?? 1;

  const center = useMemo(() => {
    const s = useStudio.getState();
    return boundsActive({ params: cubeParamsFrom(s), imported: s.imported }).center;
  }, [width, height, depth, segments, bevel, pivot, originX, originY, originZ, imported, importScale]);

  const dist = Math.hypot(center[0], center[1], center[2]);
  if (dist < 1.5) return null;

  return (
    <group position={center}>
      <AxisCross size={16} radius={2.1} />
    </group>
  );
}

function VertexDots({ geometry }: { geometry: THREE.BufferGeometry }) {
  const snapMode = useStudio((s) => s.snapMode);
  const points = useMemo(() => {
    const pos = geometry.getAttribute("position");
    if (!pos) return new Float32Array(0);
    const seen = new Map<string, number>();
    const out: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.set(key, 1);
      out.push(x, y, z);
      if (out.length > 24_000) break;
    }
    return new Float32Array(out);
  }, [geometry]);

  if (snapMode !== "point" || points.length < 3) return null;

  return (
    <points renderOrder={20}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#7ec8e3"
        size={9}
        sizeAttenuation={false}
        depthTest={false}
      />
    </points>
  );
}

function PivotEditor() {
  const dummy = useRef<THREE.Group>(null!);
  const controls = useThree((s) => s.controls);
  const gl = useThree((s) => s.gl);
  const originX = useStudio((s) => s.originX ?? 0);
  const originY = useStudio((s) => s.originY ?? 0);
  const originZ = useStudio((s) => s.originZ ?? 0);
  const snapMode = useStudio((s) => s.snapMode);

  useEffect(() => {
    dummy.current?.position.set(0, 0, 0);
  }, [originX, originY, originZ]);

  useEffect(() => {
    const el = gl.domElement;
    el.style.cursor = snapMode === "point" ? "crosshair" : "";
    return () => {
      el.style.cursor = "";
    };
  }, [gl, snapMode]);

  function bake() {
    const g = dummy.current;
    if (!g) return;
    const dx = g.position.x;
    const dy = g.position.y;
    const dz = g.position.z;
    if (dx === 0 && dy === 0 && dz === 0) return;
    const s = useStudio.getState();
    s.set({
      originX: (s.originX ?? 0) + dx,
      originY: (s.originY ?? 0) + dy,
      originZ: (s.originZ ?? 0) + dz,
    });
    g.position.set(0, 0, 0);
  }

  return (
    <>
      <group ref={dummy}>
        <AxisCross size={22} radius={2.6} />
      </group>
      {snapMode === "point" ? null : (
        <TransformControls
          object={dummy}
          mode="translate"
          size={0.9}
          onMouseDown={() => {
            const c = controls as { enabled?: boolean } | null;
            if (c) c.enabled = false;
          }}
          onMouseUp={() => {
            bake();
            const c = controls as { enabled?: boolean } | null;
            if (c) c.enabled = true;
          }}
        />
      )}
    </>
  );
}

function CameraRig() {
  const autoRotate = useStudio((s) => s.autoRotate);
  const width = useStudio((s) => s.width);
  const height = useStudio((s) => s.height);
  const depth = useStudio((s) => s.depth);
  const pivot = useStudio((s) => s.pivot);
  const imported = useStudio((s) => s.imported);
  const importScale = imported?.scale ?? 1;
  const cy = useMemo(() => {
    const s = useStudio.getState();
    return boundsActive({ params: cubeParamsFrom(s), imported: s.imported }).center[1];
  }, [width, height, depth, pivot, imported, importScale]);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <OrbitControls
      makeDefault
      enableDamping
      enableRotate
      enableZoom
      enablePan
      dampingFactor={0.08}
      autoRotate={autoRotate && !reduced}
      autoRotateSpeed={0.55}
      minDistance={30}
      maxDistance={8000}
      target={[0, cy, 0]}
    />
  );
}

export function StudioViewport() {
  const showAxes = useStudio((s) => s.showAxes);
  const showPivot = useStudio((s) => s.showPivot);
  const shadowMode = useStudio((s) => s.shadowMode);
  const wireframe = useStudio((s) => s.wireframe);
  const includeFaces = useStudio((s) => s.includeFaces);
  const shadowsOn = (!wireframe || includeFaces) && shadowMode !== "off";

  return (
    <Canvas
      shadows={shadowsOn}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      }}
      camera={{ position: [180, 120, 230], fov: 32, near: 0.1, far: 8000 }}
      onCreated={({ gl }) => {
        gl.setClearColor("#0c0d0f", 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      style={{ touchAction: "none" }}
    >
      <StudioEnvironment />
      <Framing />
      <SceneLights />
      <StudioMesh />
      {showPivot ? <PivotEditor /> : null}
      {showPivot ? <MeshCenterMarker /> : null}
      <Ground />
      {showAxes ? <axesHelper args={[48]} /> : null}
      <CameraRig />
      <GizmoHelper alignment="bottom-left" margin={[56, 56]}>
        <GizmoViewport
          axisColors={["#c45c4a", "#6aaa6a", "#5a7ec4"]}
          labelColor="#ecebe6"
        />
      </GizmoHelper>
    </Canvas>
  );
}
