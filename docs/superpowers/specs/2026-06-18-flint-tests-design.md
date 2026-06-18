# Flint — Test Coverage Design

**Status:** Approved (2026-06-18)

## Problem

Flint has Rust unit tests but **no frontend test runner** and no coverage for several pure helpers, the ChainBar logic, the rename-pattern logic, or the lopdf-based PDF operations. Regressions in this logic are caught only by chance.

## Goal

Add a lean, high-ROI test layer: a Vitest setup covering pure frontend functions and a few critical hooks, plus Rust integration/unit tests for the pure-Rust (lopdf) PDF paths and recently-added guards. pdfium-runtime operations stay manually verified (runtime + DLL are fragile in CI), consistent with the existing stance.

## Frontend (Vitest)

**Tooling:** add dev dependencies `vitest`, `jsdom`, `@testing-library/react`; a minimal `vitest.config.ts` (`environment: "jsdom"`, globals); `package.json` scripts `test` (`vitest run`) and `test:watch` (`vitest`). (Modifies `package.json` + lockfile — not `Cargo.toml`.)

**Pure functions:**
- `src/lib/chain.ts` → `compatibleChainTargets`: excludes the source; filters by produced extension (e.g. `webp` excludes Optimize; empty exts → `[]`).
- `src/lib/utils.ts` → `formatSize` (B/KB/MB rounding + 0), `isImage` (incl. `avif`, case-insensitive, no-ext), `getFileName` (win/unix separators), `resolveThumb` (string → itself, `null` → original via `safeAssetUrl`, `undefined` → `undefined`).
- `src/lib/renamePattern.ts` (**new**): extract the `{name}/{index}/{date}/{ext}` substitution currently inlined in `BulkRenameTab`'s preview into a pure `applyRenamePattern(fullName, pattern, index, date)`. `BulkRenameTab` uses it for the live preview. Tested for token replacement, index zero-padding, and extension re-append.

**Hooks** (via `renderHook`):
- `useChainHandoff`: `requestChain` sets `pending`; `consumeChain(tab)` returns the files and clears (and returns `null` for a non-matching tab).
- `useFileSelection`: add (dedupe by path), remove, reorder, clear.

## Backend (Rust, pure / lopdf)

- `pdf_split_ops`: an integration test that builds a multi-page PDF in a temp dir with lopdf, runs `split_pdf` over ranges, and asserts the output files exist with the expected page counts. (`parse_ranges` is already unit-tested.)
- `utils::deep_clone_object`: clone an object subtree between two lopdf docs; assert references are remapped and cycles don't recurse infinitely.
- `pdf_ops::is_safely_recompressible`: unit tests for dicts with/without `SMask`, `BitsPerComponent != 8`, `DecodeParms`, and non-RGB/Gray colorspaces.

pdfium-backed ops (extract images, render to images, unlock) remain manually verified.

## CI

Add a frontend test step to `.github/workflows/release.yml` (`bun install` + `bun run test`) alongside the existing `cargo fmt --check` / `clippy` / `test`, so both suites gate a release.

## Verification

- `bun run test` (Vitest) passes locally; `cargo test` passes.
- `bun run build` still green (the rename extraction must not change behavior — the preview output is identical).

## Out of scope

- Component/RTL render tests (deferred; low ROI for this app).
- pdfium-runtime integration tests.
- Coverage thresholds / coverage reporting.
- E2E / WebDriver tests.
