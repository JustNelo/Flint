# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install frontend dependencies
bun install

# Run in development mode (starts Vite dev server + Tauri)
bun run tauri dev

# Build for production (outputs to src-tauri/target/release/bundle/)
bun run tauri build

# Rust linting (run from src-tauri/)
cargo fmt --check
cargo clippy -- -D warnings

# Apply Rust formatting
cargo fmt

# Run Rust tests
cargo test                  # all tests
cargo test validate_path    # single test by name
```

TypeScript has no dedicated lint/test commands. Type-checking runs implicitly via `tsc` during build.

## Architecture

Flint is a Tauri v2 desktop app. The frontend is a React SPA; the backend is a Rust library (`src-tauri/`) that exposes Tauri commands.

### Frontend (`src/`)

- **`App.tsx`** — root component. Owns the active tab state, sidebar layout, and renders one `*Tab` component at a time based on `TabId`.
- **`types.ts`** — shared TypeScript types for all Tauri command inputs/outputs.
- **`components/`** — one `*Tab.tsx` per tool, plus shared UI components (`DropZone`, `ResultsBanner`, `ImageGrid`, `PdfPageGrid`, etc.).
- **`hooks/`** — custom hooks consumed by tab components:
  - `useWorkspace` (Context Provider) — manages the user's output workspace directory, persisted in `localStorage`. Provides `getOutputDir(tabId)` which auto-creates per-tool sub-folders.
  - `useTabProcessor` — the standard hook for all batch-processing tabs. Wraps file selection, calls `invoke()` to the Rust command, and surfaces `results`/`loading` state.
  - `useFileSelection` — manages the selected file list with add/remove/reorder operations.
  - `useProcessingProgress` — drives the `GlobalProgressBar` by listening to Tauri events.
  - `usePdfWorkbench` — dedicated state machine for the PDF Builder tab.
- **`i18n/`** — custom i18n system (`I18nProvider`, `useT`). Dictionaries in `en.json` / `fr.json`. Language is auto-detected from `navigator.language` and stored in `localStorage`.

### Backend (`src-tauri/src/`)

All Tauri commands live in `lib.rs`, which delegates to domain-specific modules:

| Module | Responsibility |
|---|---|
| `image_ops.rs` | WebP compress, convert, resize, crop, watermark (text + image), strip EXIF, lossless optimize |
| `pdf_ops.rs` | Extract images, render to images, compress, protect/unlock |
| `pdf_split_ops.rs` | Split by page ranges |
| `pdf_watermark_ops.rs` | Add text/image watermarks to PDF pages |
| `pdf_builder_ops.rs` | Merge images + PDFs into a new PDF, generate page thumbnails |
| `color_ops.rs` | Extract dominant color palette |
| `favicon_ops.rs` | Generate multi-size `.ico` favicons |
| `gif_ops.rs` | Create GIFs / animated WebP from image sequences |
| `sprite_ops.rs` | Generate sprite sheets |
| `metadata_ops.rs` | Read EXIF metadata |
| `qr_ops.rs` | Generate QR codes |
| `rename_ops.rs` | Bulk rename with pattern tokens |
| `utils.rs` | Shared helpers |

**Command pattern in `lib.rs`:**
1. Validate all input paths via `validate_path` / `validate_paths` (rejects relative paths, `..` traversal, symlink escapes).
2. Clone the cancellation token (`CancellationToken` state) and reset it to `false`.
3. Offload work to `tokio::task::spawn_blocking`.
4. Inside the blocking thread, use `rayon::par_iter` for parallel per-file processing.

**Shared Tauri state:**
- `PdfiumPath` — resolved path to `pdfium.dll` / `libpdfium.so`, computed once at startup. Required by all PDF commands that use `pdfium-render`.
- `CancellationToken` — `Arc<AtomicBool>` shared across commands; set by the `cancel_processing` command.

### Adding a new tool

1. Create `src-tauri/src/<name>_ops.rs` with a pure Rust function.
2. Add the module in `lib.rs`, write the async Tauri command (validate paths → spawn_blocking → delegate).
3. Register the command in `tauri::generate_handler![]` in `lib.rs`.
4. Add the new `TabId` to the union type in `src/types.ts` and to `TAB_EXTENSIONS` and `SUB_FOLDERS` in `App.tsx` / `useWorkspace.tsx`.
5. Create `src/components/<Name>Tab.tsx`, using `useTabProcessor` for batch operations.

### pdfium dependency

PDF features that require rendering (extract, render, unlock, thumbnails) depend on `pdfium-render`, which loads `pdfium.dll` (Windows) or `libpdfium.so` (Linux) at runtime. The file must exist in `src-tauri/resources/` before building or running in dev mode. It is bundled as a resource and resolved at startup via `resolve_pdfium_path()`.

The binaries are **not tracked in git** (they bloat the repo by ~12 MB and would change on every pdfium version bump). They are:
- Downloaded on demand by the CI workflow (`.github/workflows/release.yml`) from [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries).
- Expected to be placed manually in `src-tauri/resources/` for local development. Grab the latest release for your platform.

### CI / Release

Releases are triggered by pushing a `v*` tag. The workflow (`.github/workflows/release.yml`) runs `cargo fmt --check`, `cargo clippy -- -D warnings`, and `cargo test` before building. Keep formatting and clippy clean before tagging.

## Claude Code Rules

### Branches
- Active working branch: `develop`
- `main` is reserved for releases — never push to it directly
- Always create a branch from `develop` for each feature: `feat/name` or `fix/name`

### Before any Rust change
- Always verify `cargo clippy -- -D warnings` passes after any edit in `src-tauri/`
- Apply `cargo fmt` if needed

### Mandatory patterns
- Every new Tauri command must follow the `lib.rs` pattern: validate → spawn_blocking → rayon
- New tools must follow EXACTLY the 5 steps in "Adding a new tool"
- Never bypass `validate_path` / `validate_paths` on file inputs

### What Claude must not do
- Do not invent bun/cargo commands that are not listed in this file
- Do not modify `pdfium` or its initialization without explicit request
- Do not create new Rust files without creating the corresponding React Tab (and vice-versa)