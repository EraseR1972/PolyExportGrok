# PolyExport

Browser studio for low-poly meshes: import **OBJ / FBX / LWO / GLB**, inspect normals and UVs, edit materials, then export Unreal-ready **FBX / OBJ / GLB**.

## Features

- Import OBJ (MTL + textures), FBX, LightWave LWO, GLB
- Viewport: hard surface, flat shaders, wireframe + faces, shadows, pivot snap
- Materials: RGB + alpha, per-material colors
- Check normals: Facing (blue/red) and RGB matcap
- Axis bake: Y-up or Z-up (Unreal)
- Export FBX (ASCII, quads), OBJ, GLB with materials

## Run locally

```bash
npm install
npx vite --host --port 8080
```

Open the URL Vite prints. Drag a mesh into the viewport or use **Import**.

## Scripts

| Command | What it does |
| --- | --- |
| `npx vite` | Dev server |
| `npm test` | Unit tests |
| `npx tsc --noEmit` | Typecheck |

## Stack

React, Three.js, TanStack Router, Zustand, Vite.
