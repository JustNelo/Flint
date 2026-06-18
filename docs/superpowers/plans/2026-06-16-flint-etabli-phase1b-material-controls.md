# Flint — Établi Phase 1b: Material / Controls Inversion (Compresser pilot) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the Compresser tool into the real Établi 2-pane experience — a central **MaterialPanel** (toggle matériel/résultats, the file grid as the hero) and a right **ControlsPanel** (settings + an always-visible, sticky "Forger" action). Compresser becomes the reference; the other 15 tools keep their current single-column UI (dual-mode) until later phases.

**Architecture:** Two new presentational panels (`MaterialPanel`, `ControlsPanel`). `CompressTab` is rewired from a vertical stack into a 2-pane layout that feeds those panels (all of its existing `useFileSelection`/state/`handleCompress` logic is preserved; it gains a `panelMode` that flips to "results" after a successful forge). `App.tsx` renders Compresser full-width and every other tab in the existing centered 860 column. Chaining (`ChainBar`) and rollout to other tools are Phase 1c+.

**Tech Stack:** React 19, TypeScript, inline styles + CSS custom properties, Vite. No frontend test runner (`CLAUDE.md`) → verification = `bunx prettier --check` + `bun run build` + manual visual check via `bun run tauri dev`.

**Reference:** spec `docs/superpowers/specs/2026-06-16-flint-etabli-redesign-design.md` §4–5. Phases 0 (identity) and 1a (shell + rail) are already on this branch.

---

### Task 1: Create `MaterialPanel`

The central hero card: a `[ matériel | résultats ]` segmented toggle, then either the `material` slot (drop zone + grid) or the `results` slot. The "résultats" segment is disabled until results exist.

**Files:**
- Create: `src/components/MaterialPanel.tsx`
- Modify: `src/i18n/en.json`, `src/i18n/fr.json`

- [ ] **Step 1: Add i18n keys**

en.json:
```json
"etabli.material": "Material",
"etabli.results": "Results",
"etabli.settings": "Settings"
```
fr.json:
```json
"etabli.material": "Matériel",
"etabli.results": "Résultats",
"etabli.settings": "Réglages"
```

- [ ] **Step 2: Create `src/components/MaterialPanel.tsx`**

```tsx
import type { ReactNode } from "react";
import { useT } from "../i18n/i18n";

export type MaterialMode = "material" | "results";

interface MaterialPanelProps {
  mode: MaterialMode;
  onModeChange: (mode: MaterialMode) => void;
  hasResults: boolean;
  material: ReactNode;
  results: ReactNode;
}

function segStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 14px",
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "var(--font-sans)",
    border: "none",
    background: active ? "var(--bg-base)" : "transparent",
    color: active ? "var(--indigo-glow)" : "var(--text-secondary)",
    transition: "background 150ms ease, color 150ms ease",
  };
}

export function MaterialPanel({ mode, onModeChange, hasResults, material, results }: MaterialPanelProps) {
  const { t } = useT();

  return (
    <section
      className="flex-1 min-w-0 overflow-hidden"
      style={{ borderRadius: 12, border: "1px solid var(--bg-border)", background: "var(--bg-elevated)" }}
    >
      <div className="flex items-center p-3" style={{ borderBottom: "1px solid var(--bg-border)" }}>
        <div style={{ display: "inline-flex", background: "var(--bg-overlay)", borderRadius: 8, padding: 2 }}>
          <button onClick={() => onModeChange("material")} style={{ ...segStyle(mode === "material"), cursor: "pointer" }}>
            {t("etabli.material")}
          </button>
          <button
            onClick={() => hasResults && onModeChange("results")}
            disabled={!hasResults}
            style={{
              ...segStyle(mode === "results"),
              cursor: hasResults ? "pointer" : "not-allowed",
              opacity: hasResults ? 1 : 0.4,
            }}
          >
            {t("etabli.results")}
          </button>
        </div>
      </div>
      <div className="p-3">{mode === "material" ? material : results}</div>
    </section>
  );
}
```

- [ ] **Step 3: Format + build**

Run: `bunx prettier --check src/components/MaterialPanel.tsx src/i18n/en.json src/i18n/fr.json && bun run build`
Expected: prettier clean; `bun run build` exits 0 (component unused so far — fine).

- [ ] **Step 4: Commit**

```bash
git add src/components/MaterialPanel.tsx src/i18n/en.json src/i18n/fr.json
git commit -m "feat(etabli): MaterialPanel (matériel/résultats toggle)"
```

---

### Task 2: Create `ControlsPanel`

The right settings panel: a "réglages" label, the tool's controls (dimmed when empty), and the docked action at the bottom. Sticky to the top so the action stays visible while the material panel scrolls the page.

**Files:**
- Create: `src/components/ControlsPanel.tsx`

- [ ] **Step 1: Create `src/components/ControlsPanel.tsx`**

```tsx
import type { ReactNode } from "react";
import { useT } from "../i18n/i18n";

interface ControlsPanelProps {
  children: ReactNode;
  action: ReactNode;
  /** Dim + disable the controls (e.g. before any file is selected). */
  disabled?: boolean;
}

export function ControlsPanel({ children, action, disabled = false }: ControlsPanelProps) {
  const { t } = useT();

  return (
    <aside
      className="shrink-0"
      style={{
        width: 300,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        borderRadius: 12,
        border: "1px solid var(--bg-border)",
        background: "var(--bg-elevated)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <span
        className="font-semibold uppercase"
        style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
      >
        {t("etabli.settings")}
      </span>

      <div
        aria-hidden={disabled}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          opacity: disabled ? 0.35 : 1,
          pointerEvents: disabled ? "none" : "auto",
          transition: "opacity 200ms ease",
        }}
      >
        {children}
      </div>

      <div style={{ marginTop: "auto" }}>{action}</div>
    </aside>
  );
}
```

- [ ] **Step 2: Format + build**

Run: `bunx prettier --check src/components/ControlsPanel.tsx && bun run build`
Expected: prettier clean; build exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ControlsPanel.tsx
git commit -m "feat(etabli): ControlsPanel (settings + docked action)"
```

---

### Task 3: Rewire `CompressTab` into the 2-pane Établi

Preserve ALL existing logic (`useFileSelection`, format/quality persisted state, `handleCompress`, history, toasts). Add a `panelMode` that starts at "material", flips to "results" on a successful forge, and resets to "material" when files are added/cleared. Replace the vertical-stack JSX with the 2-pane layout.

**Files:**
- Modify: `src/components/CompressTab.tsx`

- [ ] **Step 1: Update imports**

At the top of `src/components/CompressTab.tsx`, add to the React import and add the two panel imports:

```tsx
import { useState, useCallback } from "react";
```
(unchanged — `useState` already imported) and add after the `ActionButton` import:
```tsx
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
```

- [ ] **Step 2: Add `panelMode` state and reset wiring**

After the existing `const [lastOutputDir, setLastOutputDir] = useState("");` line, add:

```tsx
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");
```

In `handleFilesSelected`, after `setResults([]);` add `setPanelMode("material");` so the body becomes:

```tsx
  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      addFiles(paths);
      setResults([]);
      setPanelMode("material");
    },
    [addFiles],
  );
```

In `handleClearFiles`, after `setResults([]);` add `setPanelMode("material");`:

```tsx
  const handleClearFiles = useCallback(() => {
    clearFiles();
    setResults([]);
    setPanelMode("material");
  }, [clearFiles]);
```

In `handleCompress`, immediately after `setResults(result.results);` add a flip to results when at least one succeeded:

```tsx
      setResults(result.results);
      if (result.results.some((r) => r.success)) setPanelMode("results");
```

- [ ] **Step 3: Replace the returned JSX**

Replace the entire `return ( … );` block (the `<div className="space-y-5">…</div>`) with:

```tsx
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={results.length > 0}
        material={
          <div className="space-y-3">
            <DropZone
              accept="png,jpg,jpeg,bmp,ico,tiff,tif,webp"
              label={isEmpty ? t("dropzone.images_compress") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_compress")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />
            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />
          </div>
        }
        results={<ResultsBanner results={results} total={files.length} outputDir={lastOutputDir} />}
      />

      <ControlsPanel
        disabled={isEmpty}
        action={
          <ActionButton
            onClick={handleCompress}
            disabled={isEmpty}
            loading={loading}
            loadingText={t("status.compressing")}
            text={isEmpty ? t("action.compress") : t("action.compress_n", { n: files.length })}
            icon={<Zap className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        <div className="space-y-2">
          <label
            className="font-semibold uppercase"
            style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
          >
            {t("label.output_format")}
          </label>
          <div className="flex gap-2">
            {(["webp", "jpeg"] as CompressFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`btn-toggle ${format === f ? "btn-toggle-active" : ""}`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label={t("label.quality")}
          value={quality}
          min={1}
          max={100}
          leftHint={t("label.smaller_file")}
          rightHint={t("label.higher_quality")}
          onChange={setQuality}
        />
      </ControlsPanel>
    </div>
  );
```

Note: `isEmpty`, `format`, `quality`, `setFormat`, `setQuality`, `CompressFormat`, and all handlers are already defined above and unchanged. The old sticky-action-bar `<div>` and the standalone `ResultsBanner` at the bottom are removed (the action now lives in `ControlsPanel`, results in `MaterialPanel`). `DropZone`, `ImageGrid`, `ResultsBanner`, `ActionButton`, `Slider`, `Zap` imports all remain (still used).

- [ ] **Step 4: Format + build**

Run: `bunx prettier --check src/components/CompressTab.tsx && bun run build`
Expected: prettier clean; `bun run build` exits 0. If tsc flags an unused import, confirm none of `DropZone`/`ImageGrid`/`ResultsBanner`/`ActionButton`/`Slider`/`Zap` was dropped.

- [ ] **Step 5: Commit**

```bash
git add src/components/CompressTab.tsx
git commit -m "feat(etabli): rewire Compresser into the 2-pane workbench"
```

---

### Task 4: Render Compresser full-width in `App.tsx`

The Établi 2-pane needs the full content width; the other tools keep the centered 860 column. Branch the content.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the content `<div className="mx-auto" style={{ maxWidth: 860 }}>…</div>` (inside `WorkbenchShell`) with the branch below**

Replace the single content `<div className="mx-auto" style={{ maxWidth: 860 }}>` block (header + all 16 tab switches) with:

```tsx
        {activeTab === "compress" ? (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                }}
              >
                {t(TAB_LABEL_KEYS[activeTab])}
              </h2>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                {t(TAB_DESC_KEYS[activeTab])}
              </p>
            </div>
            <CompressTab />
          </div>
        ) : (
          <div className="mx-auto" style={{ maxWidth: 860 }}>
            <div style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                }}
              >
                {t(TAB_LABEL_KEYS[activeTab])}
              </h2>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                {t(TAB_DESC_KEYS[activeTab])}
              </p>
            </div>

            {activeTab === "convert" && <ConvertTab />}
            {activeTab === "resize" && <ResizeTab />}
            {activeTab === "crop" && <CropTab />}
            {activeTab === "optimize" && <OptimizeTab />}
            {activeTab === "watermark" && <WatermarkTab />}
            {activeTab === "strip" && <ExifStripTab />}
            {activeTab === "pdf-toolkit" && <PdfWorkbenchTab />}
            {activeTab === "palette" && <PaletteTab />}
            {activeTab === "favicon" && <FaviconTab />}
            {activeTab === "animation" && <AnimationTab />}
            {activeTab === "spritesheet" && <SpriteSheetTab />}
            {activeTab === "base64" && <Base64Tab />}
            {activeTab === "qrcode" && <QrCodeTab />}
            {activeTab === "bulk-rename" && <BulkRenameTab />}
            {activeTab === "svg-rasterize" && <SvgRasterizeTab />}
          </div>
        )}
```

Note: `CompressTab` is removed from the centered branch (it now renders full-width above). The other 15 switches stay exactly as before. The `CompressTab` import already exists in App.tsx. Do not change anything else.

- [ ] **Step 2: Format + build**

Run: `bunx prettier --check src/App.tsx && bun run build`
Expected: prettier clean; `bun run build` exits 0.

- [ ] **Step 3: Visual check**

Run `bun run tauri dev`, open Compresser:
- Empty: a wide central panel with the big drop zone (matériel mode) + a dimmed right settings panel; the "Forger/Compresser" button is visible on the right.
- Add images: grid fills the central panel; right panel un-dims; format + quality controls usable; the right panel stays in view (sticky) while scrolling.
- Compress: after success, the central panel flips to "résultats" (before/after grid); the `[ matériel | résultats ]` toggle switches back to inputs.
- Every OTHER tool still renders in the centered column exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(etabli): render Compresser full-width in the workbench"
```

---

## Self-Review

**1. Spec coverage (§4–5, pilot slice):**
- Central material panel as hero, toggle matériel/résultats → Task 1 (`MaterialPanel`) + Task 3 wiring. ✓
- Right controls panel with the action always visible (sticky) → Task 2 (`ControlsPanel`) + Task 3. ✓
- Empty/active/forge/results states: empty (dimmed controls + drop zone), active (controls live), forge (existing `GlobalProgressBar` is global, untouched), results (toggle flips on success) → Tasks 2–3. ✓
- Dual-mode (Compresser = Établi; others = legacy column) → Task 4. ✓
- ChainBar / "et maintenant" ramps and rollout to the other 15 tools → DEFERRED to Phase 1c+ (stated). Not a gap here.

**2. Placeholder scan:** Complete code in every step; the only ellipsis marks the *old* block being replaced in App.tsx Task 4 / CompressTab Task 3. i18n values concrete. No TODO/TBD. ✓

**3. Type/name consistency:** `MaterialMode` exported from `MaterialPanel` and imported into `CompressTab` (used for `panelMode` state). `MaterialPanel` props (`mode`, `onModeChange`, `hasResults`, `material`, `results`) match the call site in Task 3. `ControlsPanel` props (`children`, `action`, `disabled`) match. `CompressFormat`, `isEmpty`, `format`, `quality`, `setFormat`, `setQuality` are pre-existing in CompressTab and reused unchanged. ✓

**Known minor (acceptable for the pilot, refine later):** `ResultsBanner` keeps its own card chrome (`mt-4` + border) so in "résultats" mode it reads as a card inside the panel body — cosmetic, revisit when ChainBar replaces the banner in Phase 1c. The tool-header markup is duplicated across the two App branches — extract a `ToolHeader` later if a third Établi tool appears.

**Verification method note:** No frontend unit-test runner (`CLAUDE.md`); verification = `prettier --check` + `bun run build` + manual visual check. No test framework invented.
