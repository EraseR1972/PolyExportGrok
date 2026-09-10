import { useRef } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyObjFiles } from "@/lib/apply-import";
import { formatBytes } from "@/lib/import-obj";
import { useStudio } from "@/lib/studio-store";
import { cn } from "@/lib/utils";

function toastImport(result: Awaited<ReturnType<typeof applyObjFiles>>) {
  const kind =
    result.kind === "fbx" ? "FBX" : result.kind === "lwo" ? "LWO" : result.kind === "glb" ? "GLB" : "OBJ";
  const scaleNote = result.scale === 100 ? " \u00b7 scaled \u00d7100 (meters \u2192 cm)" : "";
  const matNote =
    result.materials.length > 0
      ? ` \u00b7 ${result.materials.length} mat${result.materials.length === 1 ? "" : "s"}`
      : result.missingMtl
        ? " \u00b7 no .mtl"
        : "";
  const mapNote = result.mapsLoaded > 0 ? ` \u00b7 ${result.mapsLoaded} map${result.mapsLoaded === 1 ? "" : "s"}` : "";
  const sizeNote = result.bytes > 8 * 1024 * 1024 ? ` \u00b7 ${formatBytes(result.bytes)}` : "";
  toast.success(`${kind} imported`, {
    description: `${result.name} \u00b7 ${result.stats.unique} verts \u00b7 ${result.stats.faces} faces${scaleNote}${matNote}${mapNote}${sizeNote}`,
  });
  if (result.missingMtl) {
    toast.message("Materials not loaded", {
      description: "Select the .obj together with its .mtl and texture files.",
    });
  }
}

export function ImportObjButton({
  className,
  size = "sm",
  variant = "secondary",
  label = "Import",
}: {
  className?: string;
  size?: "sm" | "lg" | "default";
  variant?: "secondary" | "default" | "outline";
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useStudio((s) => Boolean(s.importProgress));

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;
    try {
      toastImport(await applyObjFiles(files));
    } catch (err) {
      toast.error("Could not import mesh", {
        description: err instanceof Error ? err.message : "Try OBJ, FBX, GLB, or LWO",
      });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".obj,.fbx,.glb,.gltf,.lwo,.lwob,.mtl,.png,.jpg,.jpeg,.webp,.bmp,.gif,application/octet-stream,model/gltf-binary,model/gltf+json"
        className="sr-only"
        data-testid="import-obj-input"
        disabled={busy}
        onChange={(e) => void onFiles(e.target.files)}
      />
      <Button
        type="button"
        size={size}
        variant={variant}
        className={cn(className)}
        data-testid="import-obj"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" />
        {busy ? "Reading\u2026" : label}
      </Button>
    </>
  );
}
