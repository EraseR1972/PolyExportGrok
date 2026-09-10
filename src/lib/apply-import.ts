import { guessImportScale, measurePoly, scalePoly } from "@/lib/cube";
import { stemFromFileName } from "@/lib/import-obj";
import { readMeshBundle, type MeshBundle } from "@/lib/import-mesh";
import { useStudio } from "@/lib/studio-store";

export async function applyObjFile(file: File) {
  return applyObjFiles([file]);
}

export async function applyObjFiles(files: File[] | FileList): Promise<MeshBundle & { name: string; stats: ReturnType<typeof measurePoly>; scale: number }> {
  if (useStudio.getState().importProgress) {
    throw new Error("An import is already running");
  }
  const list = [...files];
  const mesh =
    list.find((f) => /\.(fbx|glb|gltf|lwo|lwob|obj)$/i.test(f.name)) ?? list[0];
  useStudio.getState().set({
    importProgress: {
      name: mesh?.name ?? "mesh",
      ratio: 0,
      phase: "Reading mesh",
    },
  });
  try {
    const bundle = await readMeshBundle(files, (ratio, phase) => {
      useStudio.getState().set({
        importProgress: {
          name: mesh?.name ?? "mesh",
          ratio,
          phase,
        },
      });
    });
    const scale = guessImportScale(bundle.poly);
    const name = stemFromFileName(bundle.fileName);
    const stats = measurePoly(scalePoly(bundle.poly, scale));
    useStudio.getState().setImported({
      fileName: bundle.fileName,
      poly: bundle.poly,
      scale,
      materials: bundle.materials,
    });
    useStudio.getState().set({ name, faceColors: false, axis: "z-up" });
    useStudio.getState().rememberConversion();
    return { ...bundle, name, stats, scale };
  } finally {
    useStudio.getState().set({ importProgress: null });
  }
}
