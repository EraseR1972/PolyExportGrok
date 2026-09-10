import { useEffect, useMemo, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { DownloadFbxLink } from "@/components/studio/download-fbx-link";
import { ImportObjButton } from "@/components/studio/import-obj-button";
import { LightOrbitPad } from "@/components/studio/light-orbit";
import { SaveFileHint } from "@/components/studio/save-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { boundsActive, measureActive, BEVEL_FACE_CAP } from "@/lib/active-mesh";
import { boundsOfPoly } from "@/lib/cube";
import { exportGlb, exportObj } from "@/lib/export-mesh";
import { cubeParamsFrom, PRESETS, useStudio, type ShadowMode } from "@/lib/studio-store";
import { cn } from "@/lib/utils";

function rgbHex(rgb: [number, number, number]) {
  const c = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

function hexRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function toByte(n: number) {
  return Math.round(Math.min(1, Math.max(0, n)) * 255);
}

function ChannelSlider({
  label,
  value,
  max = 255,
  onChange,
}: {
  label: string;
  value: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3.5 font-mono text-2xs text-muted">{label}</span>
      <Slider
        min={0}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v ?? 0)}
        className="flex-1"
      />
      <span className="w-7 text-right font-mono text-2xs tabular-nums text-fg">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label>{label}</Label>
        {value ? (
          <span className="font-mono text-xs tabular-nums text-fg">{value}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-2xs font-medium uppercase tracking-widest text-faint">{title}</h2>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <label className="flex h-9 md:h-11 cursor-pointer items-center justify-between gap-3 rounded-md bg-surface-2 px-3 shadow-[var(--shadow-border)]">
      <span className="text-sm text-fg">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

const inputClass =
  "h-9 md:h-11 w-full min-w-0 rounded-md bg-surface-2 px-3 font-mono text-sm text-fg shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70";

function formatFactor(n: number) {
  if (!Number.isFinite(n)) return "1";
  if (Math.abs(n - 1) < 1e-9) return "1";
  const s = n.toPrecision(5);
  return s.replace(/\.?0+$/, "");
}

function formatSize(cm: number, unit: "cm" | "m") {
  const v = unit === "m" ? cm / 100 : cm;
  return formatFactor(v);
}

function ImportScale() {
  const imported = useStudio((s) => s.imported);
  const [unit, setUnit] = useState<"cm" | "m">("cm");
  const [factorDraft, setFactorDraft] = useState<string | null>(null);
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);
  if (!imported) return null;
  const b = boundsOfPoly(imported.poly);
  const longest = Math.max(b.size[0], b.size[1], b.size[2], 1e-6);
  const sizeShown = longest * imported.scale;

  function commitScale(n: number) {
    if (!Number.isFinite(n) || n <= 0) {
      setFactorDraft(null);
      return;
    }
    useStudio.getState().setImported({ ...imported!, scale: n });
    setFactorDraft(null);
  }

  function commitSize(raw: string) {
    const n = Number.parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setSizeDraft(null);
      return;
    }
    const cm = unit === "m" ? n * 100 : n;
    useStudio.getState().setImported({ ...imported!, scale: cm / longest });
    setSizeDraft(null);
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1">
        <span className="text-2xs font-medium uppercase tracking-widest text-faint">Factor</span>
        <input
          inputMode="decimal"
          aria-label="Scale factor"
          value={factorDraft ?? formatFactor(imported.scale)}
          onFocus={() => setFactorDraft(formatFactor(imported.scale))}
          onChange={(e) => setFactorDraft(e.target.value)}
          onBlur={() => {
            if (factorDraft != null) commitScale(Number.parseFloat(factorDraft.replace(",", ".")));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={inputClass}
        />
      </label>
      <label className="space-y-1">
        <span className="text-2xs font-medium uppercase tracking-widest text-faint">Size</span>
        <input
          inputMode="decimal"
          aria-label="Target size"
          value={sizeDraft ?? formatSize(sizeShown, unit)}
          onFocus={() => setSizeDraft(formatSize(sizeShown, unit))}
          onChange={(e) => setSizeDraft(e.target.value)}
          onBlur={() => {
            if (sizeDraft != null) commitSize(sizeDraft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={inputClass}
        />
      </label>
      <div className="col-span-2 flex gap-2">
        {(["cm", "m"] as const).map((u) => (
          <Button
            key={u}
            type="button"
            size="sm"
            variant={unit === u ? "default" : "secondary"}
            className="flex-1"
            onClick={() => setUnit(u)}
          >
            {u}
          </Button>
        ))}
      </div>
      <div className="col-span-2">
        <Slider
          min={0.01}
          max={Math.max(4, imported.scale * 2)}
          step={0.01}
          value={[imported.scale]}
          onValueChange={([v]) => {
            if (v && v > 0) useStudio.getState().setImported({ ...imported, scale: v });
          }}
        />
      </div>
    </div>
  );
}

function ColorEditor({
  rgb,
  alpha,
  onRgb,
  onAlpha,
}: {
  rgb: [number, number, number];
  alpha: number;
  onRgb: (next: [number, number, number]) => void;
  onAlpha: (a: number) => void;
}) {
  return (
    <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
      <ChannelSlider label="R" value={toByte(rgb[0])} onChange={(v) => onRgb([v / 255, rgb[1], rgb[2]])} />
      <ChannelSlider label="G" value={toByte(rgb[1])} onChange={(v) => onRgb([rgb[0], v / 255, rgb[2]])} />
      <ChannelSlider label="B" value={toByte(rgb[2])} onChange={(v) => onRgb([rgb[0], rgb[1], v / 255])} />
      <ChannelSlider label="A" value={Math.round(alpha * 100)} max={100} onChange={(v) => onAlpha(v / 100)} />
    </div>
  );
}

export function StudioPanel() {
  const state = useStudio();
  const [busy, setBusy] = useState<string | null>(null);
  const [openMat, setOpenMat] = useState<string | null>(null);
  const imported = state.imported;
  const params = cubeParamsFrom(state);

  useEffect(() => {
    state.hydrateRecents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOpenMat(null);
  }, [imported?.fileName]);

  const stats = useMemo(
    () => measureActive({ params, imported }),
    [
      params.width,
      params.height,
      params.depth,
      params.segments,
      params.bevel,
      params.pivot,
      imported,
      imported?.scale,
    ],
  );

  const sizeLabel = useMemo(() => {
    const b = boundsActive({ params, imported });
    return `${Math.round(b.size[0])}×${Math.round(b.size[1])}×${Math.round(b.size[2])} cm`;
  }, [
    params.width,
    params.height,
    params.depth,
    params.pivot,
    params.bevel,
    imported,
    imported?.scale,
  ]);

  async function onExport(kind: "obj" | "glb") {
    setBusy(kind);
    try {
      const payload = {
        params,
        imported,
        name: state.name,
        color: state.color,
        roughness: state.roughness,
        metalness: state.metalness,
        opacity: state.opacity,
        axis: state.axis,
      };
      if (kind === "obj") {
        const result = await exportObj(payload);
        if (result.method === "aborted") return;
        toast.success(result.method === "share" ? "Share sheet opened" : "OBJ downloaded", {
          description: result.url ? (
            <SaveFileHint href={result.url} filename={`${state.name}.obj`} />
          ) : undefined,
          duration: result.url ? 10_000 : 4000,
        });
      } else {
        const result = await exportGlb(payload);
        if (!result || result.method === "aborted") return;
        toast.success(result.method === "share" ? "Share sheet opened" : "GLB downloaded", {
          description: result.url ? (
            <SaveFileHint href={result.url} filename={`${state.name}.glb`} />
          ) : undefined,
          duration: result.url ? 10_000 : 4000,
        });
      }
    } catch (err) {
      toast.error("Export failed", {
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setBusy(null);
    }
  }

  function setSize(axis: "width" | "height" | "depth", raw: string) {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    state.setSize(axis, n);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 py-4 md:px-4">
        <Section title="File">
          {imported ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-fg">{imported.fileName}</p>
                  <p className="text-pretty text-xs text-muted">
                    {stats.unique} verts · {stats.faces} faces
                    {imported.materials && imported.materials.length > 0
                      ? ` · ${imported.materials.length} materials in the viewport.`
                      : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    state.setImported(null);
                    setOpenMat(null);
                  }}
                >
                  Clear
                </Button>
              </div>
              <ImportScale />
            </div>
          ) : (
            <p className="text-pretty text-xs text-muted">
              Open an OBJ, FBX, GLB/glTF, or LightWave LWO. Drop .mtl and textures with
              the OBJ. Files over 200 MB stream in — keep the tab open.
            </p>
          )}
          <ImportObjButton className="w-full" size="lg" variant="secondary" />
          <Button
            type="button"
            className="w-full"
            size="lg"
            variant="secondary"
            onClick={() => state.generateFighter()}
          >
            Angular fighter
          </Button>
          {state.recents.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-2xs font-medium uppercase tracking-widest text-faint">Presets</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => state.applyPreset(p.id)}
                  >
                    {p.label}
                  </Button>
                ))}
                {state.recents.map((row) => (
                  <Button
                    key={row.id}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => state.applyRecent(row.id)}
                  >
                    {row.name}
                  </Button>
                ))}
              </div>
              <p className="text-pretty text-xs text-muted">
                Cube presets plus the last 5 converted objects.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => state.applyPreset(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Mesh">
          <Field label="Name">
            <input
              value={state.name}
              onChange={(e) => state.set({ name: e.target.value })}
              className={inputClass}
              spellCheck={false}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            {(["width", "height", "depth"] as const).map((axis) => (
              <label key={axis} className="space-y-1">
                <span className="text-2xs font-medium uppercase tracking-widest text-faint">
                  {axis[0]}
                </span>
                <input
                  inputMode="decimal"
                  aria-label={axis}
                  value={state[axis]}
                  onChange={(e) => setSize(axis, e.target.value)}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="flex h-9 items-center gap-2 text-sm text-muted"
            onClick={() => state.set({ linked: !state.linked })}
          >
            {state.linked ? <Link2 className="size-4" /> : <Link2Off className="size-4" />}
            {state.linked ? "Sizes linked" : "Sizes unlinked"}
          </button>
          <p className="font-mono text-xs tabular-nums text-muted">{sizeLabel}</p>
          <Field label="Axis">
            <div className="grid grid-cols-2 gap-2">
              {(["y-up", "z-up"] as const).map((axis) => (
                <Button
                  key={axis}
                  type="button"
                  size="sm"
                  variant={state.axis === axis ? "default" : "secondary"}
                  onClick={() => state.set({ axis })}
                >
                  {axis === "z-up" ? "Z-up UE" : "Y-up"}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Pivot">
            <div className="grid grid-cols-2 gap-2">
              {(["center", "bottom"] as const).map((pivot) => (
                <Button
                  key={pivot}
                  type="button"
                  size="sm"
                  variant={state.pivot === pivot ? "default" : "secondary"}
                  onClick={() => state.set({ pivot, originX: 0, originY: 0, originZ: 0 })}
                >
                  {pivot}
                </Button>
              ))}
            </div>
          </Field>
        </Section>

        <Section title="Modifiers">
          <ToggleRow
            label="Hard surface"
            checked={state.showEdges}
            onCheckedChange={(v) => state.set({ showEdges: v })}
          />
          <ToggleRow
            label="Flat shaders"
            checked={state.flatShading}
            onCheckedChange={(v) => state.set({ flatShading: v })}
          />
          <Field label="Bevel" value={state.bevel.toFixed(2)}>
            <Slider
              min={0}
              max={0.4}
              step={0.01}
              value={[state.bevel]}
              onValueChange={([v]) => state.set({ bevel: v ?? 0 })}
              disabled={Boolean(imported && imported.poly.faces.length > BEVEL_FACE_CAP)}
            />
          </Field>
          {imported ? (
            <Button
              type="button"
              className="w-full"
              size="sm"
              variant="secondary"
              onClick={() => state.flipFaces()}
            >
              Flip faces
            </Button>
          ) : null}
          <ToggleRow
            label="Wireframe"
            checked={state.wireframe}
            onCheckedChange={(v) => state.set({ wireframe: v, includeFaces: v ? true : state.includeFaces })}
          />
          {state.wireframe ? (
            <>
              <ToggleRow
                label="Include faces"
                checked={state.includeFaces}
                onCheckedChange={(v) => state.set({ includeFaces: v })}
              />
              <Field label="Line width" value={state.wireframeWidth.toFixed(2)}>
                <Slider
                  min={0.01}
                  max={8}
                  step={0.01}
                  value={[state.wireframeWidth]}
                  onValueChange={([v]) => state.set({ wireframeWidth: v ?? 1 })}
                />
              </Field>
              <Field label="Line color">
                <input
                  type="color"
                  aria-label="Wireframe color"
                  value={state.wireframeColor}
                  onChange={(e) => state.set({ wireframeColor: e.target.value })}
                  className="size-9 cursor-pointer rounded-md bg-transparent p-1 shadow-[var(--shadow-border)]"
                />
              </Field>
            </>
          ) : null}
          <ToggleRow
            label="Check normals"
            checked={state.checkNormals}
            onCheckedChange={(v) => state.set({ checkNormals: v, checkUvs: v ? false : state.checkUvs })}
          />
          <ToggleRow
            label="Check UVs"
            checked={state.checkUvs}
            onCheckedChange={(v) => state.set({ checkUvs: v, checkNormals: v ? false : state.checkNormals })}
          />
          {state.checkNormals ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={state.normalVis === "facing" ? "default" : "secondary"}
                  onClick={() => state.set({ normalVis: "facing" })}
                >
                  Facing
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={state.normalVis === "rgb" ? "default" : "secondary"}
                  onClick={() => state.set({ normalVis: "rgb" })}
                >
                  RGB
                </Button>
              </div>
              {state.normalVis === "facing" ? (
                <div className="space-y-1 text-xs text-muted">
                  <div className="flex flex-wrap gap-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-3 rounded-sm shadow-[var(--shadow-border)]"
                        style={{ backgroundColor: "#4d8dff" }}
                        aria-hidden
                      />
                      Outward (good)
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-3 rounded-sm shadow-[var(--shadow-border)]"
                        style={{ backgroundColor: "#e24b4b" }}
                        aria-hidden
                      />
                      Inverted (normal away)
                    </span>
                  </div>
                  <p className="text-pretty text-xs text-muted">
                    Yellow ticks are the stored face normals, like LightWave Show Normals.
                  </p>
                </div>
              ) : (
                <p className="text-pretty text-xs text-muted">
                  View-space normals as color: X red, Y green, Z cyan. Same look as
                  ZBrush / Nomad Normal matcap.
                </p>
              )}
            </div>
          ) : null}
        </Section>

        <Section title="Material">
          {imported?.materials && imported.materials.length > 0 ? (
            <div className="space-y-2" data-testid="obj-materials">
              {imported.materials.map((m, i) => {
                const hex = rgbHex(m.color);
                const id = `${i}:${m.name}`;
                const open = openMat === id;
                return (
                  <div
                    key={id}
                    className="rounded-md bg-surface-2 px-3 py-2 shadow-[var(--shadow-border)]"
                  >
                    <div className="flex h-8 items-center gap-3">
                      <button
                        type="button"
                        title={open ? "Hide RGB / alpha" : "Edit RGB / alpha"}
                        aria-expanded={open}
                        aria-label={`${m.name} color`}
                        onClick={() => setOpenMat(open ? null : id)}
                        className="size-6 shrink-0 rounded-sm shadow-[var(--shadow-border)]"
                        style={{ backgroundColor: hex, opacity: m.opacity }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm text-fg">{m.name}</p>
                        {m.mapName ? (
                          <p className="truncate text-2xs text-muted">{m.mapName}</p>
                        ) : null}
                      </div>
                      <span className="hidden font-mono text-2xs uppercase text-faint sm:inline">
                        {hex}
                      </span>
                    </div>
                    {open ? (
                      <ColorEditor
                        rgb={m.color}
                        alpha={m.opacity}
                        onRgb={(next) => state.patchMaterial(m.name, { color: next })}
                        onAlpha={(a) => state.patchMaterial(m.name, { opacity: a })}
                      />
                    ) : null}
                  </div>
                );
              })}
              <p className="text-pretty text-xs text-muted">
                Tap the color square to edit RGB and alpha.
              </p>
            </div>
          ) : (
            <>
              <Field label="Color">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    title={openMat === "__mesh" ? "Hide color" : "Edit color"}
                    aria-expanded={openMat === "__mesh"}
                    aria-label="Mesh color"
                    onClick={() => setOpenMat(openMat === "__mesh" ? null : "__mesh")}
                    className="size-11 shrink-0 rounded-md shadow-[var(--shadow-border)]"
                    style={{ backgroundColor: state.color, opacity: state.opacity }}
                  />
                  <input
                    value={state.color}
                    onChange={(e) => state.set({ color: e.target.value })}
                    className={cn(inputClass, "uppercase")}
                    spellCheck={false}
                  />
                </div>
              </Field>
              {openMat === "__mesh" ? (
                <ColorEditor
                  rgb={hexRgb(state.color) ?? [0.77, 0.75, 0.71]}
                  alpha={state.opacity}
                  onRgb={(next) => state.set({ color: rgbHex(next) })}
                  onAlpha={(a) => state.set({ opacity: a })}
                />
              ) : null}
              <Field label="Roughness" value={state.roughness.toFixed(2)}>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={[state.roughness]}
                  onValueChange={([v]) => state.set({ roughness: v ?? 0.7 })}
                />
              </Field>
              <Field label="Metalness" value={state.metalness.toFixed(2)}>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={[state.metalness]}
                  onValueChange={([v]) => state.set({ metalness: v ?? 0 })}
                />
              </Field>
            </>
          )}
        </Section>

        <Section title="Viewport">
          <ToggleRow
            label="Auto rotate"
            checked={state.autoRotate}
            onCheckedChange={(v) => state.set({ autoRotate: v })}
          />
          <ToggleRow
            label="Grid"
            checked={state.showGrid}
            onCheckedChange={(v) => state.set({ showGrid: v })}
          />
          <ToggleRow
            label="World axes"
            checked={state.showAxes}
            onCheckedChange={(v) => state.set({ showAxes: v })}
          />
          <ToggleRow
            label="Pivot"
            checked={state.showPivot}
            onCheckedChange={(v) =>
              state.set({ showPivot: v, snapMode: v ? state.snapMode : "off" })
            }
          />
          {state.showPivot ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => state.set({ originX: 0, originY: 0, originZ: 0, snapMode: "off" })}
              >
                Snap center
              </Button>
              <Button
                type="button"
                size="sm"
                variant={state.snapMode === "point" ? "default" : "secondary"}
                onClick={() => state.set({ snapMode: state.snapMode === "point" ? "off" : "point" })}
              >
                Snap point
              </Button>
            </div>
          ) : null}
          <Field label="Light" value={`${Math.round(state.lightAz)}°`}>
            <LightOrbitPad />
          </Field>
          <Field label="Light color">
            <div className="flex items-center gap-3">
              <input
                type="color"
                aria-label="Light color"
                value={state.lightColor}
                onChange={(e) => state.set({ lightColor: e.target.value })}
                className="size-9 cursor-pointer rounded-md bg-transparent p-1 shadow-[var(--shadow-border)] md:size-11"
              />
              <input
                value={state.lightColor}
                onChange={(e) => state.set({ lightColor: e.target.value })}
                className={cn(inputClass, "uppercase")}
                spellCheck={false}
              />
            </div>
          </Field>
          <Field label="Intensity" value={state.lightIntensity.toFixed(2)}>
            <div className="flex items-center gap-2">
              <Slider
                min={0}
                max={10}
                step={0.01}
                value={[Math.min(10, state.lightIntensity)]}
                onValueChange={([v]) => state.set({ lightIntensity: v ?? 1.35 })}
                className="flex-1"
              />
              <input
                type="number"
                aria-label="Light intensity"
                min={0}
                max={20}
                step={0.01}
                value={state.lightIntensity}
                onChange={(e) => {
                  const n = Number.parseFloat(e.target.value);
                  if (Number.isFinite(n)) state.set({ lightIntensity: Math.max(0, n) });
                }}
                className="h-9 w-16 rounded-md bg-surface-2 px-2 font-mono text-sm text-fg shadow-[var(--shadow-border)]"
              />
            </div>
          </Field>
          <Field label="Shadow">
            <div className="grid grid-cols-2 gap-2">
              {(["cast", "off"] as ShadowMode[]).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={state.shadowMode === mode ? "default" : "secondary"}
                  onClick={() => state.set({ shadowMode: mode })}
                >
                  {mode === "cast" ? "Cast" : "Off"}
                </Button>
              ))}
            </div>
          </Field>
          {state.shadowMode !== "off" ? (
            <>
              <Field label="Shadow opacity" value={`${Math.round(state.shadowOpacity * 100)}%`}>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={[state.shadowOpacity]}
                  onValueChange={([v]) => state.set({ shadowOpacity: v ?? 0.42 })}
                />
              </Field>
              <Field label="Softness" value={state.shadowSoftness.toFixed(2)}>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={[state.shadowSoftness]}
                  onValueChange={([v]) => state.set({ shadowSoftness: v ?? 0.45 })}
                />
              </Field>
            </>
          ) : null}
        </Section>

        <Section title="Export">
          <ToggleRow
            label="Wireframe only FBX"
            checked={state.exportWireframe}
            onCheckedChange={(v) => state.set({ exportWireframe: v })}
          />
          <DownloadFbxLink className="w-full" />
          <DownloadFbxLink
            className="w-full"
            size="lg"
            preferPicker
            label="Explorer / Save as"
          />
          <Button
            type="button"
            className="w-full"
            size="lg"
            variant="secondary"
            disabled={busy === "obj"}
            onClick={() => void onExport("obj")}
          >
            {busy === "obj" ? "Exporting…" : "Export OBJ"}
          </Button>
          <Button
            type="button"
            className="w-full"
            size="lg"
            variant="secondary"
            disabled={busy === "glb"}
            onClick={() => void onExport("glb")}
          >
            {busy === "glb" ? "Exporting…" : "Export GLB"}
          </Button>
        </Section>
      </div>
    </div>
  );
}
