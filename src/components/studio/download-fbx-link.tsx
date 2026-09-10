import { useState } from "react";
import { Download, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  canUseSavePicker,
  downloadAnchor,
  pickSaveFile,
  writeFileHandle,
} from "@/lib/download-file";
import { buildFbxAscii, sanitizeFileStem } from "@/lib/prepare-fbx";
import { useStudio } from "@/lib/studio-store";
import { cn } from "@/lib/utils";

export function DownloadFbxLink({
  size = "lg",
  className,
  label = "Download FBX",
  iconOnly = false,
  preferPicker = false,
  "data-testid": testId = "export-fbx",
}: {
  size?: ButtonProps["size"];
  className?: string;
  label?: string;
  iconOnly?: boolean;
  preferPicker?: boolean;
  "data-testid"?: string;
}) {
  const [busy, setBusy] = useState(false);
  const Icon = preferPicker ? FolderOpen : Download;

  async function onClick() {
    if (busy) return;
    setBusy(true);
    const filename = `${sanitizeFileStem(useStudio.getState().name || "mesh")}.fbx`;
    let handle: FileSystemFileHandle | null = null;
    try {
      if (preferPicker && canUseSavePicker()) {
        try {
          handle = await pickSaveFile(filename);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }

      toast.message("Building FBX\u2026");
      const pack = buildFbxAscii();
      const mime = "application/octet-stream";

      if (handle) {
        await writeFileHandle(handle, pack.ascii, mime);
        toast.success("FBX saved", { description: pack.filename });
        useStudio.getState().rememberConversion();
        return;
      }

      downloadAnchor(pack.filename, pack.ascii, mime);
      toast.success("FBX downloaded", {
        description: preferPicker
          ? "This browser has no Explorer save dialog \u2014 file went to Downloads."
          : pack.filename,
      });
      useStudio.getState().rememberConversion();
    } catch (err) {
      toast.error("Export failed", {
        description: err instanceof Error ? err.message : "Try Explorer / Save as",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size={size}
      className={cn(className)}
      data-testid={testId}
      aria-label={preferPicker ? "Save FBX with Explorer" : "Download FBX"}
      disabled={busy}
      onClick={() => void onClick()}
    >
      <Icon className="size-4" />
      {iconOnly ? null : busy ? "Saving\u2026" : label}
    </Button>
  );
}
