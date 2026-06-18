# Flint — Generator Tools Phase B+C: Base64 & Palette (live, 2-pane) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Redesign Base64 and Palette into 2-column "source → live output" layouts. Both produce no file → output is **live** (converts/extracts on drop, no explicit action) and is **copied/exported**, never saved.

**Architecture:** Both are frontend-only (reuse existing `image_to_base64` / `extract_palette` commands). Base64: drop image → live data URI + copy variants. Palette: drop image → live palette extraction (debounced on count) + swatches/exports, with the eyedropper canvas in the source pane. Both stay in App.tsx's centered branch (NOT ETABLI_TOOLS) — no App.tsx change.

**Tech Stack:** React 19, Tauri invoke. No frontend test runner → verification = `bunx prettier --check` + `bun run build` + manual visual check.

**Reference:** spec `docs/superpowers/specs/2026-06-16-flint-generator-tools-design.md` §3.2 (Palette) §3.3 (Base64).

---

### Task 1: Base64 — 2-pane live converter

**Files:**
- Modify: `src/components/Base64Tab.tsx` (full replace)
- Modify: `src/i18n/en.json`, `src/i18n/fr.json`

- [ ] **Step 1: Add i18n keys** (skip any that already exist)

en.json:
```json
"label.source": "Source",
"action.copy_datauri": "Copy data URI",
"action.copy_img": "Copy <img>",
"action.copy_css": "Copy CSS"
```
fr.json:
```json
"label.source": "Source",
"action.copy_datauri": "Copier le data URI",
"action.copy_img": "Copier <img>",
"action.copy_css": "Copier CSS"
```

- [ ] **Step 2: Replace the ENTIRE `src/components/Base64Tab.tsx` with:**

```tsx
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { useFileSelection } from "../hooks/useFileSelection";
import { useT } from "../i18n/i18n";
import { logError } from "../lib/utils";

const PANEL: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--bg-border)",
  background: "var(--bg-elevated)",
  padding: 14,
};

export function Base64Tab() {
  const { t } = useT();
  const { files, addFiles, removeFile, clearFiles, reorderFiles } = useFileSelection();
  const [dataUri, setDataUri] = useState("");
  const [converting, setConverting] = useState(false);

  const handleFilesSelected = useCallback((paths: string[]) => addFiles(paths.slice(0, 1)), [addFiles]);
  const handleClearFiles = useCallback(() => {
    clearFiles();
    setDataUri("");
  }, [clearFiles]);

  // Live conversion when the selected file changes.
  useEffect(() => {
    if (files.length === 0) {
      setDataUri("");
      return;
    }
    let cancelled = false;
    setConverting(true);
    invoke<string>("image_to_base64", { imagePath: files[0] })
      .then((res) => {
        if (!cancelled) setDataUri(res);
      })
      .catch((err) => {
        if (!cancelled) {
          logError("base64:convert", err);
          setDataUri("");
          toast.error(t("toast.operation_failed"));
        }
      })
      .finally(() => {
        if (!cancelled) setConverting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [files, t]);

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(t("toast.copied"));
      } catch (err) {
        logError("base64:copy", err);
        toast.error(t("toast.copy_failed"));
      }
    },
    [t],
  );

  const charCount = dataUri.length;
  const sizeKb = (charCount / 1024).toFixed(1);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <section className="flex-1 min-w-0" style={PANEL}>
        <label className="forge-label">{t("label.source")}</label>
        <div className="space-y-3" style={{ marginTop: 8 }}>
          <DropZone
            accept="png,jpg,jpeg,gif,webp,bmp,ico,svg,tiff,tif"
            label={files.length === 0 ? t("dropzone.images_base64") : t("dropzone.add_more")}
            sublabel={t("dropzone.sublabel_base64")}
            compact={files.length > 0}
            multiple={false}
            onFilesSelected={handleFilesSelected}
          />
          <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />
        </div>
      </section>

      <section style={{ width: 360, flexShrink: 0, ...PANEL }}>
        <div className="flex items-center justify-between">
          <label className="forge-label" style={{ marginBottom: 0 }}>
            {t("result.base64_ready")}
          </label>
          {dataUri && (
            <span className="forge-chip">
              {charCount.toLocaleString()} chars · {sizeKb} KB
            </span>
          )}
        </div>

        <div className="forge-card p-3 max-h-40 overflow-y-auto" style={{ marginTop: 8 }}>
          {dataUri ? (
            <code
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--text-secondary)",
                wordBreak: "break-all",
                lineHeight: 1.6,
              }}
            >
              {dataUri.slice(0, 1000)}
              {dataUri.length > 1000 ? "…" : ""}
            </code>
          ) : (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              {converting ? t("status.converting") : t("dropzone.sublabel_base64")}
            </span>
          )}
        </div>

        <div className="flex gap-2" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={() => copy(dataUri)} disabled={!dataUri} className="btn-ghost">
            <Copy className="h-3 w-3" strokeWidth={1.5} />
            {t("action.copy_datauri")}
          </button>
          <button onClick={() => copy(`<img src="${dataUri}" alt="" />`)} disabled={!dataUri} className="btn-ghost">
            {t("action.copy_img")}
          </button>
          <button
            onClick={() => copy(`background-image: url("${dataUri}");`)}
            disabled={!dataUri}
            className="btn-ghost"
          >
            {t("action.copy_css")}
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Format + build**

Run: `bunx prettier --check src/components/Base64Tab.tsx src/i18n/en.json src/i18n/fr.json && bun run build`
Expected: prettier clean; `bun run build` exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/Base64Tab.tsx src/i18n/en.json src/i18n/fr.json
git commit -m "feat(generator): 2-pane live Base64 with copy variants"
```

---

### Task 2: Palette — 2-pane live extractor + eyedropper

Transform `src/components/PaletteTab.tsx` into the 2-pane layout. **Preserve ALL existing logic verbatim**: the `rgbToHsl`/`formatHsl` helpers, the `ColorCard` component, `exportJson`/`exportCss`, `copyHex`, `handleCanvasClick`, the canvas-draw `useEffect`, `extract_palette` invoke, and all state. Only the layout and the extraction trigger change.

**Files:**
- Modify: `src/components/PaletteTab.tsx`
- Modify: `src/i18n/en.json`, `src/i18n/fr.json`

- [ ] **Step 1: Add i18n keys** (skip any that already exist)

en.json: `"action.copy_all_hex": "Copy all HEX"`
fr.json: `"action.copy_all_hex": "Copier tout (HEX)"`

- [ ] **Step 2: Make extraction live (remove the explicit Extract button)**

Replace the `handleExtract` callback with a debounced effect that runs whenever the file or color count changes while in palette mode. Add this effect (after the existing canvas-draw effect), and DELETE the old `handleExtract` function and the `<button onClick={handleExtract} …>Extract</button>` block:

```tsx
  // Live palette extraction (palette mode), debounced on the color-count slider.
  useEffect(() => {
    if (mode !== "palette" || files.length === 0) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const id = setTimeout(() => {
      invoke<PaletteResult>("extract_palette", { imagePath: files[0], numColors })
        .then((result) => {
          if (!cancelled) setPalette(result.colors);
        })
        .catch((err) => {
          if (!cancelled) {
            logError("palette:extract", err);
            setPalette([]);
            toast.error(t("toast.operation_failed"));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [files, numColors, mode, t]);
```

Add `import { logError } from "../lib/utils";` (the file already imports `safeAssetUrl` from there — extend the import to `import { safeAssetUrl, logError } from "../lib/utils";`). Remove the now-unused `Loader2` import if it is no longer referenced after the button is deleted (it was only used in the Extract button).

- [ ] **Step 3: Add a "copy all HEX" callback**

Add near `copyHex`:

```tsx
  const copyAllHex = useCallback(async () => {
    if (palette.length === 0) return;
    try {
      await navigator.clipboard.writeText(palette.map((c) => c.hex).join("\n"));
      toast.success(t("toast.copied"));
    } catch (err) {
      logError("palette:copyall", err);
      toast.error(t("toast.copy_failed"));
    }
  }, [palette, t]);
```

- [ ] **Step 4: Restructure the `return` into 2 panes**

Replace the returned JSX with this structure (move existing pieces verbatim into the slots; do not re-implement them):

```tsx
  const PANEL: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid var(--bg-border)",
    background: "var(--bg-elevated)",
    padding: 14,
  };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {/* Left — source */}
      <section className="flex-1 min-w-0" style={PANEL}>
        {/* mode toggle (the existing palette/eyedropper <div className="space-y-2"> block) */}
        {/* DropZone (set compact={files.length > 0}, label add_more when files present, multiple={false}) */}
        {/* ImageGrid (unchanged) */}
        {/* eyedropper mode: the existing canvas block (<canvas ref={canvasRef} ...>) and its hint */}
      </section>

      {/* Right — output */}
      <section style={{ width: 360, flexShrink: 0, ...PANEL }}>
        {mode === "palette" ? (
          <>
            {/* the existing num-colors slider block */}
            {/* the existing palette results block (ColorCard grid + color bar) — now always rendered when palette.length > 0 */}
            {/* exports row: the existing JSON/CSS buttons + a new "copy all HEX" button calling copyAllHex */}
            {/* if palette is empty: a placeholder hint (e.g. t("dropzone.sublabel_palette")) */}
          </>
        ) : (
          <>
            {/* eyedropper output: the existing pickedColor card, or a hint (t("label.eyedropper_hint")) when none */}
          </>
        )}
      </section>
    </div>
  );
```

Concretely:
- The mode toggle, DropZone, ImageGrid, and (in eyedropper mode) the `<canvas>` + hint move into the LEFT `<section>`.
- The num-colors slider, the `palette.map(ColorCard)` grid, the color-bar preview, and the export buttons move into the RIGHT `<section>` under `mode === "palette"`. Add the `copyAllHex` button next to the JSON/CSS export buttons:
  ```tsx
  <button onClick={copyAllHex} disabled={palette.length === 0} className="btn-ghost">
    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
    {t("action.copy_all_hex")}
  </button>
  ```
- The `pickedColor` card moves into the RIGHT `<section>` under the `eyedropper` branch; when `pickedColor` is null, render a hint `<span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>{t("label.eyedropper_hint")}</span>`.
- Remove the standalone Extract button (extraction is now live via the effect).
- Keep `DropZone` `multiple={false}` and `compact={files.length > 0}` with `add_more` label when files present.

- [ ] **Step 5: Format + build**

Run: `bunx prettier --check src/components/PaletteTab.tsx src/i18n/en.json src/i18n/fr.json && bun run build`
Expected: prettier clean; `bun run build` exits 0. If tsc flags an unused `Loader2`, remove it from the lucide import.

- [ ] **Step 6: Commit**

```bash
git add src/components/PaletteTab.tsx src/i18n/en.json src/i18n/fr.json
git commit -m "feat(generator): 2-pane live Palette (extract/eyedropper) + copy all HEX"
```

---

## Self-Review

**1. Spec coverage:** §3.3 Base64 → Task 1 (2-pane, live on drop, copy variants). §3.2 Palette → Task 2 (2-pane, live extraction + count slider, eyedropper in source pane, exports + copy-all-HEX, no file). Both stay centered (no App change), no new product capability beyond copy variants/copy-all. ✓

**2. Placeholder scan:** Task 1 is complete code. Task 2 is a precise transform of an existing file (the implementer moves verbatim blocks into named slots) — the comments in the JSON skeleton mark WHERE existing code goes, not missing code; the new effect/callback/buttons are given in full. No TBD. ✓

**3. Type/name consistency:** Reuses existing `image_to_base64`, `extract_palette`, `PaletteResult`/`ColorInfo`, `ColorCard`, `rgbToHsl`. New i18n keys consistent across both langs. `logError` imported in both. ✓

**Verification note:** No frontend test runner; `prettier --check` + `bun run build` + visual check.
