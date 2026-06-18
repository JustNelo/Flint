# Flint — ChainBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After a successful batch run, show a footer "And now →" row in `ResultsBanner` listing compatible next tools; clicking switches to that tool with the just-produced files pre-loaded.

**Architecture:** A `ChainHandoff` context holds a pending `{ tab, files }`; `App` switches the active tab when it changes; the freshly-mounted target tool consumes the handoff and loads the files. A pure `compatibleChainTargets` decides which tools to offer based on produced extensions.

**Tech Stack:** React 19 (context), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-18-flint-chainbar-design.md`

**Verification:** `bun run build` (tsc + vite) after each task.

---

### Task 1: Chain config + handoff context

**Files:** Create `src/lib/chain.ts`, `src/hooks/useChainHandoff.tsx`.

- [ ] **Step 1: Create `src/lib/chain.ts`**
```ts
import type { LucideIcon } from "lucide-react";
import { Zap, ArrowRightLeft, Scaling, Crop, Stamp, Sparkles, ShieldOff } from "lucide-react";
import type { TabId } from "../types";

export interface ChainTarget {
  id: TabId;
  labelKey: string;
  icon: LucideIcon;
  /** Accepted input extensions (mirrors TAB_EXTENSIONS for these image tools). */
  accept: string[];
}

const IMG = ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"];

export const CHAIN_TARGETS: ChainTarget[] = [
  { id: "compress", labelKey: "tab.compress", icon: Zap, accept: [...IMG, "ico"] },
  { id: "convert", labelKey: "tab.convert", icon: ArrowRightLeft, accept: [...IMG, "ico", "gif"] },
  { id: "resize", labelKey: "tab.resize", icon: Scaling, accept: [...IMG, "ico", "gif"] },
  { id: "crop", labelKey: "tab.crop", icon: Crop, accept: IMG },
  { id: "watermark", labelKey: "tab.watermark", icon: Stamp, accept: IMG },
  { id: "optimize", labelKey: "tab.optimize", icon: Sparkles, accept: ["png", "jpg", "jpeg"] },
  { id: "strip", labelKey: "tab.strip", icon: ShieldOff, accept: IMG },
];

/** Targets that can consume every produced extension, excluding the source. */
export function compatibleChainTargets(source: TabId, outputExts: string[]): ChainTarget[] {
  if (outputExts.length === 0) return [];
  return CHAIN_TARGETS.filter((t) => t.id !== source && outputExts.every((ext) => t.accept.includes(ext)));
}
```

- [ ] **Step 2: Create `src/hooks/useChainHandoff.tsx`**
```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { TabId } from "../types";

interface Handoff {
  tab: TabId;
  files: string[];
}

interface ChainContextValue {
  pending: Handoff | null;
  requestChain: (tab: TabId, files: string[]) => void;
  consumeChain: (tab: TabId) => string[] | null;
}

const ChainContext = createContext<ChainContextValue | null>(null);

export function ChainHandoffProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Handoff | null>(null);
  const ref = useRef<Handoff | null>(null);

  const requestChain = useCallback((tab: TabId, files: string[]) => {
    const h = { tab, files };
    ref.current = h;
    setPending(h);
  }, []);

  const consumeChain = useCallback((tab: TabId): string[] | null => {
    const p = ref.current;
    if (p && p.tab === tab) {
      ref.current = null;
      setPending(null);
      return p.files;
    }
    return null;
  }, []);

  return <ChainContext.Provider value={{ pending, requestChain, consumeChain }}>{children}</ChainContext.Provider>;
}

export function useChainHandoff(): ChainContextValue {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChainHandoff must be used within a ChainHandoffProvider");
  return ctx;
}
```

- [ ] **Step 3: Verify** — `bun run build` (compiles; not yet wired). Expected: pass.

---

### Task 2: Wire the provider + App navigation

**Files:** Modify `src/main.tsx`, `src/App.tsx`.

- [ ] **Step 1: Wrap App in the provider (`main.tsx`)**

Add the import and wrap `<App />`:
```tsx
import { ChainHandoffProvider } from "./hooks/useChainHandoff";
```
Change the `RootApp` body's provider nesting so it reads:
```tsx
    <I18nProvider>
      <WorkspaceProvider>
        <ChainHandoffProvider>
          <App />
        </ChainHandoffProvider>
      </WorkspaceProvider>
    </I18nProvider>
```

- [ ] **Step 2: Switch the active tab on a pending handoff (`App.tsx`)**

Add the import:
```tsx
import { useChainHandoff } from "./hooks/useChainHandoff";
```
Inside `App()`, near the other hooks, add:
```tsx
  const { pending } = useChainHandoff();
```
Add an effect (next to the other `useEffect`s):
```tsx
  useEffect(() => {
    if (pending) setActiveTab(pending.tab);
  }, [pending]);
```

- [ ] **Step 3: Verify** — `bun run build`. Expected: pass.

---

### Task 3: The chain row in `ResultsBanner`

**Files:** Modify `src/components/ResultsBanner.tsx`.

- [ ] **Step 1: Add imports + `sourceTab` prop**

Add imports:
```tsx
import { ArrowRight } from "lucide-react";
import { useChainHandoff } from "../hooks/useChainHandoff";
import { compatibleChainTargets } from "../lib/chain";
import type { ProcessingResult, TabId } from "../types";
```
(Remove the existing `import type { ProcessingResult } from "../types";` — fold `TabId` into it as above.)

Extend the props:
```tsx
interface ResultsBannerProps {
  results: ProcessingResult[];
  total: number;
  outputDir?: string;
  sourceTab?: TabId;
}
```
and destructure `sourceTab` in the component signature.

- [ ] **Step 2: Compute targets**

Inside the component (after `outputPaths` is defined, ~line 40), add:
```tsx
  const { requestChain } = useChainHandoff();
  const chainTargets = useMemo(() => {
    if (!sourceTab) return [];
    const exts = Array.from(
      new Set(outputPaths.map((p) => p.split(".").pop()?.toLowerCase()).filter((e): e is string => !!e)),
    );
    return compatibleChainTargets(sourceTab, exts);
  }, [sourceTab, outputPaths]);
```

- [ ] **Step 3: Render the footer chain row**

Just before the closing `</div>` of the results card (after the `failed > 0` block, still inside the card `div`), add:
```tsx
        {succeeded > 0 && chainTargets.length > 0 && (
          <div
            className="flex items-center gap-2 flex-wrap"
            style={{ borderTop: "1px solid var(--bg-border)", paddingTop: 12 }}
          >
            <span
              className="inline-flex items-center gap-1"
              style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--indigo-core)" }}
            >
              {t("chain.next")}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            {chainTargets.map((target) => {
              const Icon = target.icon;
              return (
                <button
                  key={target.id}
                  onClick={() => requestChain(target.id, outputPaths)}
                  className="btn-ghost"
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {t(target.labelKey)}
                </button>
              );
            })}
          </div>
        )}
```

- [ ] **Step 4: Verify** — `bun run build`. Expected: pass (the prop is optional, so un/updated callers still type-check).

---

### Task 4: Consume the handoff in the tools

**Files:** Modify `src/hooks/useTabProcessor.ts`, `src/components/CompressTab.tsx`.

- [ ] **Step 1: `useTabProcessor` — load chained files on mount**

Add `useEffect` to the React import (currently `import { useState, useCallback } from "react";` → add `useEffect`). Add the import:
```tsx
import { useChainHandoff } from "./useChainHandoff";
```
Inside the hook, after `const fileSelection = useFileSelection();`, add:
```tsx
  const { consumeChain } = useChainHandoff();
  useEffect(() => {
    const chained = consumeChain(tabId);
    if (chained && chained.length > 0) fileSelection.addFiles(chained);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 2: `CompressTab` — same consume effect**

`CompressTab` already imports `useEffect`. Add:
```tsx
import { useChainHandoff } from "../hooks/useChainHandoff";
```
After `const { files, addFiles, ... } = useFileSelection();` (and the `useWorkspace` line), add:
```tsx
  const { consumeChain } = useChainHandoff();
  useEffect(() => {
    const chained = consumeChain("compress");
    if (chained && chained.length > 0) addFiles(chained);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Verify** — `bun run build`.

---

### Task 5: Pass `sourceTab` from the 7 source tabs + i18n

**Files:** Modify `CompressTab.tsx`, `ConvertTab.tsx`, `ResizeTab.tsx`, `CropTab.tsx`, `WatermarkTab.tsx`, `ExifStripTab.tsx`, `OptimizeTab.tsx`, `src/i18n/en.json`, `src/i18n/fr.json`.

- [ ] **Step 1: Add `sourceTab` to each `<ResultsBanner …>`**

In each tab, add the matching `sourceTab` prop to its `ResultsBanner` usage:
- CompressTab: `sourceTab="compress"`
- ConvertTab: `sourceTab="convert"`
- ResizeTab: `sourceTab="resize"`
- CropTab: `sourceTab="crop"`
- WatermarkTab: `sourceTab="watermark"`
- ExifStripTab: `sourceTab="strip"`
- OptimizeTab: `sourceTab="optimize"`

Example (CompressTab): change
```tsx
        results={<ResultsBanner results={results} total={files.length} outputDir={lastOutputDir} />}
```
to
```tsx
        results={<ResultsBanner results={results} total={files.length} outputDir={lastOutputDir} sourceTab="compress" />}
```

- [ ] **Step 2: Add the `chain.next` i18n key**

In `src/i18n/en.json` add `"chain.next": "And now",` and in `src/i18n/fr.json` add `"chain.next": "Et maintenant",` (place near other short labels; keep JSON valid).

- [ ] **Step 3: Verify** — `bun run build`.

- [ ] **Step 4: Manual smoke test (`tauri dev`)**

Compress a batch of PNGs → the results panel shows "Et maintenant →" with Resize/Crop/Watermark/Convert/Optimize/Strip. Click Resize → switches to Resize with the compressed outputs loaded. Compress to WebP → Optimize is NOT offered (png/jpg only). Run a tool, switch tabs manually → no chaining.

- [ ] **Step 5: Commit**
```bash
git add src/lib/chain.ts src/hooks/useChainHandoff.tsx src/main.tsx src/App.tsx src/components/ResultsBanner.tsx src/hooks/useTabProcessor.ts src/components/CompressTab.tsx src/components/ConvertTab.tsx src/components/ResizeTab.tsx src/components/CropTab.tsx src/components/WatermarkTab.tsx src/components/ExifStripTab.tsx src/components/OptimizeTab.tsx src/i18n/en.json src/i18n/fr.json
git commit -m "feat(ui): ChainBar — chain a tool's output into the next compatible tool"
```
(End the body with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.)

---

## Self-Review

**1. Spec coverage:** handoff context (T1S2), chain config + compat (T1S1), provider wiring (T2S1), App navigation (T2S2), chain row + sourceTab + compat-filtered targets (T3), consume in useTabProcessor + CompressTab (T4), 7 sources pass sourceTab (T5S1), i18n (T5S2), manual verify (T5S4). The pure-function unit test is deferred to workstream #4 per the spec. Covered.

**2. Placeholder scan:** All steps carry concrete code; the two `eslint-disable` comments are intentional (mount-only effects), not placeholders.

**3. Type/name consistency:** `requestChain`/`consumeChain`/`pending` match across context, App, ResultsBanner, useTabProcessor, CompressTab. `compatibleChainTargets(source, exts)` and `ChainTarget` match between `chain.ts` and `ResultsBanner`. `sourceTab` optional prop matches all 7 call sites. `chain.next` key used in T3, defined in T5S2.
