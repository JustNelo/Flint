# Flint — Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a Vitest frontend test layer (pure functions + key hooks), extract the rename-pattern logic to a tested pure function, add Rust tests for the lopdf PDF paths + new guards, and run Vitest in CI.

**Tech Stack:** Vitest + jsdom + @testing-library/react; Rust `cargo test` + lopdf.

**Spec:** `docs/superpowers/specs/2026-06-18-flint-tests-design.md`

**Verification:** `bun run test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `bun run build`.

---

### Task 1: Vitest tooling

**Files:** Modify `package.json`; create `vitest.config.ts`.

- [ ] **Step 1: Add dev dependencies**

```bash
bun add -d vitest jsdom @testing-library/react
```

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```
(Tests import `describe/it/expect` from `vitest` explicitly — no globals, so no tsconfig change.)

- [ ] **Step 4: Verify** — `bun run test` runs and reports "no test files" (or 0 tests) without config errors.

---

### Task 2: Extract the rename-pattern logic

**Files:** Create `src/lib/renamePattern.ts`; modify `src/components/BulkRenameTab.tsx`.

- [ ] **Step 1: Create `src/lib/renamePattern.ts`**
```ts
/**
 * Apply a bulk-rename pattern to one file name. Mirrors the tokens the backend
 * understands: {name} (stem), {index} (zero-padded to 3), {date}, {ext}.
 * If the result has no extension but the source did, the original extension is
 * re-appended. Pure — used by the live preview and unit-tested.
 */
export function applyRenamePattern(fullName: string, pattern: string, index: number, date: string): string {
  const dotIdx = fullName.lastIndexOf(".");
  const stem = dotIdx > 0 ? fullName.slice(0, dotIdx) : fullName;
  const ext = dotIdx > 0 ? fullName.slice(dotIdx + 1) : "";
  let newName = pattern
    .replace(/\{name\}/g, stem)
    .replace(/\{index\}/g, String(index).padStart(3, "0"))
    .replace(/\{date\}/g, date)
    .replace(/\{ext\}/g, ext);
  if (!newName.includes(".") && ext) newName = `${newName}.${ext}`;
  return newName;
}
```

- [ ] **Step 2: Use it in `BulkRenameTab`'s preview**

Add `import { applyRenamePattern } from "../lib/renamePattern";`. Replace the `previewNames` body:
```tsx
  const previewNames = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return files.slice(0, 5).map((file, i) => {
      const fullName = getFileName(file);
      return { original: fullName, preview: applyRenamePattern(fullName, pattern, startIndex + i, today) };
    });
  }, [files, pattern, startIndex]);
```
(Behavior identical; the inline stem/ext/replace logic now lives in the helper.)

- [ ] **Step 3: Verify** — `bun run build` (preview output unchanged).

---

### Task 3: Frontend tests

**Files:** Create `src/lib/chain.test.ts`, `src/lib/utils.test.ts`, `src/lib/renamePattern.test.ts`, `src/hooks/useChainHandoff.test.tsx`, `src/hooks/useFileSelection.test.ts`.

- [ ] **Step 1: `src/lib/chain.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { compatibleChainTargets } from "./chain";

describe("compatibleChainTargets", () => {
  it("excludes the source tool", () => {
    const ids = compatibleChainTargets("compress", ["png"]).map((t) => t.id);
    expect(ids).not.toContain("compress");
  });
  it("offers optimize for png but not for webp", () => {
    expect(compatibleChainTargets("convert", ["png"]).map((t) => t.id)).toContain("optimize");
    expect(compatibleChainTargets("convert", ["webp"]).map((t) => t.id)).not.toContain("optimize");
  });
  it("returns nothing for empty extensions", () => {
    expect(compatibleChainTargets("compress", [])).toEqual([]);
  });
  it("requires every produced extension to be accepted", () => {
    // mixed png+webp: optimize (png/jpg only) must drop out
    expect(compatibleChainTargets("convert", ["png", "webp"]).map((t) => t.id)).not.toContain("optimize");
  });
});
```

- [ ] **Step 2: `src/lib/utils.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { formatSize, isImage, getFileName, resolveThumb } from "./utils";

describe("formatSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("isImage", () => {
  it("accepts known raster types incl. avif, case-insensitive", () => {
    expect(isImage("a.PNG")).toBe(true);
    expect(isImage("b.avif")).toBe(true);
    expect(isImage("c.txt")).toBe(false);
    expect(isImage("noext")).toBe(false);
  });
});

describe("getFileName", () => {
  it("handles windows and unix separators", () => {
    expect(getFileName("C:\\a\\b\\c.png")).toBe("c.png");
    expect(getFileName("/a/b/c.png")).toBe("c.png");
    expect(getFileName("bare.png")).toBe("bare.png");
  });
});

describe("resolveThumb", () => {
  it("returns the thumbnail when present", () => {
    expect(resolveThumb("data:img", "/x.png")).toBe("data:img");
  });
  it("returns undefined while pending", () => {
    expect(resolveThumb(undefined, "/x.png")).toBeUndefined();
  });
  it("falls back to the original asset url when null", () => {
    expect(resolveThumb(null, "/x.png")).toBeTruthy();
  });
});
```

- [ ] **Step 3: `src/lib/renamePattern.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { applyRenamePattern } from "./renamePattern";

describe("applyRenamePattern", () => {
  it("substitutes name, zero-padded index and ext", () => {
    expect(applyRenamePattern("photo.png", "{name}_{index}", 1, "2026-06-18")).toBe("photo_001.png");
  });
  it("uses {date}", () => {
    expect(applyRenamePattern("a.jpg", "{date}-{index}", 12, "2026-06-18")).toBe("2026-06-18-012.jpg");
  });
  it("respects an explicit {ext} token without double extension", () => {
    expect(applyRenamePattern("a.jpg", "{name}.{ext}", 1, "2026-06-18")).toBe("a.jpg");
  });
  it("handles names without extension", () => {
    expect(applyRenamePattern("README", "{name}_{index}", 5, "2026-06-18")).toBe("README_005");
  });
});
```

- [ ] **Step 4: `src/hooks/useChainHandoff.test.tsx`**
```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ChainHandoffProvider, useChainHandoff } from "./useChainHandoff";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChainHandoffProvider>{children}</ChainHandoffProvider>
);

describe("useChainHandoff", () => {
  it("requests then consumes a handoff for the matching tab", () => {
    const { result } = renderHook(() => useChainHandoff(), { wrapper });
    act(() => result.current.requestChain("resize", ["/a.png", "/b.png"]));
    expect(result.current.pending).toEqual({ tab: "resize", files: ["/a.png", "/b.png"] });
    let taken: string[] | null = null;
    act(() => {
      taken = result.current.consumeChain("resize");
    });
    expect(taken).toEqual(["/a.png", "/b.png"]);
    expect(result.current.pending).toBeNull();
  });

  it("does not consume for a non-matching tab", () => {
    const { result } = renderHook(() => useChainHandoff(), { wrapper });
    act(() => result.current.requestChain("resize", ["/a.png"]));
    let taken: string[] | null = ["sentinel"];
    act(() => {
      taken = result.current.consumeChain("crop");
    });
    expect(taken).toBeNull();
    expect(result.current.pending).not.toBeNull();
  });
});
```

- [ ] **Step 5: `src/hooks/useFileSelection.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileSelection } from "./useFileSelection";

describe("useFileSelection", () => {
  it("adds files and dedupes by path", () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => result.current.addFiles(["/a.png", "/b.png"]));
    act(() => result.current.addFiles(["/b.png", "/c.png"]));
    expect(result.current.files).toEqual(["/a.png", "/b.png", "/c.png"]);
  });
  it("removes by index, reorders and clears", () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => result.current.addFiles(["/a.png", "/b.png", "/c.png"]));
    act(() => result.current.removeFile(1));
    expect(result.current.files).toEqual(["/a.png", "/c.png"]);
    act(() => result.current.reorderFiles(0, 1));
    expect(result.current.files).toEqual(["/c.png", "/a.png"]);
    act(() => result.current.clearFiles());
    expect(result.current.files).toEqual([]);
  });
});
```

- [ ] **Step 6: Verify** — `bun run test` → all suites green.

---

### Task 4: Rust tests (pure / lopdf)

**Files:** Modify `src-tauri/src/pdf_split_ops.rs`, `src-tauri/src/utils.rs`, `src-tauri/src/pdf_ops.rs` (add `#[cfg(test)]` modules / cases).

- [ ] **Step 1: `pdf_split_ops` integration test**

Add a `#[cfg(test)] mod tests` (or extend the existing one) that: builds a 3-page PDF with lopdf into a temp dir (`std::env::temp_dir()` + a unique subdir), calls `split_pdf(path, "1-2,3", out_dir, &app_handle?)` — note `split_pdf` needs an `AppHandle` for progress; if that makes a direct unit test impractical, instead test the page-collection helper directly, OR construct the doc and assert `parse_ranges` + the per-range page mapping. Concretely, test the part that does not require a Tauri `AppHandle`:
  - `parse_ranges` (already covered) plus a new test that builds a doc, runs the deep page-copy for a range via `deep_clone_object`, and asserts the new doc has the expected `/Count`.

(If `split_pdf`'s signature requires `AppHandle`, do NOT fabricate one — test the underlying page-copy/range logic instead, which is the part worth locking down.)

- [ ] **Step 2: `utils::deep_clone_object` test**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object};

    #[test]
    fn deep_clone_remaps_references_and_breaks_cycles() {
        let mut src = Document::with_version("1.7");
        let child = src.add_object(dictionary! { "Type" => "Child" });
        let parent = src.add_object(dictionary! { "Type" => "Parent", "Kid" => Object::Reference(child) });
        // self-reference to exercise the cycle breaker
        if let Ok(Object::Dictionary(d)) = src.get_object_mut(child) {
            d.set("Back", Object::Reference(parent));
        }

        let mut dest = Document::with_version("1.7");
        let mut visited = std::collections::HashMap::new();
        let new_parent = deep_clone_object(&mut dest, &src, parent, &mut visited).unwrap();

        // The clone resolves without infinite recursion and the parent exists in dest.
        assert!(dest.get_object(new_parent).is_ok());
        assert!(visited.contains_key(&parent) && visited.contains_key(&child));
    }
}
```
(Place in `utils.rs`; it already has a `#[cfg(test)] mod tests` — add this case there. Adjust field/type names to the real `deep_clone_object` signature.)

- [ ] **Step 3: `pdf_ops::is_safely_recompressible` tests**
```rust
#[cfg(test)]
mod recompress_tests {
    use super::*;
    use lopdf::dictionary;

    #[test]
    fn rejects_smask_and_non_8bit_and_indexed() {
        let smask = dictionary! { "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8, "SMask" => 1i64 };
        assert!(!is_safely_recompressible(&smask));

        let deep = dictionary! { "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 4 };
        assert!(!is_safely_recompressible(&deep));

        let indexed = dictionary! { "ColorSpace" => "Indexed", "BitsPerComponent" => 8 };
        assert!(!is_safely_recompressible(&indexed));
    }

    #[test]
    fn accepts_plain_8bit_rgb() {
        let ok = dictionary! { "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8 };
        assert!(is_safely_recompressible(&ok));
    }
}
```
(Adjust to the real signature of `is_safely_recompressible`. If `SMask` must be a reference/stream the `has(b"SMask")` check still triggers; `1i64` is enough to make the key present.)

- [ ] **Step 4: Verify** — `cargo test --manifest-path src-tauri/Cargo.toml --lib` (all pass). If the pdfium DLL lock causes a `clippy` `os error 32`, that does not affect `cargo test`.

- [ ] **Step 5: Commit (frontend + Rust tests + tooling + extraction)**
```bash
git add package.json bun.lock vitest.config.ts src/lib/renamePattern.ts src/components/BulkRenameTab.tsx \
  src/lib/chain.test.ts src/lib/utils.test.ts src/lib/renamePattern.test.ts \
  src/hooks/useChainHandoff.test.tsx src/hooks/useFileSelection.test.ts \
  src-tauri/src/pdf_split_ops.rs src-tauri/src/utils.rs src-tauri/src/pdf_ops.rs
git commit -m "test: add Vitest frontend suite + lopdf/helper Rust tests"
```
(End the body with the `Co-Authored-By` trailer. `bun.lock` is committed; `package.json` is not `Cargo.toml`, so it is fine to commit.)

---

### Task 5: Run Vitest in CI

**Files:** Modify `.github/workflows/release.yml`.

- [ ] **Step 1: Add a frontend test step**

In the job that already runs `cargo fmt --check` / `clippy` / `test` (and `bun install`), add a step after `bun install`:
```yaml
      - name: Frontend tests
        run: bun run test
```
Place it so it runs before the `tauri build` step. Read the file first to match the existing step style/indentation and the runner that has Bun available.

- [ ] **Step 2: Commit**
```bash
git add .github/workflows/release.yml
git commit -m "ci: run Vitest frontend tests on release"
```

---

## Self-Review

**1. Spec coverage:** Vitest tooling (T1); rename extraction + test (T2, T3S3); pure-fn tests for chain/utils (T3S1-2); hook tests (T3S4-5); Rust lopdf/guard tests (T4); CI (T5). pdfium-runtime + component tests explicitly out of scope. Covered.

**2. Placeholder scan:** Test code is concrete. Two adjustment notes (split_pdf AppHandle; exact Rust signatures) are guardrails to match real code at implementation, not skipped steps — the fallback (test the page-copy/range logic) is specified.

**3. Type/name consistency:** Imports match the symbols under test (`compatibleChainTargets`, `formatSize`/`isImage`/`getFileName`/`resolveThumb`, `applyRenamePattern`, `ChainHandoffProvider`/`useChainHandoff`, `useFileSelection`, `deep_clone_object`, `is_safely_recompressible`). `applyRenamePattern(fullName, pattern, index, date)` is the same signature defined (T2), used (T2 preview), and tested (T3S3).
