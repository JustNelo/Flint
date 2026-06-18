# Flint — PDF Workbench Phase 2: `render_pdf_page` backend command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a backend command that renders a single PDF page to a base64 JPEG at a target width (no file written) — the data source for the scrolling viewer's lazy per-page rendering.

**Architecture:** A `render_pdf_page_base64` function in `pdf_builder_ops.rs` (where pdfium page rendering already lives), mirroring the proven `generate_pdf_page_thumbnails` render path (`load_pdf_from_file` → iterate pages → `render_with_config().set_target_width()` → `bitmap.as_image()`), then encode to JPEG q85 base64. A `render_pdf_page` Tauri command in `lib.rs` (validate_path → require_pdfium → run_blocking), registered in the handler.

**Tech Stack:** Rust (pdfium-render, image, base64 — all deps). Verification: `cargo fmt` + `cargo clippy -- -D warnings` + `cargo test --lib`. Note: this command needs the pdfium runtime + a real PDF, so it has **no unit test** (the codebase's other pdfium render paths likewise aren't unit-tested); it is compile/clippy-verified here and exercised manually when the viewer (Phase 3) consumes it.

**Reference:** spec `docs/superpowers/specs/2026-06-17-flint-pdf-workbench-redesign-design.md` §4. Pattern reference: `pdf_builder_ops.rs::generate_pdf_page_thumbnails` (render config) and `lib.rs::generate_pdf_thumbnails` (command shape, pdfium State + run_blocking).

---

### Task 1: `render_pdf_page_base64` + `render_pdf_page` command

**Files:**
- Modify: `src-tauri/src/pdf_builder_ops.rs` (add the render function)
- Modify: `src-tauri/src/lib.rs` (add + register the command)

- [ ] **Step 1: Add the render function to `pdf_builder_ops.rs`**

`pdf_builder_ops.rs` already imports `image::codecs::jpeg::JpegEncoder`, `std::io::Cursor`, `pdfium_render::prelude::*`, and uses `base64` (via local `use base64::Engine;`). Add this function (e.g. right after `get_pdf_page_count`):

```rust
/// Render a single PDF page (1-indexed) to a base64 JPEG at `target_width` px.
/// No file is written — used by the in-app scrolling viewer for lazy per-page rendering.
pub fn render_pdf_page_base64(
    pdf_path: &str,
    page_number: usize,
    target_width: u32,
    pdfium: &Pdfium,
) -> Result<String, String> {
    use base64::Engine;

    let document = pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|e| format!("Cannot open PDF '{}': {}", pdf_path, e))?;

    let total_pages = document.pages().len() as usize;
    if page_number < 1 || page_number > total_pages {
        return Err(format!(
            "Page {} out of range (1..={})",
            page_number, total_pages
        ));
    }
    let target_idx = page_number - 1;

    // Clamp the requested width to a sane range (viewer zoom).
    let width = target_width.clamp(64, 2400);

    for (page_index, page) in document.pages().iter().enumerate() {
        if page_index != target_idx {
            continue;
        }
        let bitmap = page
            .render_with_config(
                &PdfRenderConfig::new()
                    .set_target_width(width as i32)
                    .set_maximum_height((width * 6) as i32),
            )
            .map_err(|e| format!("Render failed for page {}: {}", page_number, e))?;

        // JPEG has no alpha — encode the page as RGB8.
        let rgb = image::DynamicImage::ImageRgb8(bitmap.as_image().to_rgb8());
        let mut buf: Vec<u8> = Vec::new();
        let encoder = JpegEncoder::new_with_quality(Cursor::new(&mut buf), 85);
        rgb.write_with_encoder(encoder)
            .map_err(|e| format!("JPEG encode failed for page {}: {}", page_number, e))?;

        return Ok(base64::engine::general_purpose::STANDARD.encode(&buf));
    }

    Err(format!("Page {} not found", page_number))
}
```

- [ ] **Step 2: Add the Tauri command to `lib.rs`**

Add near `generate_pdf_thumbnails` (which shows the `PdfiumState` + `run_blocking` pattern):

```rust
#[tauri::command]
async fn render_pdf_page(
    pdfium_state: tauri::State<'_, PdfiumState>,
    pdf_path: String,
    page_number: usize,
    target_width: u32,
) -> Result<String, String> {
    validate_path(&pdf_path)?;
    let pdfium = require_pdfium(&pdfium_state)?;
    run_blocking(move || {
        pdf_builder_ops::render_pdf_page_base64(&pdf_path, page_number, target_width, pdfium.inner())
    })
    .await?
}
```

Add `render_pdf_page,` to the `tauri::generate_handler![...]` list (next to `generate_pdf_thumbnails`).

- [ ] **Step 3: Verify**

Run (from `src-tauri/`): `cargo fmt && cargo test --lib && cargo clippy -- -D warnings`
Expected: `cargo test --lib` compiles all code and passes (the new function compiles — no new test added, see the note in Tech Stack). `cargo clippy -- -D warnings` is clean.
Note: if clippy fails with `os error 32` (file lock on `resources\pdfium.dll`), that's a running `tauri dev` holding the DLL during the build script — environmental, not a code error; `cargo test --lib` already proved compilation.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pdf_builder_ops.rs src-tauri/src/lib.rs
git commit -m "feat(pdf): render_pdf_page command (single page -> base64, for viewer)"
```

---

## Self-Review

**1. Spec coverage (§4):** `render_pdf_page(pdf_path, page_number, target_width) -> base64`, no file, validate_path → require_pdfium → run_blocking → pdfium render; registered. ✓ Reuses `get_pdf_page_count` (existing) — no change needed. JPEG q85 (per spec lean). ✓

**2. Placeholder scan:** Complete Rust for the function + command + registration. The only ellipsis is `generate_handler![...]` (the existing list). No TBD. The "no unit test" is a justified, documented decision (pdfium runtime dependency), not a skipped step. ✓

**3. Type/name consistency:** `render_pdf_page_base64(pdf_path: &str, page_number: usize, target_width: u32, pdfium: &Pdfium) -> Result<String, String>` defined in Step 1, called by `render_pdf_page` in Step 2 with `pdfium.inner()` (matches `generate_pdf_thumbnails`'s `pdfium.inner()` usage). Command params `pdf_path`/`page_number`/`target_width` → frontend will invoke `"render_pdf_page"` with `{ pdfPath, pageNumber, targetWidth }` (camelCase) in Phase 3. ✓

**Verification note:** Rust compile/clippy gate; runtime behavior exercised manually via the Phase 3 viewer.
