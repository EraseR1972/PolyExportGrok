export function SaveFileHint({ href, filename }: { href: string; filename: string }) {
  return (
    <a
      href={href}
      download={filename}
      className="mt-1 flex min-h-11 items-center text-sm text-accent underline underline-offset-2"
    >
      Tap here if the file did not save
    </a>
  );
}
