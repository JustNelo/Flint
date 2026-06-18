# Flint — Établi Phase 2a: roll out to ConvertTab + generalize App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply the Établi 2-pane pattern (built in Phase 1b) to **ConvertTab** — the first `useTabProcessor`-based tool — and generalize `App.tsx` so any tool can opt into the full-width Établi via an `ETABLI_TOOLS` set. Proves the transform on the hook-based path and makes future tool conversions one-liners.

**Architecture:** ConvertTab keeps `useTabProcessor` (its file/results/process logic) and gains a `panelMode` synced to `results` via an effect; its JSX is wrapped into the existing `MaterialPanel` + `ControlsPanel`. `App.tsx` replaces the `activeTab === "compress"` check with `ETABLI_TOOLS.has(activeTab)` and renders compress/convert in the full-width branch.

**Tech Stack:** React 19, TypeScript, Vite. No frontend test runner (`CLAUDE.md`) → verification = `bunx prettier --check` + `bun run build` + manual visual check.

**Reference:** spec §4–5, §8; Phase 1b plan (the transform this mirrors). `MaterialPanel`/`ControlsPanel` already exist.

---

### Task 1: Convert ConvertTab to the Établi 2-pane

**Files:**
- Modify: `src/components/ConvertTab.tsx`

- [ ] **Step 1: Replace the whole file with this content**

```tsx
import { useState, useCallback, useEffect } from "react";
import { ArrowRightLeft } from "lucide-react";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useTabProcessor } from "../hooks/useTabProcessor";
import { useT } from "../i18n/i18n";
import type { OutputFormat } from "../types";

const FORMAT_INFO: Record<string, { typeKey: string; alpha: boolean }> = {
  png: { typeKey: "format.lossless", alpha: true },
  jpg: { typeKey: "format.lossy", alpha: false },
  webp: { typeKey: "format.lossy_lossless", alpha: true },
  bmp: { typeKey: "format.uncompressed", alpha: false },
  ico: { typeKey: "format.lossless", alpha: true },
  tiff: { typeKey: "format.lossless", alpha: true },
};

const FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "webp", label: "WebP" },
  { value: "bmp", label: "BMP" },
  { value: "ico", label: "ICO" },
  { value: "tiff", label: "TIFF" },
];

export function ConvertTab() {
  const { t } = useT();
  const {
    files,
    removeFile,
    reorderFiles,
    handleFilesSelected,
    handleClearFiles,
    loading,
    results,
    lastOutputDir,
    process,
  } = useTabProcessor({ tabId: "convert", command: "convert_images" });
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  // Show results after a run, fall back to material when the list is cleared.
  useEffect(() => {
    setPanelMode(results.length > 0 ? "results" : "material");
  }, [results]);

  const handleConvert = useCallback(async () => {
    await process({
      extraParams: { outputFormat },
      successMessage: t("toast.convert_success", { n: files.length, format: outputFormat.toUpperCase() }),
    });
  }, [process, outputFormat, files.length, t]);

  const isEmpty = files.length === 0;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={results.length > 0}
        material={
          <div className="space-y-3">
            <DropZone
              accept="png,jpg,jpeg,bmp,ico,tiff,tif,webp,gif"
              label={isEmpty ? t("dropzone.images_convert") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_convert")}
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
            onClick={handleConvert}
            disabled={isEmpty}
            loading={loading}
            loadingText={t("status.converting")}
            text={
              isEmpty
                ? t("action.convert", { format: outputFormat.toUpperCase() })
                : t("action.convert_n", { n: files.length, format: outputFormat.toUpperCase() })
            }
            icon={<ArrowRightLeft className="h-4 w-4" strokeWidth={1.5} />}
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
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FORMAT_OPTIONS.map((fmt) => (
              <button
                key={fmt.value}
                onClick={() => setOutputFormat(fmt.value)}
                className={`btn-toggle ${outputFormat === fmt.value ? "btn-toggle-active" : ""}`}
                style={{ flex: "none" }}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            style={{
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: "var(--text-xs)",
              fontFamily: "var(--font-mono)",
              background: "rgba(232, 87, 42, 0.08)",
              border: "1px solid rgba(232, 87, 42, 0.2)",
              color: "var(--indigo-glow)",
            }}
          >
            {t(FORMAT_INFO[outputFormat]?.typeKey)}
          </span>
          {FORMAT_INFO[outputFormat]?.alpha ? (
            <span
              style={{
                borderRadius: 4,
                padding: "2px 7px",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-mono)",
                background: "rgba(34, 197, 94, 0.08)",
                border: "1px solid rgba(34, 197, 94, 0.2)",
                color: "#4ade80",
              }}
            >
              {t("format.alpha_yes")}
            </span>
          ) : (
            <span
              style={{
                borderRadius: 4,
                padding: "2px 7px",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-mono)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--bg-border)",
                color: "var(--text-tertiary)",
              }}
            >
              {t("format.alpha_no")}
            </span>
          )}
        </div>
      </ControlsPanel>
    </div>
  );
}
```

This preserves every behavior (format selection, the format-info badges, the convert command via `useTabProcessor`) and adds the `panelMode` sync. The only intentional UX change is the drop zone now goes `compact` once files are present (matching CompressTab).

- [ ] **Step 2: Format + build**

Run: `bunx prettier --check src/components/ConvertTab.tsx && bun run build`
Expected: prettier clean (run `--write` then re-check if needed); `bun run build` exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ConvertTab.tsx
git commit -m "feat(etabli): convert ConvertTab to the 2-pane workbench"
```

---

### Task 2: Generalize the full-width branch in `App.tsx` with `ETABLI_TOOLS`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the `ETABLI_TOOLS` set**

Near the other module-level constants (e.g. just after `const TAB_EXTENSIONS …` or after `SIDEBAR_SECTIONS`), add:

```tsx
// Tools migrated to the full-width Établi 2-pane layout (others use the centered column).
const ETABLI_TOOLS = new Set<TabId>(["compress", "convert"]);
```

- [ ] **Step 2: Update the content branch**

Currently the content branches on `activeTab === "compress"`. Change the condition to `ETABLI_TOOLS.has(activeTab)`, render both Établi tools in the full-width branch, and remove `convert` from the centered branch's switch list. The block becomes:

```tsx
        {ETABLI_TOOLS.has(activeTab) ? (
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
            {activeTab === "compress" && <CompressTab />}
            {activeTab === "convert" && <ConvertTab />}
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

`convert` is removed from the centered list (now in the full-width branch). The remaining 14 switches stay. `ConvertTab` is already imported. Nothing else changes.

- [ ] **Step 3: Format + build**

Run: `bunx prettier --check src/App.tsx && bun run build`
Expected: prettier clean; `bun run build` exits 0.

- [ ] **Step 4: Visual check**

`bun run tauri dev`: Convertir now opens full-width as a 2-pane Établi (material left, format controls + Convertir action right), same behavior as Compresser. Every other tool still renders centered. Compresser still works.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(etabli): generalize full-width branch via ETABLI_TOOLS (add convert)"
```

---

## Self-Review

**1. Spec coverage:** Établi rollout to the next tool (Convert) per §8 Phase 2 → Task 1; generalized opt-in mechanism so subsequent tools are trivial → Task 2. Chaining stays deferred (§8 Phase 4, and it needs the rollout first). ✓

**2. Placeholder scan:** Complete file content for ConvertTab; complete branch for App. No TODO/TBD. ✓

**3. Type/name consistency:** `MaterialMode`, `MaterialPanel`, `ControlsPanel` reused from Phase 1b. `ETABLI_TOOLS: Set<TabId>`; `.has(activeTab)` where `activeTab: TabId`. ConvertTab keeps the exact `useTabProcessor`/`OutputFormat`/i18n keys it already used. ✓

**Known minor (same as Phase 1b, accepted):** ResultsBanner card-in-card in results mode; tool-header markup duplicated across the two App branches (extract `ToolHeader` when convenient).

**Verification note:** No frontend test runner; `prettier --check` + `bun run build` + visual check.
