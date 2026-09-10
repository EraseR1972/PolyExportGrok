import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Box, ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { toast, Toaster } from "sonner";
import { ClientCanvas } from "@/components/studio/client-canvas";
import { DownloadFbxLink } from "@/components/studio/download-fbx-link";
import { ImportObjButton } from "@/components/studio/import-obj-button";
import { StudioPanel } from "@/components/studio/panel";
import { Button } from "@/components/ui/button";
import { applyObjFiles } from "@/lib/apply-import";
import { filesFromDataTransfer } from "@/lib/dropped-files";
import { boundsActive } from "@/lib/active-mesh";
import { useStudio } from "@/lib/studio-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [open, setOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const name = useStudio((s) => s.name);
  const axis = useStudio((s) => s.axis);
  const imported = useStudio((s) => s.imported);
  const importProgress = useStudio((s) => s.importProgress);
  const importedScale = imported?.scale ?? 1;
  const width = useStudio((s) => s.width);
  const height = useStudio((s) => s.height);
  const depth = useStudio((s) => s.depth);
  const segments = useStudio((s) => s.segments);
  const bevel = useStudio((s) => s.bevel);
  const pivot = useStudio((s) => s.pivot);
  const originX = useStudio((s) => s.originX ?? 0);
  const originY = useStudio((s) => s.originY ?? 0);
  const originZ = useStudio((s) => s.originZ ?? 0);

  const sizeText = useMemo(() => {
    const b = boundsActive({
      params: { width, height, depth, segments, bevel, flatShading: true, faceColors: false, pivot },
      imported,
    });
    return `${Math.round(b.size[0])}\u00d7${Math.round(b.size[1])}\u00d7${Math.round(b.size[2])} cm`;
  }, [width, height, depth, segments, bevel, pivot, imported, importedScale]);

  async function onDropFiles(files: File[] | FileList | null) {
    setDropping(false);
    if (!files || (files as FileList).length === 0) return;
    if (useStudio.getState().importProgress) return;
    try {
      const result = await applyObjFiles(files);
      const scaleNote = result.scale === 100 ? " \u00b7 scaled \u00d7100 (meters \u2192 cm)" : "";
      const matNote =
        result.materials.length > 0
          ? ` \u00b7 ${result.materials.length} mat${result.materials.length === 1 ? "" : "s"}`
          : "";
      const mapNote =
        result.mapsLoaded > 0 ? ` \u00b7 ${result.mapsLoaded} map${result.mapsLoaded === 1 ? "" : "s"}` : "";
      toast.success(
        result.kind === "fbx"
          ? "FBX imported"
          : result.kind === "lwo"
            ? "LWO imported"
            : result.kind === "glb"
              ? "GLB imported"
              : "OBJ imported",
        {
          description: `${result.name} \u00b7 ${result.stats.unique} verts \u00b7 ${result.stats.faces} faces${scaleNote}${matNote}${mapNote}`,
        },
      );
      if (result.missingMtl) {
        toast.message("Materials not loaded", {
          description: "Drop the .mtl and textures with the OBJ.",
        });
      }
    } catch (err) {
        toast.error("Could not import mesh", {
          description: err instanceof Error ? err.message : "Try OBJ, FBX, GLB, or LWO",
        });
    }
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-bg text-fg">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-2.5 md:h-16 md:gap-3 md:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-surface-2 shadow-[var(--shadow-border)]">
            <Box className="size-4 text-accent" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight md:text-base">
              PolyExport
            </h1>
            <p className="hidden text-2xs text-muted md:block">
              Import OBJ \u00b7 FBX \u00b7 LWO
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ImportObjButton className="hidden md:inline-flex" />
          <DownloadFbxLink
            size="icon"
            iconOnly
            preferPicker
            className="md:hidden"
            data-testid="header-export-fbx-mobile"
          />
          <DownloadFbxLink
            size="sm"
            preferPicker
            label="Explorer"
            className="hidden md:inline-flex"
            data-testid="header-export-fbx"
          />
          <Button
            size="icon"
            variant="secondary"
            className="desk:hidden"
            aria-label={open ? "Close controls" : "Open controls"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-4" /> : <SlidersHorizontal className="size-4" />}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <section
          className="relative z-0 min-h-0 min-w-0 flex-1 bg-bg max-desk:absolute max-desk:inset-0"
          onDragEnter={(e) => {
            e.preventDefault();
            if ([...e.dataTransfer.items].some((i) => i.kind === "file")) setDropping(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDropping(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            void filesFromDataTransfer(e.dataTransfer).then((files) => onDropFiles(files));
          }}
        >
          <ClientCanvas />
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-bg/70 px-2.5 py-1.5 font-mono text-2xs tabular-nums text-muted md:left-4 md:top-4">
            {name}.fbx \u00b7 {sizeText}
            {imported
              ? ` \u00b7 OBJ \u00d7${imported.scale}${bevel > 0 ? ` \u00b7 bevel ${Math.round(bevel * 100)}%` : ""}`
              : ` \u00b7 seg ${segments}${bevel > 0 ? ` \u00b7 bevel ${Math.round(bevel * 100)}%` : ""}`}{" "}
            \u00b7 {axis}
            {originX || originY || originZ
              ? ` \u00b7 origin ${Math.round(originX)},${Math.round(originY)},${Math.round(originZ)}`
              : pivot === "bottom"
                ? " \u00b7 floor"
                : ""}
          </div>
          {importProgress ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg/70">
              <div className="w-[min(100%-2rem,22rem)] rounded-md bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
                <p className="text-sm text-fg">{importProgress.phase}</p>
                <p className="mt-1 truncate font-mono text-2xs text-muted">
                  {importProgress.name}
                </p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-accent transition-[width] duration-[var(--motion-quick)] ease-[var(--ease-out)]"
                    style={{ width: `${Math.max(2, Math.round(importProgress.ratio * 100))}%` }}
                  />
                </div>
                <p className="mt-2 font-mono text-2xs tabular-nums text-muted">
                  {Math.round(importProgress.ratio * 100)}%
                </p>
              </div>
            </div>
          ) : null}
          {dropping ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg/70">
              <p className="rounded-md bg-surface px-4 py-3 text-sm text-fg shadow-[var(--shadow-border)]">
                Drop OBJ, FBX, GLB, or LWO
              </p>
            </div>
          ) : null}
        </section>

        <button
          type="button"
          className={cn(
            "z-40 flex h-16 w-7 items-center justify-center rounded-l-md bg-surface text-muted shadow-[var(--shadow-border)] desk:hidden",
            open
              ? "fixed right-[min(20rem,88vw)] top-1/2 -translate-y-1/2"
              : "absolute right-0 top-1/2 -translate-y-1/2",
          )}
          aria-label={open ? "Hide controls" : "Open controls"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>

        <aside
          className={cn(
            "z-30 flex flex-col bg-surface shadow-[var(--shadow-panel)] transition-transform duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]",
            "max-desk:fixed max-desk:inset-y-0 max-desk:right-0 max-desk:w-[min(20rem,88vw)] max-desk:border-l max-desk:border-border",
            "desk:relative desk:h-full desk:w-80 desk:shrink-0 desk:border-l desk:border-border desk:shadow-none",
            open ? "max-desk:translate-x-0 max-desk:pointer-events-auto" : "max-desk:translate-x-full max-desk:pointer-events-none",
          )}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3 desk:hidden">
            <span className="text-xs font-medium uppercase tracking-widest text-faint">
              Controls
            </span>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-md text-muted"
              aria-label="Close controls"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <StudioPanel />
          </div>
        </aside>
      </div>
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          className: "bg-surface-2 text-fg border-border font-sans",
        }}
      />
    </main>
  );
}
