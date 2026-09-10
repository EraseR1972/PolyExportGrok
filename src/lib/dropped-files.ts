export async function filesFromDataTransfer(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return [];
  const items = [...dt.items];
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));
  if (entries.length > 0) {
    const files: File[] = [];
    await Promise.all(entries.map((entry) => walkEntry(entry, files)));
    if (files.length > 0) return files;
  }
  return [...dt.files];
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    out.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    await Promise.all(batch.map((child) => walkEntry(child, out)));
  }
}
