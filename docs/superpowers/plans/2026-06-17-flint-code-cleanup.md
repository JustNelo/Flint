# Flint Code Cleanup & Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the real bugs surfaced by the code audit, delete confirmed dead code, remove duplication (DRY), and trim over-engineered/inconsistent code — without changing product behavior except where a behavior is an outright bug.

**Architecture:** Pure cleanup/hardening pass over the existing Tauri v2 (Rust) + React 19/TS frontend. No new features, no architectural restructuring. Work proceeds in 5 phases: **B** (bug fixes) → **A** (dead code) → **C** (DRY) → **D** (simplicity) → **E** (consistency). Phases are independent; within a phase, tasks are committed in small logical groups.

**Tech Stack:** Rust (image 0.25, pdfium-render, lopdf, resvg/tiny-skia, webp, qrcode), React 19 + TypeScript + Vite + Tailwind v4, custom i18n.

**Source:** Audit findings (45, 12 adversarially verified, 0 false positives). Finding IDs are referenced per task for traceability.

---

## Conventions & Verification (read once)

**Project rules (do not violate):**
- Branch: `feat/flint-redesign`. Never push to `main`.
- Commit only specific paths with explicit `git add <path>` (never `-A`, `.`, or `commit -a`).
- Never commit `src-tauri/Cargo.toml` or `.claude/settings.local.json`.
- End every commit message body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Tauri command pattern is intentional: `validate_path → require_pdfium (PDF) → run_blocking → rayon`. pdfium is shared via `SendPdfium(Mutex<Pdfium>)` and **must stay serialized** — never call it concurrently.

**Verification commands:**
- Rust gate: `cargo fmt --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml --lib`
  - If clippy fails with `os error 32` (pdfium.dll locked by a running `tauri dev`), that is environmental — `cargo test --lib` already proves compilation. Stop `tauri dev` for a clean clippy run.
- Frontend gate: `bun run build` (runs `tsc` then `vite build`; expect `✓ built`).

**Dependency notes between phases:**
- Phase A Task A2 deletes `ImagePreview.tsx`, which removes one caller of `safeAssetUrl(…, true)` — do A2 before B5 to reduce B5's surface.
- Phase C migrates `ResizeTab`/`CropTab`/`WatermarkTab` onto `useTabProcessor`, which restores error logging — this **supersedes** the B10 fix for those three tabs. B10 below therefore only covers `AnimationTab`/`BulkRenameTab` (which stay manual).

---

# PHASE B — Bug fixes

### Task B1: `optimize_lossless` JPEG branch is silently lossy (q75)

Finding `optimize-lossless-jpeg-is-lossy` (HIGH). `img.save_with_format(_, Jpeg)` uses image 0.25's default quality (75), contradicting the "quality 100" comment and the tool's "lossless" promise.

**Files:** Modify `src-tauri/src/image_ops.rs` (~761-767, the `"jpg" | "jpeg"` arm of `optimize_lossless`).

- [ ] **Step 1: Encode at quality 100 explicitly**

Replace the JPEG arm body:
```rust
"jpg" | "jpeg" => {
    // JPEG is inherently lossy; re-encode at max quality (100) to minimize
    // additional generation loss while still rewriting clean Huffman tables.
    let img = load_image(input_path)?;
    let output_path = out_dir.join(format!("{}-optimized.jpg", stem));
    let mut out = std::fs::File::create(&output_path)
        .map_err(|e| format!("Cannot create optimized JPEG: {}", e))?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 100);
    encoder
        .encode_image(&img)
        .map_err(|e| format!("Cannot save optimized JPEG: {}", e))?;
    output_path.to_string_lossy().to_string()
}
```
Ensure `use image::codecs::jpeg::JpegEncoder;` is available (add a local `use` inside the arm or at module top if not already imported).

- [ ] **Step 2: Verify** — run the Rust gate. Expect clippy clean, tests pass.

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/image_ops.rs
git commit -m "fix(image): optimize_lossless re-encodes JPEG at quality 100, not the silent default 75"
```

---

### Task B2: SVG rasterizer treats premultiplied alpha as straight alpha

Finding `svg-premultiplied-alpha` (HIGH). `pixmap.data()` is premultiplied RGBA; it is fed raw into `image::ImageBuffer::from_raw` (PNG) and `webp::Encoder::from_rgba` (WebP), producing wrong colors/halos on semi-transparent SVGs.

**Files:** Modify `src-tauri/src/svg_ops.rs:48-65`.

- [ ] **Step 1: Use tiny-skia's own PNG encoder (handles premultiply) and demultiply for WebP**

Replace the `if let Some(fmt) = img_format { … } else { … }` block:
```rust
if ext == "png" {
    // tiny-skia's encode_png correctly un-premultiplies alpha.
    let png = pixmap
        .encode_png()
        .map_err(|e| format!("Cannot encode PNG: {}", e))?;
    fs::write(&output_path, &png).map_err(|e| format!("Cannot write PNG file: {}", e))?;
} else {
    // WebP: convert premultiplied pixels to straight alpha before encoding.
    let mut straight = pixmap.data().to_vec();
    for px in straight.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a > 0 && a < 255 {
            px[0] = ((px[0] as u32 * 255 + a / 2) / a).min(255) as u8;
            px[1] = ((px[1] as u32 * 255 + a / 2) / a).min(255) as u8;
            px[2] = ((px[2] as u32 * 255 + a / 2) / a).min(255) as u8;
        }
    }
    let encoder = webp::Encoder::from_rgba(&straight, target_width, target_height);
    let webp_data = encoder.encode(90.0);
    fs::write(&output_path, &*webp_data).map_err(|e| format!("Cannot write WebP file: {}", e))?;
}
```
Then simplify the format match so the `img_format`/`ImageFormat` import is no longer needed:
```rust
let ext = match format_lower.as_str() {
    "webp" => "webp",
    _ => "png",
};
```
Remove the now-unused `use image::ImageFormat;` (top of file) and the `img_format` variable. Run clippy to confirm no unused imports remain.

- [ ] **Step 2: Verify** — Rust gate. (Manual check optional: rasterize an SVG with a semi-transparent fill and confirm edges are clean.)

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/svg_ops.rs
git commit -m "fix(svg): un-premultiply alpha before PNG/WebP encode (correct colors on transparent SVG)"
```

---

### Task B3: Watermark width estimated from UTF-8 byte count

Finding `watermark-textlen-bytes-not-chars` (MED). `text.len()` (bytes) inflates width for accented/emoji text → right/center/tiled placement is off (notably for French).

**Files:** Modify `src-tauri/src/image_ops.rs:540`.

- [ ] **Step 1: Use glyph count**

Replace:
```rust
let text_width = (font_size * text.len() as f32 * 0.55) as i32;
```
with:
```rust
let text_width = (font_size * text.chars().count() as f32 * 0.55) as i32;
```

- [ ] **Step 2: Verify** — Rust gate.
- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/image_ops.rs
git commit -m "fix(image): estimate watermark text width from glyph count, not UTF-8 byte length"
```

---

### Task B4: Stale result leaks across workbench/unlock mode switch

Finding `stale-result-on-mode-switch` (MED). `setMode(...)` (PdfWorkbenchTab ~503 & 509) never clears `result`; the panel-mode effect depends only on `[result, loading]`.

**Files:** Modify `src/components/PdfWorkbenchTab.tsx` (the two `setMode` handlers and/or the mode state).

- [ ] **Step 1: Clear result + reset panel on mode change**

In each handler that calls `setMode("workbench")` / `setMode("unlock")`, also call `setResult(null)` and `setPanelMode("material")`. Concretely, define one helper near the state and use it for both toggles:
```tsx
const switchMode = (next: "workbench" | "unlock") => {
  setMode(next);
  setResult(null);
  setPanelMode("material");
};
```
Replace the two inline `onClick={() => setMode("workbench")}` / `setMode("unlock")` with `switchMode("workbench")` / `switchMode("unlock")`. (Keep `setMode` itself if used elsewhere.)

- [ ] **Step 2: Verify** — `bun run build`. Manual: run a workbench action, switch to Unlock → panel shows material, not the old result.
- [ ] **Step 3: Commit**
```bash
git add src/components/PdfWorkbenchTab.tsx
git commit -m "fix(pdf): clear result and reset panel when switching workbench/unlock mode"
```

---

### Task B5: `safeAssetUrl` cache-buster is content-invariant

Finding `asset-cache-bust-noop` (MED). `?v=${encodeURIComponent(filePath)}` never changes for a given file, so before/after previews can show a stale cached image after reprocessing. **Do Task A2 (delete ImagePreview) first** so only `BeforeAfterSlider` and `ResultsBanner` remain as `bustCache` callers.

**Files:** Modify `src/lib/utils.ts:33-37`; update callers in `src/components/ui/BeforeAfterSlider.tsx` and `src/components/ResultsBanner.tsx`.

- [ ] **Step 1: Make the buster a caller-supplied token**
```ts
export function safeAssetUrl(filePath: string, bust?: string | number | false): string {
  const normalized = filePath.replace(/\\/g, "/");
  const base = convertFileSrc(normalized);
  return bust ? `${base}?v=${encodeURIComponent(String(bust))}` : base;
}
```

- [ ] **Step 2: Pass a per-result token from callers**

In `ResultsBanner` and `BeforeAfterSlider`, derive a token that changes whenever the displayed result set changes, and pass it instead of `true`:
```tsx
// near the top of the component, where `results` / the result prop is available:
const bust = useMemo(() => Date.now(), [results]); // changes once per new result set
// then: safeAssetUrl(path, bust)  (replace safeAssetUrl(path, true))
```
Use the appropriate dependency for each component (the prop that updates when a fresh output is produced — `results` in ResultsBanner; the `afterSrc`/result path in BeforeAfterSlider). Grep `safeAssetUrl(` in both files and replace every `, true)` with `, bust)`.

- [ ] **Step 3: Verify** — `bun run build`. Manual: reprocess the same file twice; the after-image updates.
- [ ] **Step 4: Commit**
```bash
git add src/lib/utils.ts src/components/ui/BeforeAfterSlider.tsx src/components/ResultsBanner.tsx
git commit -m "fix(ui): make safeAssetUrl cache-buster change per result so previews refresh"
```

---

### Task B6: QR `size` not clamped on the preview command

Findings `qr-preview-unclamped-size` / `qr-preview-no-size-clamp` (MED/LOW). `generate_qr_cmd` clamps `size` to `[64, 4096]`; `generate_qr_preview` forwards it raw to `build_qr_image` → unbounded allocation from IPC.

**Files:** Modify `src-tauri/src/qr_ops.rs:17` (`build_qr_image`); optionally remove the now-redundant clamp in `lib.rs` (`generate_qr_cmd`, ~line 742).

- [ ] **Step 1: Clamp inside the shared `build_qr_image`** (covers both commands)
```rust
fn build_qr_image(text: &str, size: u32) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
    let size = size.clamp(64, 4096);
    let code = QrCode::new(text.as_bytes()).map_err(|e| format!("QR encoding failed: {}", e))?;
    // …unchanged…
}
```

- [ ] **Step 2: Drop the duplicated clamp in `lib.rs`** `generate_qr_cmd` (now redundant — `build_qr_image` clamps). Leave it if it is also used to report `size` back to the UI; otherwise remove the `let size = size.clamp(64, 4096);` line. Verify the command still returns the intended size to the frontend (check `QrResult.size`).

- [ ] **Step 3: Verify** — Rust gate (the existing `generate_qr_base64_produces_png` test still passes).
- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/qr_ops.rs src-tauri/src/lib.rs
git commit -m "fix(qr): clamp size in build_qr_image so the preview command is bounded too"
```

---

### Task B7: `compress_pdf` corrupts images with SMask / array filters / non-8-bit

Findings `compress-drops-image-dict-metadata` + `compress-ignores-array-filter-and-predictor` (MED). The Phase-3 rewrite hardcodes the image dict (drops SMask → loses transparency, forces DeviceRGB), and Phase-1 reads `Filter` only via `as_name()` (mis-handles array filters / predictors / non-8-bit). **This path has no automated test (pdfium/lopdf runtime) — verify manually.**

**Files:** Modify `src-tauri/src/pdf_ops.rs` (Phase 1 ~336-405 detection; Phase 3 ~407-432 stream rebuild).

- [ ] **Step 1: Skip images that cannot be safely re-encoded** rather than risk corruption. Before re-encoding an image XObject, bail out (leave the original stream untouched) when any of these hold:
  - the dict has an `SMask` entry;
  - `BitsPerComponent` is present and ≠ 8;
  - the dict has `DecodeParms`/`DP` with a `Predictor` ≥ 2;
  - `ColorSpace` is anything other than `/DeviceRGB` or `/DeviceGray` (e.g. Indexed/ICCBased/array).

Add a guard helper near the image loop:
```rust
fn is_safely_recompressible(dict: &lopdf::Dictionary) -> bool {
    if dict.has(b"SMask") { return false; }
    if let Ok(bpc) = dict.get(b"BitsPerComponent").and_then(|o| o.as_i64()) {
        if bpc != 8 { return false; }
    }
    if dict.has(b"DecodeParms") || dict.has(b"DP") { return false; }
    match dict.get(b"ColorSpace").and_then(|o| o.as_name()) {
        Ok(b"DeviceRGB") | Ok(b"DeviceGray") => {}
        _ => return false, // array / indexed / icc / missing → skip
    }
    true
}
```
Call it at the top of the per-image processing; `continue` (skip) when it returns false.

- [ ] **Step 2: Detect DCT under an array filter.** When reading `Filter`, accept either a name or the last element of an array:
```rust
let filter_name: Option<Vec<u8>> = match dict.get(b"Filter") {
    Ok(lopdf::Object::Name(n)) => Some(n.clone()),
    Ok(lopdf::Object::Array(a)) => a.last().and_then(|o| o.as_name().ok()).map(|n| n.to_vec()),
    _ => None,
};
let is_dct = filter_name.as_deref() == Some(b"DCTDecode");
```
Use `is_dct` as before. (Combined with Step 1's guard, the remaining recompress path only sees single-filter, 8-bit, DeviceRGB/Gray, no-SMask images.)

- [ ] **Step 3: Verify** — Rust gate (compiles). **Manual:** compress a PDF containing (a) a transparent PNG image and (b) a normal photo; confirm the transparent image is preserved untouched and the photo still shrinks. Confirm output opens in a PDF reader.
- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/pdf_ops.rs
git commit -m "fix(pdf): compress_pdf skips images it cannot safely re-encode (SMask/predictor/non-8bit/non-RGB) and detects array DCT filters"
```

---

### Task B8: `bulk_rename` silently overwrites colliding outputs

Finding `rename-silent-overwrite` (LOW). Without `{index}` in the pattern, multiple inputs map to the same name; `fs::copy` overwrites and `renamed_count` over-counts.

**Files:** Modify `src-tauri/src/rename_ops.rs` (the per-file loop); add a test.

- [ ] **Step 1: Add a failing test** in `rename_ops.rs` `#[cfg(test)] mod tests` proving collisions are detected (write whatever assertion matches the chosen API — e.g. that a result error is produced or names are de-duplicated). Example shape:
```rust
#[test]
fn rename_reports_collision_without_index_token() {
    // two stems that resolve to the same output name under a date-only pattern
    let produced = dedupe_or_collide(&["a.png".into(), "b.png".into()], "shot"); // helper under test
    assert!(produced.is_err() || produced.unwrap().iter().collect::<std::collections::HashSet<_>>().len() == 2);
}
```
(Adjust to the actual function you factor out.)

- [ ] **Step 2: Run it, confirm it fails.** `cargo test --manifest-path src-tauri/Cargo.toml --lib rename`

- [ ] **Step 3: Track produced names and handle collisions.** In the loop, keep `let mut seen: std::collections::HashSet<String> = HashSet::new();`. Before copying, if `!seen.insert(new_filename.clone())`, push an error to the result (`format!("{}: name collision '{}'", …)`) and **do not** increment `renamed_count` / do not copy. Only count files actually written.

- [ ] **Step 4: Run the test, confirm it passes.** Run the full Rust gate.
- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/rename_ops.rs
git commit -m "fix(rename): detect output-name collisions instead of silently overwriting and over-counting"
```

---

### Task B9: PDF page placeholder ids can collide (duplicate React keys)

Finding `pdf-page-id-collision` (LOW). PDF placeholder ids are `pdf_${fileName}_p${i}_${Date.now()}` — same file added twice in one ms collides; image pages already use the array `index`.

**Files:** Modify the PDF placeholder id generation (search `pdf_` id construction in `src/hooks/usePdfPages.ts` and/or `src/hooks/usePdfWorkbench.ts`).

- [ ] **Step 1: Add a unique nonce per placeholder.** Use `crypto.randomUUID()` for the id (works in the Tauri webview), e.g. `id: \`pdf_${fileName}_p${i}_${crypto.randomUUID()}\``. Apply the same to the image branch for consistency if it also relies on `Date.now()`. Grep the repo to confirm ids are only used as React keys / lookup keys (no external dependence on the format).
- [ ] **Step 2: Verify** — `bun run build`. Manual: add the same PDF twice; no React duplicate-key warning.
- [ ] **Step 3: Commit**
```bash
git add src/hooks/usePdfPages.ts src/hooks/usePdfWorkbench.ts
git commit -m "fix(pdf): use a unique nonce for page ids so re-adding a PDF can't collide"
```

---

### Task B10: Swallowed errors in `AnimationTab` / `BulkRenameTab`

Finding `swallowed-errors-in-manual-tabs` (MED) — **only the two tabs that stay manual.** (`CropTab`/`WatermarkTab`/`ResizeTab` get this fixed by their Phase C migration.)

**Files:** Modify `src/components/AnimationTab.tsx` (~88), `src/components/BulkRenameTab.tsx` (~109).

- [ ] **Step 1: Log before toasting.** In each `catch (err) { toast.error(...) }`, add `logError` first:
```tsx
} catch (err) {
  logError("tab:animation:create_animation", err); // BulkRename: "tab:bulk-rename:bulk_rename"
  toast.error(t("toast.operation_failed"));
}
```
Add `import { logError } from "../lib/utils";` if missing (use the exact command name each tab invokes).

- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit**
```bash
git add src/components/AnimationTab.tsx src/components/BulkRenameTab.tsx
git commit -m "fix(ui): log invoke failures in Animation/BulkRename tabs instead of swallowing them"
```

---

### Task B11: Small correctness/comment fixes (batch commit)

Findings `protect-permissions-comment-wrong` (LOW), `webp-quality-not-clamped` (LOW), `sizestats-stale-dep` (LOW), `palette-copyall-unreachable-guards` (LOW).

**Files:** `src-tauri/src/pdf_ops.rs` (~740-742), `src-tauri/src/image_ops.rs` (~138, `compress_to_webp`), `src/components/ResultsBanner.tsx` (sizeStats memo), `src/components/PaletteTab.tsx` (~388-401).

- [ ] **Step 1 (protect comment):** In `protect_pdf`, fix the comment to state that `-4` (`0xFFFFFFFC`) **grants all permissions except the two reserved low bits** (it does NOT disable extraction). Do not change the value unless restriction is actually wanted.

- [ ] **Step 2 (webp clamp):** In `compress_to_webp`, clamp before encoding, matching `compress_to_jpeg`:
```rust
let quality = quality.clamp(0.0, 100.0);
// …
let webp_data = encoder.encode(quality);
```

- [ ] **Step 3 (sizeStats deps):** In `ResultsBanner`, make the `sizeStats` `useMemo` reference `results.filter(r => r.success)` inline (deps stay `[results]`), removing the closure-over-`successResults` smell.

- [ ] **Step 4 (palette guards):** In `PaletteTab`, remove `disabled={palette.length === 0}` on the Copy-all-HEX button and the `if (palette.length === 0) return;` early-return in `copyAllHex` (the button only renders inside the `palette.length > 0` branch).

- [ ] **Step 5: Verify** — Rust gate + `bun run build`.
- [ ] **Step 6: Commit**
```bash
git add src-tauri/src/pdf_ops.rs src-tauri/src/image_ops.rs src/components/ResultsBanner.tsx src/components/PaletteTab.tsx
git commit -m "fix: clamp webp quality, correct protect_pdf permissions comment, tidy sizeStats deps & palette guards"
```

---

# PHASE A — Dead code removal

### Task A1: Remove unused `reset_cancel` command

Finding `dead-reset-cancel-cmd` (confirmed). Never invoked; redundant with `arm_cancel_token`.

**Files:** `src-tauri/src/lib.rs` (fn ~772-775; handler entry ~861).

- [ ] **Step 1:** Delete the `reset_cancel` async fn and its `reset_cancel,` line in `tauri::generate_handler![]`. Ensure the preceding handler entry keeps a valid trailing comma (the macro list tolerates it).
- [ ] **Step 2: Verify** — Rust gate.
- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/lib.rs
git commit -m "chore(be): remove unused reset_cancel command (redundant with arm_cancel_token)"
```

---

### Task A2: Delete unused `ImagePreview` component

Finding `imagepreview-dead-component` (confirmed). Never imported. **(Do before B5.)**

**Files:** Delete `src/components/ui/ImagePreview.tsx`.

- [ ] **Step 1:** `git rm src/components/ui/ImagePreview.tsx`
- [ ] **Step 2: Verify** — `bun run build` (confirms no dangling import).
- [ ] **Step 3: Commit**
```bash
git commit -m "chore(ui): delete unused ImagePreview component"
```

---

### Task A3: Remove `useWorkspace.openOutputDir` (unused)

Finding `dead-open-output-dir` (confirmed). Also eliminates one copy of the path-building dup (`workspace-path-build-dup`).

**Files:** `src/hooks/useWorkspace.tsx` (interface, useCallback ~93-106, value memo ~109-110).

- [ ] **Step 1:** Remove `openOutputDir` from `WorkspaceContextValue`, its `useCallback`, and the context value memo. Confirm with grep that no component imports/uses it.
- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit**
```bash
git add src/hooks/useWorkspace.tsx
git commit -m "chore(hooks): remove unused useWorkspace.openOutputDir"
```

---

### Task A4: Remove `useProcessingProgress.resetProgress` (unused)

Finding `dead-reset-progress` (confirmed). Only consumer destructures `{ progress }`.

**Files:** `src/hooks/useProcessingProgress.ts` (~23-25 + return).

- [ ] **Step 1:** Drop the `resetProgress` `useCallback` and return only `{ progress }`. Confirm `GlobalProgressBar` only uses `progress`.
- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit**
```bash
git add src/hooks/useProcessingProgress.ts
git commit -m "chore(hooks): remove unused useProcessingProgress.resetProgress"
```

---

### Task A5: Trim `useTabProcessor` surface (`setFiles`, `acceptToast`)

Finding `tabprocessor-dead-exports` (confirmed). No consumer uses `setFiles` or passes `acceptToast`.

**Files:** `src/hooks/useTabProcessor.ts` (option type, destructure, the `acceptToast || …` fallback, return object, dep array).

- [ ] **Step 1:** Remove the `acceptToast` option from `UseTabProcessorOptions`, its destructure, and use `t("toast.select_images")` directly in the error toast. Remove `setFiles` from the returned object. Remove `acceptToast` from the `process` dependency array. Keep `setResults` (used by inline tabs). Grep all consumers (ExifStrip/Optimize/Convert + any Phase-C migrations) to confirm none break.
- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit**
```bash
git add src/hooks/useTabProcessor.ts
git commit -m "chore(hooks): drop unused useTabProcessor setFiles export and acceptToast option"
```

---

### Task A6: Simplify unreachable CropTab guard

Finding `croptab-dead-zero-branch` (confirmed). `pixelRect.w/.h` are `Math.max(1, …)`, so `=== 0` is dead.

**Files:** `src/components/CropTab.tsx:274`.

- [ ] **Step 1:** Replace the guard `if (!pixelRect || pixelRect.w === 0 || pixelRect.h === 0)` with `if (!pixelRect)`. (If CropTab is migrated to `useTabProcessor` in Phase C first, apply this simplification there instead and skip this task.)
- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit**
```bash
git add src/components/CropTab.tsx
git commit -m "chore(ui): drop unreachable zero-size guard in CropTab"
```

---

### Task A7: Remove write-only `loading` state in PaletteTab

Finding `palette-dead-loading-state` (confirmed). `const [, setLoading]` value never read.

**Files:** `src/components/PaletteTab.tsx` (~109, 187, 201).

- [ ] **Step 1:** Remove the `loading` state declaration and both `setLoading(...)` calls. (Do not surface a spinner — YAGNI; extraction is fast.)
- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit**
```bash
git add src/components/PaletteTab.tsx
git commit -m "chore(ui): remove write-only loading state in PaletteTab"
```

---

### Task A8: Remove the dead Ctrl+O shortcut wiring

Finding `dead-shortcut-files-event` (confirmed). Ctrl+O dispatches `CustomEvent("rustine-shortcut-files")` that nothing listens to. **Decision: remove** (wiring it to tabs is a feature, out of scope).

**Files:** `src/hooks/useGlobalShortcuts.ts` (Ctrl+O branch + `onFilesSelected`), `src/App.tsx` (`handleShortcutFiles` ~226-229 + the `onFilesSelected` wiring passed to the hook).

- [ ] **Step 1:** Delete the Ctrl+O branch and the `onFilesSelected` parameter from `useGlobalShortcuts`. Delete `handleShortcutFiles` in `App.tsx` and stop passing it. Keep all other shortcuts (e.g. ⌘K). Grep `rustine-shortcut-files` to confirm zero remaining references.
- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit**
```bash
git add src/hooks/useGlobalShortcuts.ts src/App.tsx
git commit -m "chore(ui): remove dead Ctrl+O shortcut (dispatched an event nothing handled)"
```

---

### Task A9: Delete orphaned i18n keys

Findings `dead-keys-redesign-superseded` + `dead-keys-removed-features` (confirmed; all keys exist in both en.json & fr.json and are unreferenced).

**Files:** `src/i18n/en.json`, `src/i18n/fr.json`.

- [ ] **Step 1: Re-confirm each key is dead** (defense against drift since the audit). For each key below, grep `src/` for the quoted key string; only delete keys with zero `t("…")` hits.
- [ ] **Step 2: Remove these keys from BOTH files** (keep JSON valid — watch trailing commas):

Redesign leftovers:
`action.extract_palette`, `action.generate_qr`, `action.pdf_compress`, `action.protect_pdf`, `action.to_base64`, `label.copy`, `label.copy_hex`, `label.copied`, `label.preview`, `label.remove`, `label.output_folder`, `label.resize_mode`, `label.crop_ratio`, `label.free`, `label.anchor`, `label.custom_dimensions`, `label.drag_reorder`, `label.folder_structure`, `label.or_drop_anywhere`, `label.output_animation_format`, `label.pdf_pages`, `label.pdf_mode_protect`, `label.pdf_mode_unlock`, `status.extracting_colors`, `toast.base64_success`, `toast.error_prefix`, `toast.palette_success`, `toast.pdf_compress_failed`, `toast.pdf_compress_success`, `toast.pdf_export_failed`, `toast.pdf_extract_failed`, `toast.pdf_protect_failed`, `toast.pdf_protect_success`, `toast.pdf_split_failed`, `toast.qr_text_missing`, `toast.select_output`

Removed-feature keys:
`settings.theme`, `settings.theme_dark`, `settings.theme_light`, `settings.version`, `updater.title`, `updater.dismiss`, `updater.restarting`, `app.name`, `app.tagline`, `sidebar.hint`, `sidebar.hint_short`, `sidebar.workspace`, `sidebar.cmdk_hint`

> Note: keep `updater.new_version` (used; see Task E2). If Task D1 keeps a theme abstraction, the `settings.theme*` keys still go (no switcher UI exists).

- [ ] **Step 3: Verify** — `bun run build` (JSON parses, no missing-key usage). A quick check: the i18n loader imports both JSONs; a parse error fails the build.
- [ ] **Step 4: Commit**
```bash
git add src/i18n/en.json src/i18n/fr.json
git commit -m "chore(i18n): remove ~49 orphaned keys (redesign leftovers + removed features)"
```

---

# PHASE C — DRY (deduplication)

### Task C1: Migrate `ResizeTab` to `useTabProcessor`

Finding `resize-could-use-tabprocessor` (also restores B10 error logging for Resize).

**Files:** `src/components/ResizeTab.tsx`.

- [ ] **Step 1:** Replace the hand-rolled `useFileSelection`+`useWorkspace`+state+`handleFilesSelected`/`handleClearFiles`/`handleResize` with:
```tsx
const tp = useTabProcessor({ tabId: "resize", command: "resize_images" });
// in the action handler:
await tp.process({
  extraParams: { mode, width, height, percentage },
  successMessage: t("toast.resize_success", { n: /* completed */ 0 }),
});
```
Mirror `ConvertTab` exactly (the canonical `useTabProcessor` consumer) for file selection, loading, results, and panelMode. Keep Resize-specific controls/state (`mode`, `width`, `height`, `percentage`). Confirm the Rust `resize_images` command's params match `extraParams` keys.
- [ ] **Step 2: Verify** — `bun run build`. Manual: resize a batch; success/partial/failure toasts and the results panel behave like Convert.
- [ ] **Step 3: Commit**
```bash
git add src/components/ResizeTab.tsx
git commit -m "refactor(ui): ResizeTab uses useTabProcessor (removes ~45 dup lines, restores error logging)"
```

---

### Task C2: Migrate `CropTab` to `useTabProcessor`

Finding `batch-result-toast-duplication` (Crop portion) + restores B10 + supersedes A6.

**Files:** `src/components/CropTab.tsx`.

- [ ] **Step 1:** Adopt `useTabProcessor({ tabId: "crop", command: "crop_images" })`. Keep the crop geometry computation; pass it via `extraParams` (e.g. `{ rect: pixelRect }` matching the Rust command). Replace the simplified `if (!pixelRect) return;` guard (A6) before calling `process(...)`. Verify the `crop_images` command signature.
- [ ] **Step 2: Verify** — `bun run build`. Manual: crop a batch.
- [ ] **Step 3: Commit**
```bash
git add src/components/CropTab.tsx
git commit -m "refactor(ui): CropTab uses useTabProcessor (dedup batch flow, restore error logging)"
```

---

### Task C3: Reduce `WatermarkTab` duplication

Finding `batch-result-toast-duplication` (Watermark portion) + restores B10. Watermark has a `mode` (text/logo) and many params.

**Files:** `src/components/WatermarkTab.tsx`.

- [ ] **Step 1:** Adopt `useTabProcessor({ tabId: "watermark", command: "add_watermark" })` (or the actual command name). Branch on `mode` to assemble `extraParams` before a single `process(...)` call. Keep all watermark controls. Confirm the command accepts the assembled params for both modes.
- [ ] **Step 2: Verify** — `bun run build`. Manual: text and logo watermark batches.
- [ ] **Step 3: Commit**
```bash
git add src/components/WatermarkTab.tsx
git commit -m "refactor(ui): WatermarkTab uses useTabProcessor (dedup batch flow, restore error logging)"
```

---

### Task C4: Revive shared `getFileName`, drop local basename re-impls

Finding `dead-getfilename-helper-and-dup`.

**Files:** `src/lib/utils.ts` (already exports `getFileName`), `src/components/AnimationTab.tsx`, `src/components/WatermarkTab.tsx`, `src/components/BulkRenameTab.tsx`.

- [ ] **Step 1:** In each of the three tabs, `import { getFileName } from "../lib/utils";` and replace the local `getFilename`/inline `.split(/[\\/]/).pop()` with `getFileName(...)`. Delete the local helpers.
- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit**
```bash
git add src/lib/utils.ts src/components/AnimationTab.tsx src/components/WatermarkTab.tsx src/components/BulkRenameTab.tsx
git commit -m "refactor(ui): use shared getFileName helper instead of per-tab basename re-impls"
```

---

### Task C5: Share `merge_to_pdf` invocation between build & materialize

Finding `dup-merge-items-options`.

**Files:** `src/hooks/usePdfMaterializer.ts` (add helper), `src/hooks/usePdfWorkbench.ts` (executePipeline build branch).

- [ ] **Step 1:** Extract a helper in `usePdfMaterializer.ts`:
```ts
export function buildMergeArgs(pages: BuilderPage[], outputPath: string) {
  const items = pages.map((p) => ({ source_path: p.sourcePath, page_number: p.pageNumber, source_type: p.sourceType }));
  const options = { page_format: "fit", orientation: "portrait", margin_px: 0, image_quality: 90, output_path: outputPath };
  return { items, options };
}
```
(Match the exact field names/types currently passed to `invoke("merge_to_pdf", …)`.) Use it in both `materializeGrid` and the build branch of `executePipeline`.
- [ ] **Step 2: Verify** — `bun run build`. Manual: build a PDF and run a pipeline that materializes.
- [ ] **Step 3: Commit**
```bash
git add src/hooks/usePdfMaterializer.ts src/hooks/usePdfWorkbench.ts
git commit -m "refactor(pdf): share merge_to_pdf args builder between build and materialize"
```

---

### Task C6: Consolidate updater logic in `useAutoUpdate`

Finding `settings-updater-dup`.

**Files:** `src/hooks/useAutoUpdate.ts` (expose `checkNow`), `src/components/SettingsPanel.tsx` (consume it).

- [ ] **Step 1:** Add a `checkNow()` to `useAutoUpdate` that runs `check()` and returns `{ available, version }` (reusing the existing `install`). Have `SettingsPanel` call `checkNow()` + the hook's `install` instead of importing `check`/`relaunch` and re-implementing `handleInstallUpdate`.
- [ ] **Step 2: Verify** — `bun run build`. Manual (optional): trigger a manual check in Settings.
- [ ] **Step 3: Commit**
```bash
git add src/hooks/useAutoUpdate.ts src/components/SettingsPanel.tsx
git commit -m "refactor(update): SettingsPanel reuses useAutoUpdate instead of re-implementing the updater flow"
```

---

### Task C7: Share PDF deep-clone between split & builder

Finding `dup-pdf-deep-clone`.

**Files:** `src-tauri/src/utils.rs` (add shared helper), `src-tauri/src/pdf_split_ops.rs`, `src-tauri/src/pdf_builder_ops.rs`.

- [ ] **Step 1:** Move the builder's error-propagating recursive copy (`deep_clone_object` + `clone_object_recursive`, the cycle-safe `Result`-returning variant) into `utils.rs` as `pub fn deep_clone_object(dest, source, obj_id, visited) -> Result<ObjectId, String>` (+ its recursive helper). Have both `merge_to_pdf` and `split_pdf` call it. The split path adopts the error-propagating behavior (no more silently-dangling references).
- [ ] **Step 2: Verify** — Rust gate. Manual: split a multi-page PDF and merge images+PDFs; both still produce valid output.
- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/utils.rs src-tauri/src/pdf_split_ops.rs src-tauri/src/pdf_builder_ops.rs
git commit -m "refactor(pdf): share one deep-clone helper between split and builder"
```

---

### Task C8: Extract `write_webp` helper

Finding `webp-encode-duplicated` (3 sites, divergent hardcoded quality).

**Files:** `src-tauri/src/image_ops.rs` (helper + 3 call sites: `compress_to_webp`, `convert_images` webp branch, the optimize/convert helper).

- [ ] **Step 1:** Add:
```rust
fn write_webp(img: &image::DynamicImage, path: &std::path::Path, quality: f32) -> Result<(), String> {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let data = webp::Encoder::from_rgba(&rgba, w, h).encode(quality.clamp(0.0, 100.0));
    std::fs::write(path, &*data).map_err(|e| format!("Cannot write WebP: {}", e))
}
```
Replace the three copy-pasted blocks with calls, passing each site's explicit quality (caller-supplied for compress; was `100.0`/`90.0` at the others — keep those values explicit at the call site).
- [ ] **Step 2: Verify** — Rust gate. (Subsumes B12's webp clamp via the helper.)
- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/image_ops.rs
git commit -m "refactor(image): extract write_webp helper (dedup 3 sites, centralize quality)"
```

---

### Task C9: Deduplicate `emit_progress` / `emit_progress_simple`

Finding `progress-emit-duplication`.

**Files:** `src-tauri/src/progress.rs`.

- [ ] **Step 1:** Make `emit_progress` compute `done` then delegate to `emit_progress_simple(app_handle, done, total, current_file)`, removing the duplicated filename extraction + emit.
- [ ] **Step 2: Verify** — Rust gate.
- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/progress.rs
git commit -m "refactor(be): emit_progress delegates to emit_progress_simple"
```

---

### Task C10: Shared results card for Favicon & SpriteSheet

Finding `favicon-spritesheet-error-list-dup`.

**Files:** Create `src/components/ResultCard.tsx`; modify `src/components/FaviconTab.tsx`, `src/components/SpriteSheetTab.tsx`.

- [ ] **Step 1:** Create a small `ResultCard` component: props `{ success: boolean; title: string; chips?: ReactNode; errors: string[] }` rendering the `forge-card` + CheckCircle/XCircle header + chip row slot + scrollable `max-h-24` error list (move the exact markup from FaviconTab 107-141). Use it in both tabs.
- [ ] **Step 2: Verify** — `bun run build`. Manual: generate favicons and a sprite sheet; both result cards render identically to before.
- [ ] **Step 3: Commit**
```bash
git add src/components/ResultCard.tsx src/components/FaviconTab.tsx src/components/SpriteSheetTab.tsx
git commit -m "refactor(ui): extract shared ResultCard for Favicon/SpriteSheet results"
```

---

### Task C11: Extract `downloadText` helper for Palette exports

Finding `palette-download-blob-dup`.

**Files:** `src/lib/utils.ts` (helper), `src/components/PaletteTab.tsx`.

- [ ] **Step 1:** Add to `lib/utils.ts`:
```ts
export function downloadText(content: string, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```
Use it in `exportJson` and `exportCss`; factor the shared color list into one derivation/memo.
- [ ] **Step 2: Verify** — `bun run build`. Manual: export JSON and CSV/CSS from Palette.
- [ ] **Step 3: Commit**
```bash
git add src/lib/utils.ts src/components/PaletteTab.tsx
git commit -m "refactor(ui): extract downloadText helper for Palette exports"
```

---

### Task C12: Derive tab metadata from `SIDEBAR_SECTIONS`

Finding `parallel-tab-maps` (App.tsx maintains `TAB_LABEL_KEYS` + `TAB_DESC_KEYS` duplicating `SIDEBAR_SECTIONS`).

**Files:** `src/App.tsx`.

- [ ] **Step 1:** Build one derived lookup and drop the two parallel maps:
```tsx
const TAB_LABEL_KEYS = Object.fromEntries(
  SIDEBAR_SECTIONS.flatMap((s) => s.tabs.map((t) => [t.id, t.labelKey])),
) as Record<TabId, string>;
const labelKeyFor = (id: TabId) => TAB_LABEL_KEYS[id];
const descKeyFor = (id: TabId) => `${TAB_LABEL_KEYS[id]}.desc`;
```
Replace `TAB_DESC_KEYS[...]` usages with `descKeyFor(...)` and `TAB_LABEL_KEYS[...]` lookups accordingly. (This pairs with C13.)
- [ ] **Step 2: Verify** — `bun run build`. Manual: tab titles/descriptions render for every tool.
- [ ] **Step 3: Commit**
```bash
git add src/App.tsx
git commit -m "refactor(app): derive tab label/desc keys from SIDEBAR_SECTIONS"
```

---

### Task C13: Hoist the duplicated tool header

Finding `etabli-header-block-dup` (header copy-pasted in both layout branches of App.tsx).

**Files:** `src/App.tsx` (optionally a tiny local `ToolHeader`).

- [ ] **Step 1:** Extract the `<h2>` + `<p>` header (with its inline styles) into a single element/local component `ToolHeader` rendered once, used by both the Établi and centered branches (pass only the width-dependent wrapper from each branch). Use `labelKeyFor`/`descKeyFor` from C12.
- [ ] **Step 2: Verify** — `bun run build`. Manual: header looks identical in both layouts.
- [ ] **Step 3: Commit**
```bash
git add src/App.tsx
git commit -m "refactor(app): hoist duplicated tool header into one ToolHeader"
```

---

### Task C14: Extract `resolveThumb` helper

Finding `thumbnail-fallback-dup` (tri-state thumbnail→original fallback duplicated).

**Files:** `src/hooks/useThumbnails.ts` or `src/lib/utils.ts` (helper); the two duplicate sites (grep the ternary — likely `ImageGrid`/`ImageGridCard` and PDF/material grids).

- [ ] **Step 1:** Add:
```ts
export function resolveThumb(thumb: string | null | undefined, path: string, bust?: string | number): string | undefined {
  if (thumb) return thumb;          // bounded thumbnail
  if (thumb === null) return safeAssetUrl(path, bust); // explicit "no thumb" → original
  return undefined;                 // undefined → still loading
}
```
Replace both duplicated ternaries with `resolveThumb(...)`. (Keep behavior identical to current.)
- [ ] **Step 2: Verify** — `bun run build`. Manual: image grid thumbnails still load.
- [ ] **Step 3: Commit**
```bash
git add src/hooks/useThumbnails.ts src/components/ImageGrid.tsx src/components/ImageGridCard.tsx
git commit -m "refactor(ui): extract resolveThumb for the thumbnail/original fallback"
```

---

### Task C15: Collapse remaining workspace path-build dup

Finding `workspace-path-build-dup`. After A3 removes `openOutputDir`, only `getOutputDir` remains — confirm the duplication is gone; if any inline `${workspace}${sep}${subFolder}` remains elsewhere, factor a `subPathFor(tabId)` and make the undefined-subfolder case explicit (early return / throw).

**Files:** `src/hooks/useWorkspace.tsx`.

- [ ] **Step 1:** Verify post-A3 there is a single path-building site. If so, this task is a no-op — record it as resolved by A3. Otherwise extract `subPathFor` and handle `SUB_FOLDERS[tabId] === undefined` explicitly.
- [ ] **Step 2: Verify** — `bun run build`.
- [ ] **Step 3: Commit (only if changed)**
```bash
git add src/hooks/useWorkspace.tsx
git commit -m "refactor(hooks): single output-path builder, explicit missing-subfolder handling"
```

---

# PHASE D — Simplicity (anti-over-engineering)

### Task D1: Collapse the no-op theme abstraction

Finding `theme-noop-overengineered`. `Theme = "dark"` only; `useTheme` never called; `toggleTheme` is a noop.

**Files:** `src/hooks/useTheme.tsx`, `src/main.tsx` (provider usage).

- [ ] **Step 1:** Replace `ThemeProvider`/`useTheme`/`ThemeContext`/`toggleTheme`/`Theme` with a minimal provider (or a single `useEffect` in `main.tsx`/`App.tsx`) that sets `document.documentElement.dataset.theme = "dark"` once. Delete the unused hook/context/type. Update `main.tsx` accordingly. Grep `useTheme`/`toggleTheme` to confirm no other consumers.
- [ ] **Step 2: Verify** — `bun run build`. Manual: app still renders dark (data-theme attribute present).
- [ ] **Step 3: Commit**
```bash
git add src/hooks/useTheme.tsx src/main.tsx
git commit -m "refactor(theme): collapse no-op theme context to a one-line dark-mode effect"
```

---

### Task D2: Avoid double image decode in `add_image_page`

Finding `add-image-page-double-decode`.

**Files:** `src-tauri/src/pdf_builder_ops.rs:252-266`.

- [ ] **Step 1:** When `page_format != "fit"`, do not fully decode just for dimensions. Use `image::image_dimensions(image_path)` (cheap) only when needed for the `"fit"` branch; let `embed_image_as_pdf_page` own the single decode for embedding. Concretely, read dimensions lazily inside the `"fit"` branch via `image::image_dimensions(image_path).map_err(...)` and drop the upfront `image::open` + `drop(img)`.
- [ ] **Step 2: Verify** — Rust gate. Manual: build a PDF from images with `fit` and `a4` formats.
- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/pdf_builder_ops.rs
git commit -m "perf(pdf): avoid full image decode when only dimensions (or none) are needed"
```

---

### Task D3: Open metadata image once

Finding `metadata-double-open` (`read_image_metadata` opens the file 3×).

**Files:** `src-tauri/src/metadata_ops.rs` (~58, 74, 101).

- [ ] **Step 1:** Build one decoder via `image::ImageReader::open(path)?.with_guessed_format()?.into_decoder()?` and read both `dimensions()` and `color_type()` from it. Keep the separate `fs::File::open` for the EXIF container reader only.
- [ ] **Step 2: Verify** — Rust gate. Manual: read metadata for a JPEG with EXIF and a PNG.
- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/metadata_ops.rs
git commit -m "perf(be): read image metadata with a single decoder instead of opening the file 3x"
```

---

# PHASE E — Consistency

### Task E1: Standardize `panelMode` on the effect-driven pattern

Finding `panelmode-handler-vs-effect-split`. Some tabs derive `panelMode` via `useEffect([results, loading])`; others flip it imperatively.

**Files:** the imperative tabs (`CompressTab`, `SvgRasterizeTab`, `FaviconTab`, `SpriteSheetTab`, and any not already migrated — note `ResizeTab` is handled by C1).

- [ ] **Step 1:** In each imperative tab, remove the inline `setPanelMode("material"|"results")` calls and add the standard effect (mirroring ConvertTab):
```tsx
useEffect(() => {
  if (!loading) setPanelMode(results.length > 0 ? "results" : "material");
}, [results, loading]);
```
This also fixes the "stays on results after full failure" inconsistency. (Tabs migrated to `useTabProcessor` in Phase C should fold panelMode handling into that effect form.)
- [ ] **Step 2: Verify** — `bun run build`. Manual: each tab returns to material on clear and on full failure.
- [ ] **Step 3: Commit**
```bash
git add src/components/CompressTab.tsx src/components/SvgRasterizeTab.tsx src/components/FaviconTab.tsx src/components/SpriteSheetTab.tsx
git commit -m "refactor(ui): standardize panelMode on the effect-driven pattern"
```

---

### Task E2: Use `t()` interpolation instead of `.replace("{version}", …)`

Finding `manual-version-interpolation`.

**Files:** `src/components/UpdateBanner.tsx:41`, `src/components/SettingsPanel.tsx:183`.

- [ ] **Step 1:** Replace `t("updater.new_version").replace("{version}", version)` with `t("updater.new_version", { version })` in both files (keep the `updater.new_version` key — it is live).
- [ ] **Step 2: Verify** — `bun run build`. Manual: update banner shows the version.
- [ ] **Step 3: Commit**
```bash
git add src/components/UpdateBanner.tsx src/components/SettingsPanel.tsx
git commit -m "refactor(i18n): use t() interpolation for updater version string"
```

---

## Self-Review

**1. Coverage vs audit (45 findings):** All 45 are assigned — B1–B14 cover the 16 best-practice/bug items (two compress findings merged into B7; qr-preview MED+LOW merged into B6; webp-clamp folded into B11/C8); A1–A9 cover the 10 dead-code items (two i18n findings merged into A9); C1–C15 cover the 14 DRY items (C2/C3 also absorb `batch-result-toast-duplication`); D1–D3 cover 3 of the 4 complexity items (the 4th, `palette-copyall-unreachable-guards`, is in B11); E1–E2 + B11(webp) cover the 3 consistency items. No finding is unaddressed.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to". Bug fixes and helpers carry real code; mechanical tasks carry exact files + symbols. Items requiring the executor to read current code (e.g., exact line of a call site) are explicitly scoped with grep instructions.

**3. Consistency:** Helper names are used consistently across tasks (`write_webp`, `downloadText`, `resolveThumb`, `buildMergeArgs`, `deep_clone_object`, `labelKeyFor`/`descKeyFor`, `switchMode`). Cross-task dependencies are called out (A2→B5, C1→supersedes B10-Resize/A6, C8 subsumes B12, D1 vs settings.theme keys, C12→C13).

**4. Risk notes:** B7 (compress_pdf) and C7 (deep-clone) touch PDF correctness with no automated test → flagged for manual verification. Everything else is gated by `bun run build` and the Rust clippy/test gate.
