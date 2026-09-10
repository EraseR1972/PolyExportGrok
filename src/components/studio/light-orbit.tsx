import { useCallback, useRef } from "react";
import { useStudio } from "@/lib/studio-store";

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

function setFromPointer(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const x = clientX - cx;
  const y = clientY - cy;
  const max = Math.max(8, r.width / 2 - 8);
  const dist = Math.min(1, Math.hypot(x, y) / max);
  const az = (Math.atan2(x, -y) * 180) / Math.PI;
  const lightAz = (az + 360) % 360;
  const lightEl = clamp(90 * (1 - dist), 0, 89);
  useStudio.getState().set({ lightAz, lightEl });
}

export function LightOrbitPad() {
  const az = useStudio((s) => s.lightAz);
  const elv = useStudio((s) => s.lightEl);
  const lightColor = useStudio((s) => s.lightColor);
  const pad = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  const onPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const node = pad.current;
    if (!node) return;
    setFromPointer(node, e.clientX, e.clientY);
  }, []);

  const t = 1 - elv / 90;
  const rad = (az * Math.PI) / 180;
  const hx = 50 + Math.sin(rad) * t * 42;
  const hy = 50 - Math.cos(rad) * t * 42;

  return (
    <div className="space-y-2">
      <div
        ref={pad}
        role="slider"
        aria-label="Light orbit"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(az)}
        tabIndex={0}
        className="relative mx-auto aspect-square w-[min(100%,11.5rem)] cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          drag.current = true;
          onPointer(e);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* synthetic events */
          }
        }}
        onPointerMove={(e) => {
          if (!drag.current && e.buttons === 0) return;
          onPointer(e);
        }}
        onPointerUp={() => {
          drag.current = false;
        }}
        onPointerCancel={() => {
          drag.current = false;
        }}
      >
        <svg viewBox="0 0 100 100" className="pointer-events-none size-full overflow-visible">
          <defs>
            <radialGradient id="light-dome" cx="38%" cy="32%" r="70%">
              <stop offset="0%" stopColor="#3a3c42" />
              <stop offset="55%" stopColor="#1c1d21" />
              <stop offset="100%" stopColor="#121316" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="48" fill="url(#light-dome)" stroke="#2a2b2f" strokeWidth="1.2" />
          <circle cx="50" cy="50" r="32" fill="none" stroke="#2a2b2f" strokeWidth="0.6" />
          <circle cx="50" cy="50" r="16" fill="none" stroke="#2a2b2f" strokeWidth="0.6" />
          <line x1="50" y1="4" x2="50" y2="96" stroke="#2a2b2f" strokeWidth="0.5" />
          <line x1="4" y1="50" x2="96" y2="50" stroke="#2a2b2f" strokeWidth="0.5" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * 30 * Math.PI) / 180;
            const x1 = 50 + Math.sin(a) * 45;
            const y1 = 50 - Math.cos(a) * 45;
            const x2 = 50 + Math.sin(a) * 48;
            const y2 = 50 - Math.cos(a) * 48;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={i % 3 === 0 ? "#8c8b86" : "#5c5b57"}
                strokeWidth={i % 3 === 0 ? 1 : 0.6}
              />
            );
          })}
          <text x="50" y="10" textAnchor="middle" fill="#8c8b86" fontSize="5" fontFamily="IBM Plex Mono, monospace">
            0\u00b0
          </text>
          <text x="91" y="52" textAnchor="middle" fill="#8c8b86" fontSize="5" fontFamily="IBM Plex Mono, monospace">
            90\u00b0
          </text>
          <text x="50" y="97" textAnchor="middle" fill="#8c8b86" fontSize="5" fontFamily="IBM Plex Mono, monospace">
            180\u00b0
          </text>
          <text x="9" y="52" textAnchor="middle" fill="#8c8b86" fontSize="5" fontFamily="IBM Plex Mono, monospace">
            270\u00b0
          </text>
          <circle cx="50" cy="50" r="1.6" fill="#ecebe6" />
          <line
            x1="50"
            y1="50"
            x2={hx}
            y2={hy}
            stroke="#d8ddd4"
            strokeWidth="0.8"
            strokeDasharray="1.4 1.4"
            opacity="0.55"
          />
          <circle cx={hx} cy={hy} r="5.2" fill={lightColor} stroke="#ecebe6" strokeWidth="1.1" />
        </svg>
      </div>
      <p className="text-center font-mono text-2xs tabular-nums text-muted">
        {Math.round(az)}\u00b0 \u00b7 el {Math.round(elv)}\u00b0
      </p>
    </div>
  );
}
