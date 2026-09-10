export type SaveResult = {
  method: "share" | "anchor" | "picker" | "aborted";
  url: string;
  filename: string;
  revoke: () => void;
};

function isMobileUa(ua: string) {
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};

export function canUseSavePicker() {
  if (typeof (window as PickerWindow).showSaveFilePicker !== "function") return false;
  if (!window.isSecureContext) return false;
  if (typeof navigator !== "undefined" && "webdriver" in navigator && navigator.webdriver) {
    return false;
  }
  try {
    if (window.self !== window.top) return false;
  } catch {
    return false;
  }
  return true;
}

export async function pickSaveFile(filename: string, mime = "application/octet-stream") {
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (typeof picker !== "function") return null;
  const ext = `.${filename.split(".").pop() || "fbx"}`;
  try {
    return await picker({
      suggestedName: filename,
      types: [
        {
          description: "FBX",
          accept: {
            [mime]: [ext],
            "model/fbx": [ext],
          },
        },
      ],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    try {
      return await picker({ suggestedName: filename });
    } catch (retry) {
      if (retry instanceof DOMException && retry.name === "AbortError") throw retry;
      return null;
    }
  }
}

export async function writeFileHandle(handle: FileSystemFileHandle, data: BlobPart, mime: string) {
  const writable = await handle.createWritable();
  await writable.write(new Blob([data], { type: mime }));
  await writable.close();
}

export function downloadAnchor(filename: string, data: BlobPart, mime = "application/octet-stream") {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.setAttribute("data-testid", "fbx-download-anchor");
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
  return url;
}

/**
 * Prefer a real save dialog or the Android share sheet.
 * Return "anchor" to let a native `<a download>` proceed on the same click.
 */
export async function saveFromUserGesture(
  filename: string,
  data: BlobPart,
  mime = "application/octet-stream",
): Promise<"handled" | "aborted" | "anchor"> {
  const blob = new Blob([data], { type: mime });
  if (canUseSavePicker()) {
    try {
      const handle = await pickSaveFile(filename, mime);
      if (handle) {
        await writeFileHandle(handle, data, mime);
        return "handled";
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "aborted";
    }
  }

  const mobile =
    typeof navigator !== "undefined" && isMobileUa(navigator.userAgent);
  if (mobile && typeof navigator.canShare === "function") {
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return "handled";
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "aborted";
    }
  }

  return "anchor";
}

function revokeLater(url: string, ms = 20_000) {
  const id = window.setTimeout(() => URL.revokeObjectURL(url), ms);
  return () => {
    window.clearTimeout(id);
    URL.revokeObjectURL(url);
  };
}

export async function saveBlob(
  filename: string,
  data: BlobPart,
  mime = "application/octet-stream",
): Promise<SaveResult> {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const revoke = revokeLater(url);
  const gesture = await saveFromUserGesture(filename, data, mime);
  if (gesture === "handled") {
    revoke();
    return { method: "picker", url: "", filename, revoke: () => {} };
  }
  if (gesture === "aborted") {
    revoke();
    return { method: "aborted", url: "", filename, revoke: () => {} };
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { method: "anchor", url, filename, revoke };
}
