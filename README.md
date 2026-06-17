<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Flint" />

# Flint

Batch image processing, PDF tools, and developer utilities in one fast desktop app.

[![Build & Release](https://github.com/JustNelo/Rust-ine/actions/workflows/release.yml/badge.svg)](https://github.com/JustNelo/Rust-ine/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/tag/JustNelo/Rust-ine?label=version&color=e8572a)](https://github.com/JustNelo/Rust-ine/releases/latest)
[![License](https://img.shields.io/badge/license-Source%20Available-555)](#license)

</div>

---

Flint is a Tauri v2 desktop application that bundles common image, PDF, and developer tasks behind a single, fast interface. Heavy work runs in parallel on a Rust backend, so the UI stays responsive on large batches.

## Download

Get the latest installer from the [Releases page](https://github.com/JustNelo/Rust-ine/releases/latest).

| Platform | Format |
| :--- | :--- |
| Windows | NSIS installer (`.exe`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

The app updates itself and notifies you when a new version is available.

## Features

### Image tools

| Tool | Description |
| :--- | :--- |
| Compress | Batch compression to WebP or JPEG with an adjustable quality slider |
| Convert | Convert between PNG, JPEG, WebP, BMP, ICO and TIFF |
| Resize | Presets (1080p, 4K, social formats) or custom dimensions |
| Crop | Interactive crop with draggable handles and a rule-of-thirds grid |
| Optimize | Lossless PNG optimization (OxiPNG) |
| Watermark | Text or image watermarks with live preview and a tiled mode |
| EXIF Strip | Remove metadata with a before/after view |
| Color Palette | Extract the dominant colors from an image |
| SVG Rasterize | Render SVG to PNG or WebP at any target width |

### PDF toolkit

| Tool | Description |
| :--- | :--- |
| Build | Merge images and PDF pages into a new document, with drag-and-drop reordering |
| Split | Split a PDF by page ranges (`1-3, 5, 8-end`) |
| Export to images | Render pages to images at a custom DPI (72–1200) |
| Extract images | Pull embedded images out of a PDF |
| Watermark | Stamp text or image watermarks onto pages |
| Compress | Reduce size by re-encoding embedded images |
| Protect / Unlock | Add or remove PDF password protection |

### Developer tools

| Tool | Description |
| :--- | :--- |
| Favicon | Generate a multi-size `.ico`, PNGs and a web manifest from one image |
| Animation | Build animated GIFs from image sequences |
| Sprite Sheet | Combine images into a sprite sheet and a JSON atlas |
| Image to Base64 | Convert an image to a data URI |
| QR Code | Generate a QR code PNG from text or a URL |
| Bulk Rename | Rename files with pattern tokens (`{name}`, `{index}`, `{date}`, `{ext}`) |

### Throughout

- Two-pane workbench: source material on the left, settings and results on the right.
- Command palette (`Ctrl/Cmd + K`) to jump to any tool.
- Before/after slider, per-file results, and a global progress bar with cancel.
- A configurable output workspace with per-tool subfolders.
- English and French, dark theme, guided first-run setup, and built-in updates.
- Keyboard shortcuts: `Ctrl+Enter` to run, `Ctrl+L` to clear, `Esc` to cancel.

## Tech stack

| Layer | Technology |
| :--- | :--- |
| Runtime | Tauri v2 (Rust backend, native WebView) |
| Backend | Rust 2021, Rayon, image, webp, lopdf, pdfium-render, OxiPNG, Tokio |
| Frontend | React 19, TypeScript, Tailwind CSS v4, Vite |
| UI | Lucide icons, Sonner, dnd-kit |
| Tooling | Bun, GitHub Actions (lint, test, build, release) |

## Getting started

### Prerequisites

- Rust (stable toolchain, with `clippy` and `rustfmt`)
- Bun (or Node.js 18+)
- Tauri v2 system dependencies — see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- PDFium in `src-tauri/resources/` (`pdfium.dll` on Windows, `libpdfium.so` on Linux)

### Develop

```bash
bun install          # install frontend dependencies
bun run tauri dev    # run in development
bun run tauri build  # build installers into src-tauri/target/release/bundle/
```

### Check

```bash
cd src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## Architecture

### Backend

Every Tauri command follows the same pipeline:

1. Validate input paths (absolute only, no `..`, symlinks resolved, allowed-directory check).
2. Offload CPU-bound work to `tokio::task::spawn_blocking`.
3. Parallelize per-file batches with `rayon`.
4. Stream progress back to the UI through Tauri events.

PDFium is not thread-safe, so all PDF calls go through a single serialized instance.

```
src-tauri/src/
├── lib.rs               Tauri commands, path validation, app setup
├── image_ops.rs         Compress, convert, resize, crop, watermark, strip, optimize
├── pdf_ops.rs           Extract, render, compress, protect, unlock
├── pdf_builder_ops.rs   Merge and page thumbnails
├── pdf_split_ops.rs     Split by page ranges
├── pdf_watermark_ops.rs Text and image watermarks
├── color_ops.rs         Dominant color extraction
├── favicon_ops.rs       Favicon generation
├── gif_ops.rs           Animated GIF / WebP
├── sprite_ops.rs        Sprite sheets
├── metadata_ops.rs      EXIF reading
├── qr_ops.rs            QR codes
├── rename_ops.rs        Bulk rename
├── svg_ops.rs           SVG rasterization
├── utils.rs             Shared helpers (paths, PDF object cloning, encoding)
└── progress.rs          Progress events
```

### Frontend

One component per tool, sharing a common workbench shell and hooks (`useTabProcessor`, `useWorkspace`, `useProcessingProgress`) plus reusable primitives (`DropZone`, `ResultsBanner`, `BeforeAfterSlider`, `ImageGrid`). A small custom layer handles English and French.

### Security

- Restrictive `default-src 'self'` content security policy.
- Path validation on every file input (traversal, symlink escape, allowed directories).
- Tauri capabilities scoped to user directories.
- Numeric inputs clamped and file names sanitized.
- No shell execution.

## License

Copyright (c) 2025-2026 Léon Gallet.

Source-available. You may read the code and run it for personal use. Redistribution, sub-licensing, or any commercial use of the code or the application is not permitted.
