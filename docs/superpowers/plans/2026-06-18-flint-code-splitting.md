# Flint — Tab Code-Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lazy-load every tool tab and the conditional modals so they ship as separate chunks, shrinking the initial bundle, with no behavior change.

**Architecture:** Convert the static tab/modal imports in `src/App.tsx` to `React.lazy`, render the active tool inside a single `<Suspense>` boundary, and wrap each conditional modal in its own `<Suspense>`. Components use named exports, so each `lazy()` maps the named export to `default`.

**Tech Stack:** React 19 (`lazy`, `Suspense`), Vite (automatic chunk splitting on dynamic `import()`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-18-flint-code-splitting-design.md`

**Verification gate:** `bun run build` (tsc + vite). Reference: only `src/App.tsx` changes.

---

### Task 1: Lazy-load tabs and modals in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update the React import to include `lazy` and `Suspense`**

Change:
```tsx
import { useState, useMemo, useEffect } from "react";
```
to:
```tsx
import { useState, useMemo, useEffect, lazy, Suspense } from "react";
```

- [ ] **Step 2: Replace the static tab + modal imports with lazy imports**

Find the block of static component imports (currently lines ~26-46):
```tsx
import { CompressTab } from "./components/CompressTab";
import { ConvertTab } from "./components/ConvertTab";
import { ResizeTab } from "./components/ResizeTab";
import { WatermarkTab } from "./components/WatermarkTab";
import { ExifStripTab } from "./components/ExifStripTab";
import { OptimizeTab } from "./components/OptimizeTab";
import { CropTab } from "./components/CropTab";
import { PdfWorkbenchTab } from "./components/PdfWorkbenchTab";
import { PaletteTab } from "./components/PaletteTab";
import { FaviconTab } from "./components/FaviconTab";
import { AnimationTab } from "./components/AnimationTab";
import { SpriteSheetTab } from "./components/SpriteSheetTab";
import { Base64Tab } from "./components/Base64Tab";
import { QrCodeTab } from "./components/QrCodeTab";
import { BulkRenameTab } from "./components/BulkRenameTab";
import { SvgRasterizeTab } from "./components/SvgRasterizeTab";
```
and the two modal imports (currently around lines 44-45):
```tsx
import { SettingsPanel } from "./components/SettingsPanel";
import { OnboardingModal } from "./components/OnboardingModal";
```

Replace ALL of the above with lazy versions (named export → `default`):
```tsx
const CompressTab = lazy(() => import("./components/CompressTab").then((m) => ({ default: m.CompressTab })));
const ConvertTab = lazy(() => import("./components/ConvertTab").then((m) => ({ default: m.ConvertTab })));
const ResizeTab = lazy(() => import("./components/ResizeTab").then((m) => ({ default: m.ResizeTab })));
const WatermarkTab = lazy(() => import("./components/WatermarkTab").then((m) => ({ default: m.WatermarkTab })));
const ExifStripTab = lazy(() => import("./components/ExifStripTab").then((m) => ({ default: m.ExifStripTab })));
const OptimizeTab = lazy(() => import("./components/OptimizeTab").then((m) => ({ default: m.OptimizeTab })));
const CropTab = lazy(() => import("./components/CropTab").then((m) => ({ default: m.CropTab })));
const PdfWorkbenchTab = lazy(() => import("./components/PdfWorkbenchTab").then((m) => ({ default: m.PdfWorkbenchTab })));
const PaletteTab = lazy(() => import("./components/PaletteTab").then((m) => ({ default: m.PaletteTab })));
const FaviconTab = lazy(() => import("./components/FaviconTab").then((m) => ({ default: m.FaviconTab })));
const AnimationTab = lazy(() => import("./components/AnimationTab").then((m) => ({ default: m.AnimationTab })));
const SpriteSheetTab = lazy(() => import("./components/SpriteSheetTab").then((m) => ({ default: m.SpriteSheetTab })));
const Base64Tab = lazy(() => import("./components/Base64Tab").then((m) => ({ default: m.Base64Tab })));
const QrCodeTab = lazy(() => import("./components/QrCodeTab").then((m) => ({ default: m.QrCodeTab })));
const BulkRenameTab = lazy(() => import("./components/BulkRenameTab").then((m) => ({ default: m.BulkRenameTab })));
const SvgRasterizeTab = lazy(() => import("./components/SvgRasterizeTab").then((m) => ({ default: m.SvgRasterizeTab })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));
const OnboardingModal = lazy(() => import("./components/OnboardingModal").then((m) => ({ default: m.OnboardingModal })));
```

Leave all other imports (TitleBar, CommandPalette, WorkbenchShell, ToolRail, GlobalProgressBar, SplashScreen, UpdateBanner, hooks, icons, types) **static**.

> Note: if `bun run build` reports a named export does not exist (e.g. a component is actually a `default` export), use `.then((m) => ({ default: m.default }))` for that one. Verify against the component file if the build errors.

- [ ] **Step 3: Add a `TabFallback` component**

Add this small component near the top of `App.tsx` (after the imports, before `const TAB_EXTENSIONS`):
```tsx
// Shown while a lazily-loaded tool chunk resolves. Chunks load from local disk
// in ~ms, so this is intentionally minimal and rarely visible.
function TabFallback() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 240 }}>
      <div
        className="animate-pulse"
        style={{ width: 28, height: 28, borderRadius: 8, background: "var(--bg-elevated)" }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Wrap the active-tool render in a `<Suspense>` boundary**

In the `return`, wrap the whole tool-selection block (the `{ETABLI_TOOLS.has(activeTab) ? (...) : (...)}` expression) inside `WorkbenchShell` with a Suspense:

Change:
```tsx
      >
        {ETABLI_TOOLS.has(activeTab) ? (
          <div>
            <ToolHeader title={t(labelKeyFor(activeTab))} description={t(descKeyFor(activeTab))} />
            {activeTab === "compress" && <CompressTab />}
```
… (unchanged middle) …
```tsx
            {activeTab === "qrcode" && <QrCodeTab />}
          </div>
        )}
      </WorkbenchShell>
```
to wrap that ternary:
```tsx
      >
        <Suspense fallback={<TabFallback />}>
          {ETABLI_TOOLS.has(activeTab) ? (
            <div>
              <ToolHeader title={t(labelKeyFor(activeTab))} description={t(descKeyFor(activeTab))} />
              {activeTab === "compress" && <CompressTab />}
              {activeTab === "convert" && <ConvertTab />}
              {activeTab === "optimize" && <OptimizeTab />}
              {activeTab === "resize" && <ResizeTab />}
              {activeTab === "watermark" && <WatermarkTab />}
              {activeTab === "svg-rasterize" && <SvgRasterizeTab />}
              {activeTab === "favicon" && <FaviconTab />}
              {activeTab === "spritesheet" && <SpriteSheetTab />}
              {activeTab === "strip" && <ExifStripTab />}
              {activeTab === "bulk-rename" && <BulkRenameTab />}
              {activeTab === "crop" && <CropTab />}
              {activeTab === "animation" && <AnimationTab />}
              {activeTab === "pdf-toolkit" && <PdfWorkbenchTab />}
            </div>
          ) : (
            <div className="mx-auto" style={{ maxWidth: 860 }}>
              <ToolHeader title={t(labelKeyFor(activeTab))} description={t(descKeyFor(activeTab))} />
              {activeTab === "palette" && <PaletteTab />}
              {activeTab === "base64" && <Base64Tab />}
              {activeTab === "qrcode" && <QrCodeTab />}
            </div>
          )}
        </Suspense>
      </WorkbenchShell>
```
(Only the wrapping `<Suspense>…</Suspense>` and indentation change; the inner JSX is identical.)

- [ ] **Step 5: Wrap the two conditional modals in their own `<Suspense>`**

Change:
```tsx
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onResetOnboarding={() => {
            setShowSettings(false);
            setShowOnboarding(true);
          }}
        />
      )}
      {showOnboarding && (
        <OnboardingModal
          onComplete={() => {
            setShowOnboarding(false);
            try {
              localStorage.setItem("rustine_onboarded", "1");
            } catch {}
          }}
        />
      )}
```
to:
```tsx
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            onResetOnboarding={() => {
              setShowSettings(false);
              setShowOnboarding(true);
            }}
          />
        </Suspense>
      )}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingModal
            onComplete={() => {
              setShowOnboarding(false);
              try {
                localStorage.setItem("rustine_onboarded", "1");
              } catch {}
            }}
          />
        </Suspense>
      )}
```

- [ ] **Step 6: Build and verify chunking**

Run: `bun run build`
Expected: build succeeds; `tsc` passes; the Vite output now lists **multiple `dist/assets/*.js` chunks** (one per lazy component) and the main `index-*.js` chunk is **noticeably smaller than ~525 kB** (the 500 kB chunk-size warning should be gone or much smaller). If a lazy import errors with "has no exported member", fix that one import per the note in Step 2, then rebuild.

- [ ] **Step 7: Manual smoke test**

Run `bun run tauri dev` (or rely on an already-running dev server via HMR). Click through every tool in the rail, open the command palette (`Ctrl+K`) and navigate, open Settings, and trigger onboarding (clear `rustine_onboarded` in localStorage). Expected: every tool renders, navigation is instant, no jarring flash, no console errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "perf(app): lazy-load tool tabs and modals (code-splitting)"
```
(Commit message body must end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer per project convention.)

---

## Self-Review

**1. Spec coverage:** Spec requires (a) lazy every tab + Onboarding + Settings → Step 2; (b) single Suspense around the active tool → Step 4; (c) modals each in own Suspense → Step 5; (d) minimal `TabFallback` → Step 3; (e) rail/palette/metadata stay static → Step 2 leaves them eager; (f) build shows multiple smaller chunks → Step 6; (g) manual no-regression → Step 7. All covered.

**2. Placeholder scan:** No TBD/vague steps; every code step shows the exact code. The Step 2 note about `default` exports is a concrete fallback instruction, not a placeholder.

**3. Type/name consistency:** Lazy const names match the JSX usages (`CompressTab`, …, `PdfWorkbenchTab`, `SettingsPanel`, `OnboardingModal`) exactly as currently rendered. `TabFallback` defined in Step 3, used in Step 4. `lazy`/`Suspense` imported in Step 1.
