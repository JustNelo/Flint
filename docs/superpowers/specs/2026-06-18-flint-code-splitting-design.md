# Flint — Tab Code-Splitting Design

**Status:** Approved (2026-06-18)

## Problem

`App.tsx` statically imports all ~18 `*Tab` components plus the modals, so every tool ships in the initial bundle (~525 kB JS, above Vite's 500 kB warning). Startup parses code for tools the user may never open.

## Goal

Load each tool's code on demand, shrinking the initial bundle and startup parse, with no change in behavior. Flint is a desktop app (chunks load from local disk in milliseconds), so the loading state must be unobtrusive.

## Approach

Lazy-load every tab component and the conditional modals via `React.lazy`, behind a single `<Suspense>` boundary around the active-tool render in `App.tsx`.

Rejected alternatives:
- **Heavy-only lazy** (PDF Workbench + dnd-kit only): smaller win, uneven rule.
- **Vendor `manualChunks` only**: does not defer the per-tool component code, which is the bulk.

## Design

- In `App.tsx`, replace the static `import { XTab } from "./components/XTab"` for all tab components with `const XTab = lazy(() => import("./components/XTab"))`. Apply the same to `OnboardingModal` (~300 lines, first-run only) and `SettingsPanel` (opened occasionally).
- Wrap the active-tab render in `<Suspense fallback={<TabFallback />}>`. The conditionally-rendered `OnboardingModal`/`SettingsPanel` are each wrapped in their own `<Suspense>` (or share the same boundary if co-located).
- **`TabFallback`**: a minimal, centered, low-contrast pulse occupying the content region. Loads are near-instant so it rarely shows; it must not flash a heavy spinner.
- **Stays static (eager):** `SIDEBAR_SECTIONS` metadata, labels, lucide icons, `ToolRail`, `TitleBar`, `CommandPalette`, `WorkbenchShell`, `GlobalProgressBar`, `UpdateBanner`, `SplashScreen`. Navigation and the command palette must never depend on a tool chunk loading. The command palette keeps working because it only reads tab metadata, not the tab components.

## Components

- `App.tsx` — converts tab/modal imports to `lazy`, adds the `Suspense` boundary(ies), defines or imports `TabFallback`.
- `TabFallback` — a tiny presentational component (inline in `App.tsx` or a small file under `components/`).

No backend, type, or i18n changes.

## Error handling

`React.lazy` rejects if a chunk fails to load (e.g., corrupted install). This is extremely unlikely for a bundled desktop app and is out of scope for a dedicated error boundary here; a failed chunk would surface as a blank content area, consistent with current behavior on a fatal load error. (A global error boundary can be considered separately, not in this change.)

## Verification

- `bun run build` succeeds; output shows **multiple chunks** (roughly one per lazy component) and an `index` chunk **noticeably smaller** than the current ~525 kB; the 500 kB warning should disappear or shrink.
- Manual: launch `tauri dev`, switch across every tool — no regression, no jarring flash; the command palette and rail still navigate instantly; first-run onboarding still appears; settings panel still opens.

## Out of scope

- Vendor `manualChunks` tuning (possible follow-up).
- A global React error boundary.
- Route-level prefetching/preloading heuristics.
