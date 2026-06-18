# Flint — AVIF Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add AVIF as an output format in the Compress and Convert tools (encode only), via the `image` crate's pure-Rust `avif` (ravif) encoder.

**Architecture:** Enable the `image` `avif` feature; add a `compress_to_avif` backend function + `compress_avif` command and an `avif` arm in `convert_images`; expose AVIF in the two tabs' format selectors.

**Tech Stack:** Rust (`image` 0.25 `avif` feature → `ravif`/`rav1e`), React/TS.

**Spec:** `docs/superpowers/specs/2026-06-18-flint-avif-output-design.md`

**Verification:** `cargo fmt && cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml --lib`; then `bun run build`. (First Rust build will compile `rav1e` — slower than usual; expected.)

---

### Task 1: Backend — enable AVIF and add the encode paths

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/image_ops.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Enable the `image` `avif` feature**

In `src-tauri/Cargo.toml`, change:
```toml
image = "0.25.9"
```
to:
```toml
image = { version = "0.25.9", features = ["avif"] }
```
(Do NOT add the `nasm` feature — keep `rav1e` pure-Rust.)

- [ ] **Step 2: Add the AVIF speed constant + `compress_to_avif` in `image_ops.rs`**

Add a module-level constant near the top of `image_ops.rs` (after the existing `use`/const lines):
```rust
/// AVIF encode speed (1 = slowest/smallest … 10 = fastest/largest). 6 balances
/// encode time against file size for batch use.
const AVIF_SPEED: u8 = 6;
```

Add this function right after `compress_to_jpeg` (mirrors its shape):
```rust
pub fn compress_to_avif(
    input_paths: Vec<String>,
    quality: u8,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    let quality = quality.clamp(1, 100);

    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;
            let rgba = img.to_rgba8(); // AVIF supports alpha

            let stem = file_stem(input_path);
            let output_path = out_dir.join(format!("{}-compressed.avif", stem));

            let mut buf: Vec<u8> = Vec::new();
            rgba.write_with_encoder(image::codecs::avif::AvifEncoder::new_with_speed_quality(
                &mut buf, AVIF_SPEED, quality,
            ))
            .map_err(|e| format!("Cannot encode AVIF: {}", e))?;
            fs::write(&output_path, &buf).map_err(|e| format!("Cannot write AVIF file: {}", e))?;

            Ok((output_path.to_string_lossy().to_string(), None))
        },
    )
}
```

- [ ] **Step 3: Add the `avif` arm to `convert_images`**

In `image_ops.rs::convert_images`, inside the `match target_format.as_str()` block, add this arm (e.g. right after the `"webp"` arm):
```rust
"avif" => {
    let output_path = out_dir.join(format!("{}-converted.avif", stem));
    let rgba = img.to_rgba8();
    let mut buf: Vec<u8> = Vec::new();
    rgba.write_with_encoder(image::codecs::avif::AvifEncoder::new_with_speed_quality(
        &mut buf, AVIF_SPEED, 80,
    ))
    .map_err(|e| format!("Cannot encode AVIF: {}", e))?;
    fs::write(&output_path, &buf).map_err(|e| format!("Cannot write AVIF: {}", e))?;
    output_path.to_string_lossy().to_string()
}
```

- [ ] **Step 4: Add the `compress_avif` Tauri command in `lib.rs`**

After `compress_jpeg` (around line 241), add:
```rust
#[tauri::command]
async fn compress_avif(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    quality: u8,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::compress_to_avif(input_paths, quality, output_dir, app_handle, cancel)
    })
    .await
}
```
Then add `compress_avif,` to the `tauri::generate_handler![...]` list (next to `compress_jpeg`).

- [ ] **Step 5: Verify backend**

Run: `cargo fmt && cargo test --manifest-path src-tauri/Cargo.toml --lib && cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings`
Expected: compiles (first build downloads + compiles `rav1e`, slow but succeeds), tests pass, clippy clean. If clippy reports `os error 32` on `pdfium.dll`, that's a running `tauri dev` lock — `cargo test --lib` already proved compilation.

---

### Task 2: Frontend — expose AVIF in the format selectors

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/CompressTab.tsx`
- Modify: `src/components/ConvertTab.tsx`

- [ ] **Step 1: Add `"avif"` to the `OutputFormat` union**

In `src/types.ts`, change:
```ts
export type OutputFormat = "png" | "jpg" | "webp" | "bmp" | "ico" | "tiff";
```
to:
```ts
export type OutputFormat = "png" | "jpg" | "webp" | "bmp" | "ico" | "tiff" | "avif";
```

- [ ] **Step 2: Add AVIF to CompressTab**

In `src/components/CompressTab.tsx`:
- Change the type:
```ts
type CompressFormat = "webp" | "jpeg" | "avif";
```
- Change the command dispatch (currently `const command = format === "webp" ? "compress_webp" : "compress_jpeg";`) to:
```ts
const command =
  format === "webp" ? "compress_webp" : format === "jpeg" ? "compress_jpeg" : "compress_avif";
```
- Change the format toggle list (currently `(["webp", "jpeg"] as CompressFormat[])`) to:
```tsx
{(["webp", "jpeg", "avif"] as CompressFormat[]).map((f) => (
```

- [ ] **Step 3: Add AVIF to ConvertTab**

In `src/components/ConvertTab.tsx`:
- Add an entry to `FORMAT_OPTIONS` (after the `webp` entry):
```ts
{ value: "avif", label: "AVIF" },
```
- Add an entry to `FORMAT_INFO`:
```ts
avif: { typeKey: "format.lossy", alpha: true },
```

- [ ] **Step 4: Verify frontend**

Run: `bun run build`
Expected: `tsc` passes (the `OutputFormat` union now includes `"avif"`, so both tabs type-check) and the build succeeds.

- [ ] **Step 5: Manual smoke test**

In `tauri dev`: Compress a transparent PNG to AVIF (quality slider applies) and Convert a JPEG to AVIF. Confirm `.avif` files are produced, render in the before/after preview, and are smaller than the source. Encoding is slower than WebP/JPEG — expected.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/image_ops.rs src-tauri/src/lib.rs src/types.ts src/components/CompressTab.tsx src/components/ConvertTab.tsx
git commit -m "feat(image): AVIF output in Compress and Convert"
```
(End the commit body with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Committing `Cargo.toml` is authorized for this change.)

---

## Self-Review

**1. Spec coverage:** `avif` feature enabled (T1S1); `compress_to_avif` + speed 6 + quality slider (T1S2, T2S2); convert avif arm @ q80 (T1S3); `compress_avif` command registered (T1S4); `OutputFormat` + both tabs (T2); no new i18n keys (toggle renders name, Convert reuses `format.lossy`); manual preview check (T2S5). Covered.

**2. Placeholder scan:** All code steps are complete; the only `[...]` is the existing `generate_handler!` list. No TBD.

**3. Type/name consistency:** `compress_to_avif`(image_ops) ↔ called by `compress_avif`(lib.rs) ↔ invoked as `"compress_avif"`(CompressTab). `AVIF_SPEED` defined once, used in compress + convert. `OutputFormat` adds `"avif"` and `FORMAT_OPTIONS`/`FORMAT_INFO`/`CompressFormat` all use it consistently. `AvifEncoder::new_with_speed_quality(w, speed, quality)` matches the verified image 0.25 API.
