# Flint — ChainBar (Reactive Tool Chaining) Design

**Status:** Approved (2026-06-18)

## Problem

Each tool keeps its own local file selection; there is no way to feed one tool's output into the next. A user who compresses images and then wants to resize them must re-select the output files by hand.

## Goal

After a successful batch run, offer a reactive **"And now →"** row in the results panel listing the compatible next tools. Clicking one switches to that tool with the just-produced output files pre-loaded as its input. One step at a time — not a pre-built pipeline.

## Scope

- **Sources:** the 7 image batch tools that render `ResultsBanner` — Compress, Convert, Resize, Crop, Watermark, Optimize, EXIF Strip. (Favicon/SpriteSheet/Animation use `ResultCard` with special outputs; PDF and generators are excluded.)
- **Targets:** the chainable image tools whose accepted extensions cover the **extensions actually produced** by the run (read from the successful results' `output_path`). The source tool is excluded from its own suggestions. Example: a `.webp` output offers Resize/Crop/Watermark/Convert but **not** Optimize (png/jpg only).
- **Placement:** a footer row inside the `ResultsBanner` card (validated mockup, option A).

## Architecture

### Handoff

A small React context, `ChainHandoffProvider`, holds `pending: { tab: TabId; files: string[] } | null` plus:
- `requestChain(tab, files)` — set the pending handoff (also stored in a ref for synchronous reads).
- `consumeChain(tab) → string[] | null` — if a handoff is pending for `tab`, return its files and clear it; else `null`.

Flow: clicking a chain chip calls `requestChain(targetTab, outputFiles)`. `App` watches `pending` in an effect and switches `activeTab` to the target. Because App renders the active tab conditionally, switching **unmounts the source tab and mounts the target fresh**; on mount the target calls `consumeChain(tabId)` and loads the handed-off files into its (empty) selection. Clearing `pending` afterwards is a no-op for the App effect.

### Consuming the handoff

- `useTabProcessor` gains a mount-time effect: `const f = consumeChain(tabId); if (f?.length) fileSelection.addFiles(f);`. This covers Convert, Resize, Crop, Watermark, Optimize, EXIF Strip (all use `useTabProcessor`).
- `CompressTab` (its own flow) gets the same 3-line effect using its `addFiles`.

### Chain config

`src/lib/chain.ts`:
- `CHAIN_TARGETS: { id: TabId; labelKey: string; icon: LucideIcon; accept: string[] }[]` — the chainable image tools with their accepted extensions (mirrors the relevant `TAB_EXTENSIONS` entries) and rail label/icon.
- `compatibleChainTargets(source: TabId, outputExts: string[]): ChainTarget[]` — pure function: targets where `id !== source` and every produced extension is in `accept`. Returns `[]` if `outputExts` is empty.

### UI

`ResultsBanner` gains a `sourceTab: TabId` prop. It derives the produced extensions from the successful results, computes `compatibleChainTargets`, and — when there are any — renders a footer row (top border) with a coral "And now →" label and one ghost button per target (icon + tab label). Clicking calls `requestChain(target.id, successOutputPaths)`. The 7 source tabs each pass their `sourceTab`.

## Components

- New: `src/hooks/useChainHandoff.tsx` (context + provider + hook).
- New: `src/lib/chain.ts` (config + `compatibleChainTargets`).
- Modify: `src/main.tsx` (wrap App in `ChainHandoffProvider`), `src/App.tsx` (pending→`setActiveTab` effect), `src/components/ResultsBanner.tsx` (chain row + `sourceTab`), `src/hooks/useTabProcessor.ts` (consume on mount), `src/components/CompressTab.tsx` (consume on mount + pass `sourceTab`), and the other 6 source tabs (pass `sourceTab`).
- i18n: add `chain.next` ("Et maintenant" / "And now") to `fr.json`/`en.json`. Chips reuse existing `tab.*` labels.

## Error handling / edges

- Handoff is single-use (cleared on consume); manual tab navigation triggers nothing.
- Fresh-mount means no stale selection to clear; the chained files become the target's selection.
- If a chained file is somehow unprocessable by the target, it surfaces as the usual per-file error.

## Testing

- `compatibleChainTargets` is a pure function and gets a unit test — but Flint has no frontend test runner yet, so that test lands with workstream #4 (Vitest setup). For this change: type-check/build green + manual verification (compress → chain to Resize loads the outputs; incompatible targets are hidden).

## Out of scope

- Multi-step pipeline building (a sequence defined upfront).
- Chaining from Favicon/SpriteSheet/Animation/PDF/generators.
- Remembering chain history or suggesting based on past usage.
