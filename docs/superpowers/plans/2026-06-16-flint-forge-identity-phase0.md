# Flint — Forge Identity (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the existing app to the warm "Forge" identity (charbon chaud + corail/ambre, retained ember glow, subtle grain) by editing design tokens only — no layout or component-logic changes.

**Architecture:** All changes live in `src/App.css`. We change the *values* of existing CSS custom properties (not their names), so the 16 components recolor automatically without edits. We add one new accent token (`--spark`), a retained-glow utility, and a perf-safe full-app grain overlay via `body::after` (fixed, static, no `mix-blend` → no repaint storm).

**Tech Stack:** CSS custom properties, Tailwind v4 (`@import "tailwindcss"`), Vite build, Prettier. No frontend test runner exists in this project (per `CLAUDE.md`), so verification = `bunx prettier --check`, `bun run build` (type+bundle), and a manual visual check via `bun run tauri dev`.

**Reference:** spec at `docs/superpowers/specs/2026-06-16-flint-etabli-redesign-design.md` §6.

---

### Task 1: Warm the palette tokens

Recolor the base/text token *values* in `:root` to the Forge "charbon chaud" palette. Variable **names are unchanged**, so every component that reads `--bg-base`, `--text-primary`, `--flint-*`, etc. recolors automatically. The coral accent ramp (`--indigo-*`, `--flint-accent*`) already matches Forge and is kept as-is.

**Files:**
- Modify: `src/App.css:4-71` (the `:root` block)

- [ ] **Step 1: Replace the `:root` block**

Replace the entire current `:root { … }` block (lines 4-71) with:

```css
:root {
  /* Backgrounds — depth layers (charbon chaud / Forge) */
  --bg-base: #161210;
  --bg-surface: #1e1813;
  --bg-elevated: #251d17;
  --bg-overlay: #2e241c;
  --bg-border: #34281f;

  /* Coral — signature accent (kept) */
  --indigo-dim: #3d1a10;
  --indigo-muted: #c44420;
  --indigo-core: #e8572a;
  --indigo-bright: #f06a3f;
  --indigo-glow: #ff8a5c;

  /* Spark — amber second tone (new) */
  --spark: #ffb04a;

  /* Retained ember glow — only on active/CTA/forge surfaces */
  --ember-glow: rgba(232, 87, 42, 0.4);

  /* Text (neutres chauds) */
  --text-primary: #f3eee8;
  --text-secondary: #a89a8c;
  --text-tertiary: #7a6e62;

  /* States */
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;

  /* Glass surfaces */
  --glass-bg: rgba(232, 87, 42, 0.06);
  --glass-border: rgba(232, 87, 42, 0.18);

  /* ─── Flint semantic aliases (used by new components) ─── */
  --flint-bg-base: #161210;
  --flint-bg-surface: #1e1813;
  --flint-bg-elevated: #2a1a14;
  --flint-bg-hover: #1c1712;

  --flint-sidebar-bg: #100c09;
  --flint-sidebar-border: #34281f;

  --flint-accent: #e8572a;
  --flint-accent-dim: #c44420;
  --flint-accent-muted: #3d1a10;
  --flint-accent-subtle: rgba(232, 87, 42, 0.08);

  --flint-text-primary: #f3eee8;
  --flint-text-secondary: #a89a8c;
  --flint-text-muted: #7a6e62;
  --flint-text-faint: #564b40;
  --flint-text-ghost: #3a302a;

  --flint-border: #34281f;
  --flint-border-accent: rgba(232, 87, 42, 0.33);

  --flint-radius-sm: 4px;
  --flint-radius-md: 6px;
  --flint-radius-lg: 8px;

  /* Typography scale */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;

  /* Fonts */
  --font-sans: "DM Sans", sans-serif;
  --font-mono: "DM Mono", monospace;
}
```

- [ ] **Step 2: Format check**

Run: `bunx prettier --check src/App.css`
Expected: `All matched files use Prettier code style!` (if it reports a diff, run `bunx prettier --write src/App.css` and re-check)

- [ ] **Step 3: Build to confirm no CSS/type breakage**

Run: `bun run build`
Expected: build completes (exit 0), no errors.

- [ ] **Step 4: Visual check**

Run: `bun run tauri dev`, then look at any tab.
Expected: backgrounds are warm charcoal (not cold violet); text reads warm off-white; coral accents unchanged. No element became unreadable.

- [ ] **Step 5: Commit**

```bash
git add src/App.css
git commit -m "feat(identity): warm Forge palette (charbon chaud) tokens"
```

---

### Task 2: Retained ember glow on CTA + active states

Add a reusable glow utility and apply the "heat" glow **only** to the primary action, the hovered primary button, and the active segmented toggle — never globally (spec §6).

**Files:**
- Modify: `src/App.css` — `.btn-primary:hover` (currently ~lines 95-99), `.btn-toggle-active` (currently ~lines 161-166); add a `.glow-ember` utility near the button system.

- [ ] **Step 1: Add the `.glow-ember` utility**

Immediately after the `/* ─── Button Design System ─── */` comment line (before `.btn-primary`), add:

```css
/* Retained ember glow — apply only to active/CTA/forge surfaces */
.glow-ember {
  box-shadow: 0 0 24px var(--ember-glow);
}
```

- [ ] **Step 2: Strengthen the primary hover glow**

Replace the `.btn-primary:hover` rule:

```css
.btn-primary:hover {
  background: var(--indigo-muted);
  box-shadow:
    0 4px 12px rgba(232, 87, 42, 0.25),
    0 0 22px var(--ember-glow);
  transform: translateY(-1px);
}
```

- [ ] **Step 3: Add a subtle glow to the active toggle**

Replace the `.btn-toggle-active` rule:

```css
.btn-toggle-active {
  background: var(--glass-bg) !important;
  border-color: var(--indigo-core) !important;
  color: var(--indigo-glow) !important;
  font-weight: 600;
  box-shadow: 0 0 12px rgba(232, 87, 42, 0.18);
}
```

- [ ] **Step 4: Format + build**

Run: `bunx prettier --check src/App.css && bun run build`
Expected: both pass (exit 0).

- [ ] **Step 5: Visual check**

In `bun run tauri dev`: hover the main "Compresser/Forger" CTA → soft ember halo appears; the active format toggle (e.g. WebP) has a faint glow. Idle surfaces have **no** glow.

- [ ] **Step 6: Commit**

```bash
git add src/App.css
git commit -m "feat(identity): retained ember glow on CTA and active toggle"
```

---

### Task 3: Perf-safe full-app grain overlay

Add a subtle film grain across the whole app via `body::after` — a single **fixed**, static, low-opacity SVG-noise layer with `pointer-events: none` and **no** `mix-blend-mode` (the blend mode is what caused the earlier full-window repaint storm; a plain fixed overlay is cheap).

**Files:**
- Modify: `src/App.css` — in the `/* ─── Base ─── */` section, just after the `body { … }` rule (currently ~lines 250-261).

- [ ] **Step 1: Add the grain overlay**

After the `body { … }` rule, add:

```css
/* Forge grain — uniform static texture over the whole app. Fixed + no
   mix-blend + pointer-events:none keeps it a one-time composite (no per-scroll
   repaint). z-index above content but opacity is low enough not to obscure. */
body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 140 140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
```

- [ ] **Step 2: Format + build**

Run: `bunx prettier --check src/App.css && bun run build`
Expected: both pass (exit 0).

- [ ] **Step 3: Visual + perf check**

In `bun run tauri dev`: surfaces show a faint tactile grain. Add ~12 images and scroll the grid — scrolling stays smooth (the grain must not introduce jank; if it does, the overlay is misconfigured — confirm `position: fixed` and absence of `mix-blend-mode`). Buttons/inputs remain clickable (grain has `pointer-events: none`).

- [ ] **Step 4: Commit**

```bash
git add src/App.css
git commit -m "feat(identity): subtle perf-safe grain overlay"
```

---

## Self-Review

**1. Spec coverage (Phase 0 scope, spec §6):**
- Warm "charbon chaud" base + warm text → Task 1. ✓
- Amber `--spark` second tone added as a token → Task 1 (`--spark`). ✓ (consumed by the spark micro-interaction in Phase 1; defining it here is the token deliverable.)
- Retained ember glow (active/CTA only, not global) → Task 2. ✓
- Grain on surfaces → Task 3 (uniform app overlay; richer per-surface grain is not required for Phase 0). ✓
- Typography DM Sans/Mono → unchanged (already correct), kept in Task 1's `:root`. ✓
- Étincelles micro-interaction + `prefers-reduced-motion` → **deferred to Phase 1** (built with the forge-success moment in the shell). Noted, not a gap for Phase 0.
- "Tokens in `App.css`, no hex in components" → respected: only `App.css` changes; `--spark`/`--ember-glow` exposed for later consumers. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps — every code step shows the exact CSS. ✓

**3. Type/name consistency:** New tokens `--spark` and `--ember-glow` are defined in Task 1 and consumed in Task 2 (`--ember-glow`). No renamed existing variables (only values changed), so no component references break. ✓

**Note on verification method:** This project has no frontend unit-test runner (`CLAUDE.md`), and CSS token changes are not unit-testable; verification is `prettier --check` + `bun run build` + manual visual check. This is the honest equivalent of the test/verify steps for a pure-styling phase — no test framework is invented.
