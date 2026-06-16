# Flint — Établi Phase 1a: Workbench Shell + Tool Rail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the 200px labelled sidebar with a collapsible/pinnable 56px tool rail inside a new `WorkbenchShell` layout frame — the structural groundwork for the Établi. The 16 tabs render unchanged inside the shell.

**Architecture:** Two new presentational components — `ToolRail` (icon rail driven by the existing `SIDEBAR_SECTIONS` data, pin state persisted via `usePersistedState`, opens the existing ⌘K palette) and `WorkbenchShell` (rail slot + full-height scrolling content slot). `App.tsx` is refactored to compose them; its `SIDEBAR_SECTIONS` data and tab-switch logic are preserved. No tab component changes — the material/controls inversion and chaining are Phase 1b/1c.

**Tech Stack:** React 19, TypeScript, lucide-react icons, inline styles + CSS custom properties (matching existing conventions), Vite. No frontend test runner exists (`CLAUDE.md`) → verification = `bunx prettier --check` + `bun run build` + manual visual check via `bun run tauri dev`.

**Reference:** spec `docs/superpowers/specs/2026-06-16-flint-etabli-redesign-design.md` §4 (Rail d'outils, coquille). Phase 0 (identity tokens) is already merged on this branch.

---

### Task 1: Create the `ToolRail` component

A vertical rail: ⌘K trigger at top, grouped tool icons, a pin toggle + version at the bottom. Collapsed (56px) shows icons only with `title` tooltips; pinned (200px) shows section headings + labels. Active tool gets the ember indicator.

**Files:**
- Create: `src/components/ToolRail.tsx`
- Modify: `src/i18n/en.json`, `src/i18n/fr.json` (two new keys)

- [ ] **Step 1: Add i18n keys**

In `src/i18n/en.json`, add (placed alongside other short UI keys, matching the file's existing nesting/quoting style):

```json
"rail.expand": "Expand sidebar",
"rail.collapse": "Collapse sidebar"
```

In `src/i18n/fr.json`, add the same keys:

```json
"rail.expand": "Étendre le menu",
"rail.collapse": "Réduire le menu"
```

- [ ] **Step 2: Create `src/components/ToolRail.tsx`**

```tsx
import { Search, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePersistedState } from "../hooks/usePersistedState";
import { useT } from "../i18n/i18n";
import type { TabId } from "../types";

export interface RailTab {
  id: TabId;
  labelKey: string;
  icon: LucideIcon;
}

export interface RailSection {
  titleKey: string;
  tabs: RailTab[];
}

interface ToolRailProps {
  sections: RailSection[];
  activeTab: TabId;
  onSelect: (id: TabId) => void;
  onOpenCommand: () => void;
  appVersion?: string;
}

const COLLAPSED_W = 56;
const EXPANDED_W = 200;

export function ToolRail({ sections, activeTab, onSelect, onOpenCommand, appVersion }: ToolRailProps) {
  const { t } = useT();
  const [pinned, setPinned] = usePersistedState<boolean>("rail_pinned", false);
  const width = pinned ? EXPANDED_W : COLLAPSED_W;

  return (
    <aside
      className="flex shrink-0 flex-col"
      style={{
        width,
        background: "var(--flint-sidebar-bg)",
        borderRight: "1px solid var(--flint-sidebar-border)",
        transition: "width 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div style={{ padding: 8 }}>
        <button
          onClick={onOpenCommand}
          title={`${t("cmd.placeholder")} (Ctrl+K)`}
          className="flex items-center w-full cursor-pointer"
          style={{
            gap: 8,
            height: 34,
            padding: pinned ? "0 10px" : 0,
            justifyContent: pinned ? "flex-start" : "center",
            borderRadius: 8,
            background: "var(--bg-overlay)",
            border: "1px solid var(--flint-sidebar-border)",
            color: "var(--text-tertiary)",
          }}
        >
          <Search style={{ width: 14, height: 14, flexShrink: 0 }} strokeWidth={1.5} />
          {pinned && (
            <span style={{ flex: 1, textAlign: "left", fontSize: 11, fontFamily: "var(--font-sans)" }}>
              {t("cmd.placeholder")}
            </span>
          )}
          {pinned && (
            <kbd
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                padding: "2px 5px",
                borderRadius: 4,
                background: "var(--bg-base)",
                color: "var(--text-tertiary)",
              }}
            >
              ⌘K
            </kbd>
          )}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 mt-1 flex-1 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.titleKey} className="mb-1">
            {pinned ? (
              <div className="px-3 pt-4 pb-1.5">
                <span
                  className="font-semibold uppercase select-none"
                  style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
                >
                  {t(section.titleKey)}
                </span>
              </div>
            ) : (
              <div style={{ height: 1, background: "var(--flint-sidebar-border)", margin: "8px 8px 6px" }} />
            )}
            {section.tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelect(tab.id)}
                  title={pinned ? undefined : t(tab.labelKey)}
                  className="relative flex items-center w-full cursor-pointer"
                  style={{
                    height: 34,
                    padding: pinned ? "0 12px" : 0,
                    justifyContent: pinned ? "flex-start" : "center",
                    borderRadius: 6,
                    gap: 8,
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    fontFamily: "var(--font-sans)",
                    transition: "background 150ms ease, color 150ms ease",
                    background: isActive
                      ? "linear-gradient(90deg, var(--flint-bg-elevated), transparent)"
                      : "transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    border: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--bg-overlay)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2"
                    style={{
                      width: 2,
                      height: 16,
                      borderRadius: 1,
                      background: isActive ? "var(--indigo-core)" : "transparent",
                    }}
                  />
                  <Icon
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      color: isActive ? "var(--indigo-core)" : "var(--text-tertiary)",
                    }}
                    strokeWidth={1.5}
                  />
                  {pinned && t(tab.labelKey)}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        style={{
          borderTop: "1px solid var(--flint-sidebar-border)",
          padding: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: pinned ? "space-between" : "center",
          gap: 6,
        }}
      >
        {pinned && appVersion && (
          <span
            style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", paddingLeft: 6 }}
          >
            v{appVersion}
          </span>
        )}
        <button
          onClick={() => setPinned(!pinned)}
          title={pinned ? t("rail.collapse") : t("rail.expand")}
          className="btn-icon"
          style={{ flexShrink: 0 }}
        >
          {pinned ? (
            <PanelLeftClose style={{ width: 16, height: 16 }} strokeWidth={1.5} />
          ) : (
            <PanelLeftOpen style={{ width: 16, height: 16 }} strokeWidth={1.5} />
          )}
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Format + build**

Run: `bunx prettier --check src/components/ToolRail.tsx src/i18n/en.json src/i18n/fr.json && bun run build`
Expected: prettier clean (run `--write` then re-check if needed); `bun run build` exits 0 (the new component is unused so far — that is fine; this step only proves it type-checks).

- [ ] **Step 4: Commit**

```bash
git add src/components/ToolRail.tsx src/i18n/en.json src/i18n/fr.json
git commit -m "feat(shell): collapsible ToolRail component"
```

---

### Task 2: Create the `WorkbenchShell` layout frame

The 3-zone frame. For Phase 1a it is rail + a full-height scrolling content slot (the material/controls split lands in Phase 1b).

**Files:**
- Create: `src/components/WorkbenchShell.tsx`

- [ ] **Step 1: Create `src/components/WorkbenchShell.tsx`**

```tsx
import type { ReactNode } from "react";

interface WorkbenchShellProps {
  /** The tool rail rendered on the left. */
  rail: ReactNode;
  /** Main content (the active tool). */
  children: ReactNode;
}

/**
 * Établi layout frame: a left rail slot + a full-height scrolling content area.
 * Phase 1a keeps content as a single column; the material/controls split is added
 * in Phase 1b.
 */
export function WorkbenchShell({ rail, children }: WorkbenchShellProps) {
  return (
    <div className="relative z-10 flex flex-1 overflow-hidden">
      {rail}
      <main className="flex-1 overflow-y-auto" style={{ padding: "28px 36px" }}>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Format + build**

Run: `bunx prettier --check src/components/WorkbenchShell.tsx && bun run build`
Expected: prettier clean; build exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkbenchShell.tsx
git commit -m "feat(shell): WorkbenchShell layout frame"
```

---

### Task 3: Wire the shell into `App.tsx`

Replace the inline `<aside>` sidebar + `<main>` block with `<WorkbenchShell rail={<ToolRail … />}>`. Keep `SIDEBAR_SECTIONS`, the header (title/desc), and the tab switches. Widen the content column from 680 to 860 to use the width reclaimed from the slimmer rail (full-width material/controls comes in Phase 1b).

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports**

In `src/App.tsx`, remove `Search` from the `lucide-react` import (it is now used inside `ToolRail`, not `App`). Leave all other icon imports (they are referenced by `SIDEBAR_SECTIONS`). Add these two imports next to the other component imports (e.g. after the `CommandPalette` import):

```tsx
import { WorkbenchShell } from "./components/WorkbenchShell";
import { ToolRail } from "./components/ToolRail";
```

Note: the existing `import { CommandPalette, type CommandTool } from "./components/CommandPalette";` line stays. The `SIDEBAR_SECTIONS` constant already has the shape `{ titleKey, tabs: { id, labelKey, icon } }[]`, which structurally matches `ToolRail`'s `RailSection[]` prop — pass it directly, no conversion.

- [ ] **Step 2: Replace the layout block**

In the returned JSX, replace this entire block (the wrapper `<div className="relative z-10 flex flex-1 overflow-hidden">` containing the `<aside>…</aside>` sidebar and the `<main>…</main>`):

```tsx
      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className="flex shrink-0 flex-col"
          style={{
            width: 200,
            background: "var(--flint-sidebar-bg)",
            borderRight: "1px solid var(--flint-sidebar-border)",
          }}
        >
          {/* … entire sidebar header + nav + version block … */}
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto" style={{ padding: "32px 40px" }}>
          <div className="mx-auto" style={{ maxWidth: 680 }}>
            {/* … header + {activeTab === …} switches … */}
          </div>
        </main>
      </div>
```

with:

```tsx
      <WorkbenchShell
        rail={
          <ToolRail
            sections={SIDEBAR_SECTIONS}
            activeTab={activeTab}
            onSelect={setActiveTab}
            onOpenCommand={() => setCmdOpen(true)}
            appVersion={appVersion}
          />
        }
      >
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

          {activeTab === "compress" && <CompressTab />}
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
      </WorkbenchShell>
```

Leave everything outside this block unchanged (`TitleBar`, `UpdateBanner`, `SplashScreen`, `GlobalProgressBar`, `CommandPalette`, the modals, `Toaster`). The `commandTools`/`activeExtensions`/`useGlobalShortcuts` logic and all `useState`/`useEffect` hooks stay exactly as they are.

- [ ] **Step 3: Format + type-check + build**

Run: `bunx prettier --check src/App.tsx && bun run build`
Expected: prettier clean; `bun run build` exits 0. If `tsc` reports `Search` is declared but never used, confirm it was removed from the import in Step 1. If it reports `SIDEBAR_SECTIONS` type mismatch on `sections`, confirm `RailSection`/`RailTab` field names (`titleKey`, `tabs`, `id`, `labelKey`, `icon`) match the constant.

- [ ] **Step 4: Visual check**

Run `bun run tauri dev`:
- A slim 56px icon rail replaces the old sidebar; icons grouped with thin dividers; hovering an icon shows its tooltip; the active tool shows the ember bar + coral icon.
- The ⌘K button at the top opens the command palette (and Ctrl/⌘+K still works).
- Clicking the pin toggle (bottom) expands the rail to 200px with section headings, labels, and the version; clicking again collapses it; the choice survives an app restart (persisted).
- Every tool still opens and works inside the wider content column.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(shell): mount WorkbenchShell + ToolRail in App"
```

---

## Self-Review

**1. Spec coverage (Phase 1a slice of §4):**
- Rail ~56px, icon-first, grouped, ⌘K integrated → Task 1. ✓
- Collapsible/pinnable with persisted state → Task 1 (`usePersistedState("rail_pinned")`). ✓
- Replaces the 200px sidebar; data reused (`SIDEBAR_SECTIONS`) → Task 3. ✓
- `WorkbenchShell` frame (rail + content) → Task 2. ✓
- Tabs unchanged inside; material/controls split + chaining explicitly DEFERRED to Phase 1b/1c → not in this plan (stated). ✓
- Full-width material is NOT delivered here (content stays a centered 860 column) — intentional for 1a; Phase 1b widens to the workbench. Noted, not a gap.

**2. Placeholder scan:** Component code is complete; the only ellipses are inside the *old* block being deleted in Task 3 Step 2 (shown for identification, not to be written). i18n values are concrete. No TODO/TBD. ✓

**3. Type/name consistency:** `RailSection`/`RailTab` field names (`titleKey`, `tabs`, `id`, `labelKey`, `icon`) match `App.tsx`'s `SIDEBAR_SECTIONS`/`TabDef` shape, so it passes without conversion. `ToolRail` props (`sections`, `activeTab`, `onSelect`, `onOpenCommand`, `appVersion`) match the call site in Task 3. `WorkbenchShell` props (`rail`, `children`) match its usage. `icon: LucideIcon` matches `App.tsx`'s `icon: typeof Zap`. ✓

**Verification method note:** No frontend unit-test runner exists (`CLAUDE.md`); verification is `prettier --check` + `bun run build` (tsc + vite) + manual visual check. No test framework invented.
