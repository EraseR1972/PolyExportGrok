import { useEffect, useState, type ComponentType } from "react";

export function ClientCanvas() {
  const [View, setView] = useState<ComponentType | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("./viewport").then((mod) => {
      if (!cancelled) setView(() => mod.StudioViewport);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!View) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-bg"
        aria-label="Loading studio"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 rotate-45 rounded-sm bg-surface-2 shadow-[var(--shadow-border)]" />
          <p className="text-xs uppercase tracking-[0.18em] text-muted">
            Loading viewport
          </p>
        </div>
      </div>
    );
  }

  return <View />;
}
