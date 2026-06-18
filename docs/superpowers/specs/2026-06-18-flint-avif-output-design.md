# Flint — AVIF Output Support Design

**Status:** Approved (2026-06-18)

## Problem

Flint outputs WebP and JPEG (Compress) and several formats (Convert) but not AVIF — a modern format with notably better compression. Users have no way to produce AVIF.

## Goal

Add **AVIF as an output format** in the Compress and Convert tools. Encoding only (no `.avif` input decoding), using a pure-Rust encoder so the build stays simple.

## Scope decisions

- **Output only.** AVIF input/decoding is out of scope (needs an AV1 decoder like dav1d — heavy to package on Windows). The results before/after preview still works because the WebView (Chromium) renders AVIF natively.
- **Encoder:** the already-present `image` crate, with its `avif` feature enabled (encoder backed by `ravif`/`rav1e`, pure Rust). The `nasm` feature is **not** enabled, so `rav1e` builds without external assembler — slower encode, no toolchain burden.
- **Speed/quality:** a fixed encode speed of 6 (balance of speed vs size). Compress reuses its existing quality slider (1–100). Convert (no slider) uses a default quality of 80.

## Design

### Backend (Rust)

- `Cargo.toml`: change `image = "0.25.9"` to `image = { version = "0.25.9", features = ["avif"] }`. (This file is committed as part of this change, with explicit user authorization.)
- `image_ops.rs`:
  - `const AVIF_SPEED: u8 = 6;`
  - `compress_to_avif(input_paths, quality: u8, output_dir, app_handle, cancel) -> BatchProgress` — mirrors `compress_to_jpeg`; loads the image, encodes via `AvifEncoder::new_with_speed_quality(writer, AVIF_SPEED, quality.clamp(1,100))` to `{stem}-compressed.avif` (preserving alpha — AVIF supports it).
  - `convert_images`: add an `"avif"` arm encoding to `{stem}-converted.avif` via the same encoder at quality 80.
- `lib.rs`: add a `compress_avif` command mirroring `compress_jpeg` (quality `u8`), registered in `generate_handler!`.

### Frontend

- `types.ts`: add `"avif"` to the `OutputFormat` union.
- `CompressTab.tsx`: add `"avif"` to the `CompressFormat` type and the format toggle (`webp` / `jpeg` / `avif`); dispatch `compress_avif` when the format is AVIF.
- `ConvertTab.tsx`: add `{ value: "avif", label: "AVIF" }` to `FORMAT_OPTIONS` and an `avif: { typeKey: "format.lossy", alpha: true }` entry to `FORMAT_INFO`.
- No new i18n keys: format toggles render the format name directly (`AVIF`), and Convert reuses the existing `format.lossy` / `format.alpha_yes` labels.

## Error handling

Encoding failures surface through the existing `BatchProgress` per-file error path (same as WebP/JPEG). No new error surfaces.

## Testing / verification

- `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test --lib` (compile; AVIF encode is not unit-tested — consistent with other encode paths).
- `bun run build`.
- Manual: in `tauri dev`, Compress a PNG (with transparency) to AVIF and Convert a JPEG to AVIF; confirm the `.avif` files are produced, open in the before/after preview, and are smaller than the source. Note AVIF encoding is slower than WebP/JPEG.

## Out of scope

- AVIF input/decoding.
- AVIF in tools other than Compress and Convert.
- A per-tool AVIF speed control (fixed at 6).
