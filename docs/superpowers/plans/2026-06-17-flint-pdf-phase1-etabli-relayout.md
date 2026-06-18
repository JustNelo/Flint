# Flint — PDF Workbench Phase 1: Établi relayout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Relayout `PdfWorkbenchTab` into the Établi 2-pane (material = page grid + `[pages|résultats]` toggle; controls = mode + action selector + options + post-processing + Execute), for both Workbench and Unlock modes, full-width — preserving ALL `usePdfWorkbench` logic.

**Architecture:** Reuse `MaterialPanel`/`ControlsPanel` (add optional segment-label props so the toggle can read "Pages"). Move the existing page grid / add-bar / ResultPanel into the MaterialPanel; move the mode toggle / action selector / options / post-processing / Execute into the ControlsPanel; inline the unlock UI across the two panes (retire `PdfUnlockPanel`). Add `pdf-toolkit` to `ETABLI_TOOLS`. No `usePdfWorkbench` change.

**Tech Stack:** React 19, TypeScript, Vite. No frontend test runner → `bunx prettier --check` + `bun run build` + manual visual check.

**Reference:** spec `docs/superpowers/specs/2026-06-17-flint-pdf-workbench-redesign-design.md` §2. Reference components: `src/components/MaterialPanel.tsx`, `src/components/ControlsPanel.tsx`, an existing 2-pane tool e.g. `src/components/CompressTab.tsx`.

---

### Task 1: Optional segment labels on `MaterialPanel`

So the PDF tool's toggle can show "Pages | Résultats" instead of "Matériel | Résultats", without affecting the 12 existing callers.

**Files:**
- Modify: `src/components/MaterialPanel.tsx`
- Modify: `src/i18n/en.json`, `src/i18n/fr.json`

- [ ] **Step 1: Add i18n key**

en.json: `"etabli.pages": "Pages"`
fr.json: `"etabli.pages": "Pages"`

- [ ] **Step 2: Add the optional props**

In `src/components/MaterialPanel.tsx`, extend the props interface and use them with the existing keys as defaults. Change the interface to add:

```tsx
  /** Label for the first segment (defaults to the generic "material" label). */
  materialLabel?: string;
  /** Label for the results segment (defaults to "results"). */
  resultsLabel?: string;
```

In the function signature destructure them: `{ mode, onModeChange, hasResults, material, results, materialLabel, resultsLabel }`. Replace the two segment button labels:
- the material button text `{t("etabli.material")}` → `{materialLabel ?? t("etabli.material")}`
- the results button text `{t("etabli.results")}` → `{resultsLabel ?? t("etabli.results")}`

Nothing else changes; all existing callers omit the props and keep the current labels.

- [ ] **Step 3: Format + build**

Run: `bunx prettier --check src/components/MaterialPanel.tsx src/i18n/en.json src/i18n/fr.json && bun run build`
Expected: prettier clean; `bun run build` exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/MaterialPanel.tsx src/i18n/en.json src/i18n/fr.json
git commit -m "feat(etabli): optional segment labels on MaterialPanel"
```

---

### Task 2: Relayout `PdfWorkbenchTab` into the 2-pane

**Preserve ALL logic verbatim** from `usePdfWorkbench` and every handler/state in the component (`mode`, `activeTool`, all option state, `handleExecute`, `handleUnlock`, `handleAddMore`, `handleSelectUnlockFile`, `handleSelectWmLogo`, `isExecuteDisabled`, `actionButtonText`, `actionIcon`, `pipelineSummary`, the window drag-drop effect, `ResultPanel`, `getPasswordStrength`). Only the RETURNED JSX is restructured. Read the current file fully first.

**Files:**
- Modify: `src/components/PdfWorkbenchTab.tsx`
- Delete: `src/components/PdfUnlockPanel.tsx` (its UI is inlined into the panes)

- [ ] **Step 1: Imports + panelMode state**

Add imports: `import { MaterialPanel, type MaterialMode } from "./MaterialPanel";` and `import { ControlsPanel } from "./ControlsPanel";`. Remove the `import { PdfUnlockPanel } from "./PdfUnlockPanel";` line. Add `Lock` to the lucide import (used by the inlined unlock UI; `Unlock` is already imported).

After the existing `const [mode, setMode] = useState<"workbench" | "unlock">("workbench");` add:
```tsx
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");
```
After the `result` is produced, flip to results: the result comes from `usePdfWorkbench`. Add an effect (after the hooks) so the panel flips when a result lands and resets when cleared:
```tsx
  useEffect(() => {
    if (!loading) setPanelMode(result ? "results" : "material");
  }, [result, loading]);
```
(`useEffect`, `loading`, `result` are already in scope.) Remove the now-unused `ResultPanelBound` useMemo only if it becomes unused after Step 3 (the inlined unlock no longer needs it).

- [ ] **Step 2: Replace the returned JSX**

Replace the entire `return ( <div className="space-y-5"> … </div> );` with a 2-pane layout. Define a `PANEL` style is NOT needed (MaterialPanel/ControlsPanel provide their own chrome). Structure:

```tsx
  const pageMaterial = (
    <div className="space-y-3">
      {/* MOVE here, verbatim: the add-files bar (the `pages.length === 0 ? <dropzone> : <add/clear bar>` block) */}
      {/* MOVE here, verbatim: <PdfPageGrid pages={pages} loadingThumbnails={loadingThumbnails} onReorder={reorderPages} onRemove={removePage} /> */}
    </div>
  );

  const unlockMaterial = (
    <div className="space-y-3">
      {/* the unlock drop/select zone (inlined from PdfUnlockPanel): a clickable dashed box calling handleSelectUnlockFile, Lock icon, t("pdf_tool.drop_locked_pdf") + hint */}
      {/* when unlockFile: a forge-card showing the file name (unlockFile.split(/[\\/]/).pop()) */}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={result !== null}
        materialLabel={mode === "workbench" ? t("etabli.pages") : t("pdf_tool.unlock_mode")}
        material={mode === "workbench" ? pageMaterial : unlockMaterial}
        results={<ResultPanel result={result} t={t} />}
      />

      <ControlsPanel
        disabled={mode === "workbench" ? pages.length === 0 : !unlockFile}
        action={
          mode === "workbench" ? (
            <ActionButton
              onClick={handleExecute}
              disabled={isExecuteDisabled}
              loading={loading}
              loadingText={actionButtonText.loadingText}
              text={actionButtonText.text}
              icon={actionIcon}
            />
          ) : (
            <ActionButton
              onClick={handleUnlock}
              disabled={loading || !unlockFile || !unlockPassword.trim()}
              loading={loading}
              loadingText={t("status.unlocking_pdf")}
              text={t("action.unlock_pdf")}
              icon={<Unlock className="h-4 w-4" strokeWidth={1.5} />}
            />
          )
        }
      >
        {/* mode toggle [workbench | déverrouiller] — the existing two btn-toggle buttons */}
        <div className="flex gap-2">
          <button onClick={() => setMode("workbench")} className={cn("btn-toggle", mode === "workbench" && "btn-toggle-active")}>
            {t("pdf_tool.workbench_mode")}
          </button>
          <button onClick={() => setMode("unlock")} className={cn("btn-toggle", mode === "unlock" && "btn-toggle-active")}>
            <Unlock className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("pdf_tool.unlock_mode")}
          </button>
        </div>

        {mode === "workbench" ? (
          <>
            {/* MOVE here, verbatim: the primary-action selector block (the `<p>primary_action</p>` + the 5-button grid) */}
            {/* MOVE here, verbatim: the dynamic options — the CONTENTS of the old `<div className="forge-card p-4 space-y-4">` (build/split/export/extract/watermark options + post-processing toggles + pipeline summary + pipeline step indicator), WITHOUT the old wrapping forge-card and WITHOUT the old ActionButton (the action now lives in the ControlsPanel `action` prop) */}
          </>
        ) : (
          <>
            {/* unlock controls: the password label + input (inlined from PdfUnlockPanel) */}
            <div className="space-y-1.5">
              <label className="forge-label">{t("label.pdf_password")}</label>
              <input
                type="password"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="••••••••"
                className="forge-input w-full"
              />
            </div>
          </>
        )}
      </ControlsPanel>
    </div>
  );
```

Concrete move list (cut from the old JSX, paste into the slots above, unchanged):
- The **add-files bar / empty dropzone** block (`pages.length === 0 ? (…dropzone…) : (…add/clear bar…)`) → `pageMaterial`.
- `<PdfPageGrid …/>` → `pageMaterial`.
- The **primary-action selector** (`<div>` with `pdf_tool.primary_action` + the `PRIMARY_ACTIONS.map` grid) → workbench controls.
- The **dynamic options** (everything inside the old `<div className="forge-card p-4 space-y-4">`: the per-`activeTool` option blocks, the post-processing section, the pipeline summary, the pipeline step indicator) → workbench controls, but DROP the old wrapping `forge-card` div and DROP the old `<ActionButton …>` at its end (action moved to the `action` prop).
- The unlock UI (from `PdfUnlockPanel`): the dashed select box + file-name card → `unlockMaterial`; the password label+input → unlock controls; the unlock ActionButton → the `action` prop (already written above). The old `<PdfUnlockPanel …/>` usage and the `mode === "unlock"` standalone block are removed.
- The old top-level mode switcher `<div className="flex gap-2">…</div>` is replaced by the one now inside ControlsPanel (above).

- [ ] **Step 3: Delete the now-unused component**

```bash
git rm src/components/PdfUnlockPanel.tsx
```
Confirm no other file imports it: `grep -rn "PdfUnlockPanel" src/` should return nothing after the import is removed from PdfWorkbenchTab.

- [ ] **Step 4: Format + build**

Run: `bunx prettier --check src/components/PdfWorkbenchTab.tsx && bun run build`
Expected: prettier clean; `bun run build` exits 0. Resolve any unused-import/var TS errors (e.g. remove `ResultPanelBound` if unused, remove `Upload` only if no longer used — it is used by the workbench empty dropzone, so keep it).

- [ ] **Step 5: Commit**

```bash
git add src/components/PdfWorkbenchTab.tsx
git commit -m "feat(etabli): PdfWorkbenchTab 2-pane (workbench + unlock)"
```

---

### Task 3: Render PDF Workbench full-width via `ETABLI_TOOLS`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `pdf-toolkit` to the set + move its render line**

In `src/App.tsx`, add `"pdf-toolkit"` to the `ETABLI_TOOLS` set. In the content branch, add `{activeTab === "pdf-toolkit" && <PdfWorkbenchTab />}` to the FULL-WIDTH branch (next to the other Établi tools) and REMOVE the `{activeTab === "pdf-toolkit" && <PdfWorkbenchTab />}` line from the centered branch. `PdfWorkbenchTab` is already imported. Nothing else changes.

- [ ] **Step 2: Format + build**

Run: `bunx prettier --check src/App.tsx && bun run build`
Expected: prettier clean; `bun run build` exits 0.

- [ ] **Step 3: Visual check**

`bun run tauri dev`, open the PDF tool: it now renders full-width as a 2-pane Établi. Workbench mode: add images/PDFs → page grid (left), action selector + options + Execute (right); after an action it flips to "résultats". Unlock mode (toggle, right panel): left shows the selected PDF, right has the password + Unlock. Every other tool unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(etabli): add pdf-toolkit to ETABLI_TOOLS (full-width)"
```

---

## Self-Review

**1. Spec coverage (§2):** 2-pane with `[pages|résultats]` (Task 1 labels + Task 2); page grid material; action selector + options + post-processing + Execute in controls; unlock mode adapted to 2-pane; full-width via ETABLI_TOOLS (Task 3); `usePdfWorkbench` untouched. ✓ The native viewer is Phases 2–3 (separate plans), not here. ✓

**2. Placeholder scan:** Task 2 is a guided transform of an existing file — the JSX comments mark WHERE existing verbatim blocks move (not missing code); the new wrappers, panelMode effect, mode toggle, unlock password input, and both ActionButtons are given in full. No TBD. ✓

**3. Type/name consistency:** `MaterialMode` reused; `MaterialPanel` new optional props `materialLabel`/`resultsLabel` defined in Task 1 and used in Task 2; `ControlsPanel` props match; all `usePdfWorkbench` destructured names (`pages`, `result`, `loading`, `handleExecute`, `handleUnlock`, `unlockFile`, `unlockPassword`, `setUnlockPassword`, etc.) are the existing ones. `cn` already imported. ✓

**Verification note:** No frontend test runner; `prettier --check` + `bun run build` + visual check.
