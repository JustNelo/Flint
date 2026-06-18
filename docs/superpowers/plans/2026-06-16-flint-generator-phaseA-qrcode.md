# Flint — Generator Tools Phase A: QR Code (live preview) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Redesign the QR Code tool into a 2-column "content → live preview" layout: the QR redraws live as you type/resize (new base64 backend command, no file), and "Enregistrer PNG" / "copier" are explicit actions.

**Architecture:** Refactor `qr_ops.rs` to extract `build_qr_image` (shared by the existing file-saving `generate_qr` and a new `generate_qr_base64` that returns base64 PNG, no file). Add a `generate_qr_preview` Tauri command (async → run_blocking → qr_ops, no path validation — input is text not a path). Rewrite `QrCodeTab` into a 2-pane layout that calls the preview command (debounced) for the live image and the existing `generate_qr_cmd` for saving. The tool stays in App.tsx's centered branch (not ETABLI_TOOLS).

**Tech Stack:** Rust (image, qrcode, base64 crates — all already deps), React 19, Tauri invoke. Verification: Rust `cargo clippy -- -D warnings` + `cargo test`; frontend `bunx prettier --check` + `bun run build`; manual visual check.

**Reference:** spec `docs/superpowers/specs/2026-06-16-flint-generator-tools-design.md` §3.1.

---

### Task 1: Backend — `generate_qr_base64` + `generate_qr_preview` command

**Files:**
- Modify: `src-tauri/src/qr_ops.rs` (extract `build_qr_image`, add `generate_qr_base64`, add a test)
- Modify: `src-tauri/src/lib.rs` (add the `generate_qr_preview` command + register it)

- [ ] **Step 1: Write the failing test**

Append this test module to the END of `src-tauri/src/qr_ops.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_qr_base64_produces_png() {
        let b64 = generate_qr_base64("https://flint.app", 256).expect("should encode");
        assert!(!b64.is_empty());
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .expect("valid base64");
        // PNG magic number
        assert_eq!(&bytes[0..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    }
}
```

This requires `use base64::Engine;` in scope for `.decode`; add it inside the test or rely on the module-level `use` added in Step 3. To keep the test self-contained, add `use base64::Engine;` as the first line inside `generate_qr_base64_produces_png`.

- [ ] **Step 2: Run the test to verify it fails**

Run (from `src-tauri/`): `cargo test --lib generate_qr_base64_produces_png`
Expected: FAILS to compile — `cannot find function generate_qr_base64`.

- [ ] **Step 3: Implement — refactor + new function**

In `src-tauri/src/qr_ops.rs`, update the imports at the top to:

```rust
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;

use crate::utils::ensure_output_dir;
```

Add this helper ABOVE `generate_qr` (it holds the pixel-building logic extracted verbatim from the current `generate_qr`):

```rust
/// Build the QR code image (white background, dark modules) for `text` at `size` px.
fn build_qr_image(text: &str, size: u32) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
    let code = QrCode::new(text.as_bytes()).map_err(|e| format!("QR encoding failed: {}", e))?;

    let module_count = code.width() as u32;
    let module_size = (size / (module_count + 8)).max(1);
    let margin = (size.saturating_sub(module_count * module_size)) / 2;
    let img_size = module_count * module_size + margin * 2;

    let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_pixel(img_size, img_size, Rgba([255, 255, 255, 255]));
    let dark = Rgba([30, 30, 30, 255]);

    for (y, row) in code.to_colors().chunks(module_count as usize).enumerate() {
        for (x, &color) in row.iter().enumerate() {
            if color == qrcode::Color::Dark {
                let px = margin + (x as u32) * module_size;
                let py = margin + (y as u32) * module_size;
                for dy in 0..module_size {
                    for dx in 0..module_size {
                        if px + dx < img_size && py + dy < img_size {
                            img.put_pixel(px + dx, py + dy, dark);
                        }
                    }
                }
            }
        }
    }

    Ok(img)
}
```

Replace the body of `generate_qr` so it uses the helper (everything else in the function unchanged):

```rust
pub fn generate_qr(text: &str, size: u32, output_dir: &str) -> QrResult {
    let mut result = QrResult {
        output_path: String::new(),
        size,
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    let img = match build_qr_image(text, size) {
        Ok(img) => img,
        Err(e) => {
            result.errors.push(e);
            return result;
        }
    };

    let output_path = out_dir.join("qrcode.png");
    match img.save(&output_path) {
        Ok(_) => {
            result.output_path = output_path.to_string_lossy().to_string();
        }
        Err(e) => {
            result.errors.push(format!("Cannot save QR image: {}", e));
        }
    }

    result
}
```

Add the new base64 function below `generate_qr`:

```rust
/// Generate a QR code PNG and return it as a base64 string (no file written) — for live preview.
pub fn generate_qr_base64(text: &str, size: u32) -> Result<String, String> {
    use base64::Engine;
    let img = build_qr_image(text, size)?;
    let mut buf: Vec<u8> = Vec::new();
    DynamicImage::ImageRgba8(img)
        .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `src-tauri/`): `cargo test --lib generate_qr_base64_produces_png`
Expected: PASS (1 passed).

- [ ] **Step 5: Add the Tauri command + register it**

In `src-tauri/src/lib.rs`, add this command near the other QR command (`generate_qr_cmd`):

```rust
#[tauri::command]
async fn generate_qr_preview(text: String, size: u32) -> Result<String, String> {
    run_blocking(move || qr_ops::generate_qr_base64(&text, size)).await?
}
```

Add `generate_qr_preview,` to the `tauri::generate_handler![...]` list (next to `generate_qr_cmd`).

- [ ] **Step 6: Verify clippy + tests + fmt**

Run (from `src-tauri/`): `cargo fmt && cargo clippy -- -D warnings && cargo test --lib`
Expected: clippy exit 0 (no warnings); all tests pass.
Note: if `cargo clippy` fails with an `os error 32` file-lock on `pdfium.dll`, that's the running dev app holding the DLL — stop `tauri dev` (or rely on the lib clippy from a clean state); it is not a code error.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/qr_ops.rs src-tauri/src/lib.rs
git commit -m "feat(qr): generate_qr_base64 + generate_qr_preview command (live preview)"
```

---

### Task 2: Frontend — rewrite `QrCodeTab` into the 2-pane live layout

**Files:**
- Modify: `src/components/QrCodeTab.tsx`
- Modify: `src/i18n/en.json`, `src/i18n/fr.json`

- [ ] **Step 1: Add i18n keys**

en.json:
```json
"label.qr_preview": "Preview",
"action.save_qr": "Save PNG",
"action.copy_image": "Copy",
"toast.qr_copied": "QR code copied to clipboard",
"toast.copy_failed": "Copy failed"
```
fr.json:
```json
"label.qr_preview": "Aperçu",
"action.save_qr": "Enregistrer le PNG",
"action.copy_image": "Copier",
"toast.qr_copied": "QR code copié dans le presse-papier",
"toast.copy_failed": "Échec de la copie"
```
(If any key already exists, keep the existing one and skip the duplicate.)

- [ ] **Step 2: Replace the entire `src/components/QrCodeTab.tsx` with:**

```tsx
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QrCode, FolderOpen, Copy } from "lucide-react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ActionButton } from "./ui/ActionButton";
import { useWorkspace } from "../hooks/useWorkspace";
import { useHistory } from "../hooks/useHistory";
import { useT } from "../i18n/i18n";
import { logError } from "../lib/utils";

interface QrResult {
  output_path: string;
  size: number;
  errors: string[];
}

const SIZE_OPTIONS = [256, 512, 1024, 2048];

const PANEL: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--bg-border)",
  background: "var(--bg-elevated)",
  padding: 14,
};

export function QrCodeTab() {
  const { t } = useT();
  const { getOutputDir } = useWorkspace();
  const { addEntry } = useHistory();
  const [text, setText] = useState("");
  const [size, setSize] = useState(512);
  const [previewB64, setPreviewB64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<QrResult | null>(null);

  const content = text.trim();

  // Live preview — debounced, no file written (generate_qr_preview returns base64).
  useEffect(() => {
    if (!content) {
      setPreviewB64(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      invoke<string>("generate_qr_preview", { text: content, size })
        .then((b64) => {
          if (!cancelled) setPreviewB64(b64);
        })
        .catch((err) => {
          if (!cancelled) {
            logError("qr:preview", err);
            setPreviewB64(null);
          }
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [content, size]);

  const previewSrc = previewB64 ? `data:image/png;base64,${previewB64}` : null;

  const handleSave = useCallback(async () => {
    if (!content) return;
    const outputDir = await getOutputDir("qrcode");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const res = await invoke<QrResult>("generate_qr_cmd", { text: content, size, outputDir });
      setResult(res);
      addEntry({
        tabId: "qrcode",
        filesCount: 1,
        successCount: res.output_path ? 1 : 0,
        failCount: res.errors.length,
        outputDir,
      });
      if (res.output_path && res.errors.length === 0) {
        toast.success(t("toast.qr_success"));
      } else {
        toast.error(t("toast.all_failed"));
      }
    } catch (err) {
      logError("qr:save", err);
      toast.error(t("toast.operation_failed"));
    } finally {
      setSaving(false);
    }
  }, [content, size, getOutputDir, addEntry, t]);

  const handleCopy = useCallback(async () => {
    if (!previewB64) return;
    try {
      const res = await fetch(`data:image/png;base64,${previewB64}`);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success(t("toast.qr_copied"));
    } catch (err) {
      logError("qr:copy", err);
      toast.error(t("toast.copy_failed"));
    }
  }, [previewB64, t]);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {/* Left — content + size */}
      <section className="flex-1 min-w-0" style={PANEL}>
        <div className="space-y-1.5">
          <label className="forge-label">{t("label.qr_content")}</label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            placeholder={t("label.qr_placeholder")}
            rows={4}
            className="forge-textarea"
            style={{ resize: "none" }}
          />
          <div className="flex justify-end">
            <span className="forge-hint">{t("label.chars_count", { n: text.length })}</span>
          </div>
        </div>

        <div className="space-y-1.5" style={{ marginTop: 16 }}>
          <label className="forge-label">{t("label.qr_size")}</label>
          <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
            {SIZE_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`btn-toggle ${size === s ? "btn-toggle-active" : ""}`}
                style={{ flex: "none" }}
              >
                {s}px
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Right — live preview + actions */}
      <section style={{ width: 320, flexShrink: 0, ...PANEL }}>
        <label className="forge-label">{t("label.qr_preview")}</label>
        <div
          className="flex items-center justify-center"
          style={{
            marginTop: 8,
            marginBottom: 12,
            aspectRatio: "1 / 1",
            borderRadius: 8,
            border: "1px solid var(--bg-border)",
            background: previewSrc ? "#ffffff" : "var(--bg-overlay)",
            overflow: "hidden",
          }}
        >
          {previewSrc ? (
            <img src={previewSrc} alt="QR Code" className="w-full h-full object-contain" style={{ padding: 12 }} />
          ) : (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              {t("label.qr_placeholder")}
            </span>
          )}
        </div>

        <ActionButton
          onClick={handleSave}
          disabled={!content}
          loading={saving}
          loadingText={t("status.generating_qr")}
          text={t("action.save_qr")}
          icon={<QrCode className="h-4 w-4" strokeWidth={1.5} />}
        />

        <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
          <button onClick={handleCopy} disabled={!previewB64} className="btn-ghost">
            <Copy className="h-3 w-3" strokeWidth={1.5} />
            {t("action.copy_image")}
          </button>
          {result && result.output_path && (
            <button onClick={() => revealItemInDir(result.output_path)} className="btn-ghost">
              <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
              {t("label.open_output_folder")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Format + build**

Run: `bunx prettier --check src/components/QrCodeTab.tsx src/i18n/en.json src/i18n/fr.json && bun run build`
Expected: prettier clean (run `--write` then re-check if needed); `bun run build` exits 0.

- [ ] **Step 4: Visual check**

`bun run tauri dev`, open QR Code: typing in the content box redraws the QR live in the right panel (debounced); changing the size updates it; empty content shows a placeholder and disables Save/Copy. "Enregistrer le PNG" writes the file (toast + "ouvrir le dossier" appears). "Copier" copies the image (toast). Other tools unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/QrCodeTab.tsx src/i18n/en.json src/i18n/fr.json
git commit -m "feat(qr): 2-pane QR tool with live preview + save/copy"
```

---

## Self-Review

**1. Spec coverage (§3.1):** 2-col content→preview (Task 2); live preview via new base64 command (Task 1 + the debounced effect); explicit save via existing `generate_qr_cmd`; copy image; size options unchanged; stays in centered branch (no App.tsx change). ✓

**2. Placeholder scan:** Complete Rust + TSX + i18n; the only ellipsis is `...PANEL` (a real JS spread, not a placeholder) and `generate_handler![...]` referring to the existing list. No TODO/TBD. ✓

**3. Type/name consistency:** `generate_qr_base64(text, size) -> Result<String,String>` defined in Task 1, called by `generate_qr_preview`, invoked as `"generate_qr_preview"` with `{ text, size }` in Task 2. `QrResult` shape unchanged (matches existing `generate_qr_cmd`). `build_qr_image` used by both backend functions. ✓

**Verification note:** Rust path verified via `cargo clippy`/`cargo test`; frontend has no test runner → `prettier --check` + `bun run build` + visual.
