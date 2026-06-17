# Flint — PDF Workbench Phase 3: scrolling PdfViewer + wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an in-app full-screen scrolling PDF viewer (lazy per-page render via `render_pdf_page`, zoom, page indicator), opened from a PDF page tile in the workbench grid and from a "voir" button on the result panel.

**Architecture:** A `PdfViewer` overlay component renders the page list with `content-visibility:auto`; an IntersectionObserver triggers `render_pdf_page` for visible pages (cached per page at the current zoom width; cache cleared + visible re-rendered on zoom). Wiring threads an `onOpen(page)` from `PdfWorkbenchTab` → `PdfPageGrid` → `PdfPageCard` (a view button on PDF-type tiles), and an `onView(pdfPath)` to the inner `ResultPanel` (for single-PDF-output results).

**Tech Stack:** React 19, Tauri invoke, IntersectionObserver. Backend command `render_pdf_page` + `get_pdf_page_count` already exist. No frontend test runner → `bunx prettier --check` + `bun run build` + manual visual check.

**Reference:** spec `docs/superpowers/specs/2026-06-17-flint-pdf-workbench-redesign-design.md` §3 (viewer). Reference modal: `src/components/ImageGrid.tsx` preview modal. `BuilderPage` type: `src/hooks/usePdfPages.ts` (fields `id`, `sourcePath`, `pageNumber`, `sourceType`, `thumbnailSrc`, `fileName`, `thumbnailLoaded`).

---

### Task 1: `PdfViewer` component + i18n

**Files:**
- Create: `src/components/PdfViewer.tsx`
- Modify: `src/i18n/en.json`, `src/i18n/fr.json`

- [ ] **Step 1: i18n keys** (skip any that already exist)

en.json:
```json
"viewer.page_count": "Page {n} / {total}",
"viewer.zoom_in": "Zoom in",
"viewer.zoom_out": "Zoom out",
"viewer.fit_width": "Fit width",
"viewer.rendering": "Rendering page",
"viewer.close": "Close",
"action.view": "View"
```
fr.json:
```json
"viewer.page_count": "Page {n} / {total}",
"viewer.zoom_in": "Agrandir",
"viewer.zoom_out": "Réduire",
"viewer.fit_width": "Ajuster la largeur",
"viewer.rendering": "Rendu de la page",
"viewer.close": "Fermer",
"action.view": "Voir"
```

- [ ] **Step 2: Create `src/components/PdfViewer.tsx`**

```tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useT } from "../i18n/i18n";
import { logError, getFileName } from "../lib/utils";

interface PdfViewerProps {
  pdfPath: string;
  initialPage?: number;
  onClose: () => void;
}

const MIN_W = 400;
const MAX_W = 1600;
const STEP = 200;

export function PdfViewer({ pdfPath, initialPage = 1, onClose }: PdfViewerProps) {
  const { t } = useT();
  const [pageCount, setPageCount] = useState(0);
  const [width, setWidth] = useState(800);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [, force] = useState(0);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const widthRef = useRef(width);
  const visibleRef = useRef<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const didInitialScroll = useRef(false);

  useEffect(() => {
    let cancelled = false;
    invoke<number>("get_pdf_page_count", { pdfPath })
      .then((n) => {
        if (!cancelled) setPageCount(n);
      })
      .catch((err) => {
        if (!cancelled) {
          logError("viewer:count", err);
          onClose();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pdfPath, onClose]);

  const renderPage = useCallback(
    (page: number) => {
      if (cacheRef.current.has(page)) return;
      const w = widthRef.current;
      invoke<string>("render_pdf_page", { pdfPath, pageNumber: page, targetWidth: w })
        .then((b64) => {
          if (widthRef.current !== w) return; // zoom changed since request
          cacheRef.current.set(page, `data:image/jpeg;base64,${b64}`);
          force((n) => n + 1);
        })
        .catch((err) => logError(`viewer:render:${page}`, err));
    },
    [pdfPath],
  );

  // Render visible pages + track the top-most visible page number.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pageCount === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        let top: number | null = null;
        for (const e of entries) {
          const page = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) {
            visibleRef.current.add(page);
            renderPage(page);
            if (top === null || page < top) top = page;
          } else {
            visibleRef.current.delete(page);
          }
        }
        if (top !== null) setCurrentPage(top);
      },
      { root, rootMargin: "150% 0px", threshold: 0.01 },
    );
    pageEls.current.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [pageCount, renderPage]);

  // Scroll to the requested page once the page list exists.
  useEffect(() => {
    if (didInitialScroll.current || pageCount === 0 || initialPage <= 1) return;
    const el = pageEls.current.get(initialPage);
    if (el) {
      el.scrollIntoView({ block: "start" });
      didInitialScroll.current = true;
    }
  }, [pageCount, initialPage]);

  const applyZoom = useCallback(
    (w: number) => {
      const clamped = Math.max(MIN_W, Math.min(MAX_W, w));
      widthRef.current = clamped;
      cacheRef.current = new Map();
      setWidth(clamped);
      force((n) => n + 1);
      visibleRef.current.forEach((p) => renderPage(p));
    },
    [renderPage],
  );

  const fitWidth = useCallback(() => {
    const w = scrollRef.current?.clientWidth;
    if (w) applyZoom(w - 48);
  }, [applyZoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const intrinsicH = Math.round(width * 1.414);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onMouseDown={onClose}
    >
      <div
        className="relative flex flex-col"
        style={{
          width: "min(92vw, 1100px)",
          height: "92vh",
          borderRadius: 12,
          border: "1px solid var(--bg-border)",
          background: "var(--bg-elevated)",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--bg-border)" }}
        >
          <span
            className="truncate max-w-md"
            style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-secondary)" }}
          >
            {getFileName(pdfPath)}
            {pageCount > 0 ? ` — ${t("viewer.page_count", { n: currentPage, total: pageCount })}` : ""}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => applyZoom(width - STEP)} className="btn-icon" title={t("viewer.zoom_out")}>
              <ZoomOut className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <span
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)", width: 52, textAlign: "center" }}
            >
              {width}px
            </span>
            <button onClick={() => applyZoom(width + STEP)} className="btn-icon" title={t("viewer.zoom_in")}>
              <ZoomIn className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button onClick={fitWidth} className="btn-icon" title={t("viewer.fit_width")}>
              <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button onClick={onClose} className="btn-icon" title={t("viewer.close")}>
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto flex flex-col items-center gap-4 p-4"
          style={{ background: "var(--bg-base)" }}
        >
          {pages.map((page) => {
            const src = cacheRef.current.get(page);
            return (
              <div
                key={page}
                data-page={page}
                ref={(el) => {
                  if (el) pageEls.current.set(page, el);
                  else pageEls.current.delete(page);
                }}
                style={{
                  width,
                  maxWidth: "100%",
                  contentVisibility: "auto",
                  containIntrinsicSize: `auto ${intrinsicH}px`,
                  borderRadius: 4,
                  overflow: "hidden",
                  background: "#ffffff",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.3)",
                }}
              >
                {src ? (
                  <img src={src} alt={`page ${page}`} style={{ width: "100%", display: "block" }} />
                ) : (
                  <div
                    style={{
                      height: intrinsicH,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--bg-overlay)",
                      color: "var(--text-tertiary)",
                      fontSize: 12,
                    }}
                  >
                    {t("viewer.rendering")} {page}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Format + build**

Run: `bunx prettier --check src/components/PdfViewer.tsx src/i18n/en.json src/i18n/fr.json && bun run build`
Expected: prettier clean; `bun run build` exits 0 (component unused until Task 2 — fine). If tsc flags `getFileName` not exported, confirm it exists in `src/lib/utils.ts` (it does).

- [ ] **Step 4: Commit**

```bash
git add src/components/PdfViewer.tsx src/i18n/en.json src/i18n/fr.json
git commit -m "feat(pdf): scrolling PdfViewer (lazy render + zoom)"
```

---

### Task 2: Wire the open triggers

**Files:**
- Modify: `src/components/PdfPageCard.tsx` (view button on PDF tiles)
- Modify: `src/components/PdfPageGrid.tsx` (thread `onOpen`)
- Modify: `src/components/PdfWorkbenchTab.tsx` (viewer state + render `PdfViewer` + result "voir")

- [ ] **Step 1: `PdfPageCard` — add an `onOpen` view button for PDF tiles**

In `src/components/PdfPageCard.tsx`: add `Maximize2` to the lucide import. Extend the props:
```tsx
interface PdfPageCardProps {
  page: BuilderPage;
  onRemove: (id: string) => void;
  onOpen?: (page: BuilderPage) => void;
}
```
Destructure `onOpen`. Add a view button next to the remove button (only for PDF pages), with `onPointerDown` stopPropagation so it doesn't start a drag:
```tsx
        {page.sourceType === "pdf" && onOpen && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onOpen(page)}
            className="absolute top-1 right-7 z-10 rounded-full bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-black/80"
            title={page.fileName}
          >
            <Maximize2 className="h-3 w-3 text-white" strokeWidth={1.5} />
          </button>
        )}
```
Add `onOpen` to the `memo` comparator (return `... && prev.onOpen === next.onOpen`).

- [ ] **Step 2: `PdfPageGrid` — thread `onOpen`**

In `src/components/PdfPageGrid.tsx`: add `onOpen?: (page: BuilderPage) => void;` to `PdfPageGridProps`, destructure it, and pass it to each card: `<PdfPageCard key={page.id} page={page} onRemove={onRemove} onOpen={onOpen} />`.

- [ ] **Step 3: `PdfWorkbenchTab` — viewer state, render, and result "voir"**

In `src/components/PdfWorkbenchTab.tsx`:
1. Import the viewer: `import { PdfViewer } from "./PdfViewer";` and import the `BuilderPage` type if not already (it's available via `usePdfWorkbench`'s `BuilderPage` re-export — add `type BuilderPage` to that import if needed).
2. Add state: `const [viewerPdf, setViewerPdf] = useState<{ path: string; page: number } | null>(null);`
3. Pass `onOpen` to the page grid: change the `<PdfPageGrid ... />` to add
   ```tsx
   onOpen={(page) => setViewerPdf({ path: page.sourcePath, page: page.pageNumber })}
   ```
   (it's only rendered for PDF tiles, so `sourcePath` is the source PDF.)
4. Render the viewer at the very end of the returned JSX (just before the outermost closing tag):
   ```tsx
   {viewerPdf && (
     <PdfViewer pdfPath={viewerPdf.path} initialPage={viewerPdf.page} onClose={() => setViewerPdf(null)} />
   )}
   ```
5. Result "voir": thread `onView` to the inner `ResultPanel`. Change the `ResultPanel` usages to `<ResultPanel result={result} t={t} onView={(p) => setViewerPdf({ path: p, page: 1 })} />`. Then update the `ResultPanel` component: add `onView?: (pdfPath: string) => void;` to `ResultPanelProps`; compute a single-PDF output for the relevant cases and render a "voir" button. Specifically, inside `ResultPanel`, after computing `mainText`/`errors`, derive:
   ```tsx
   let outputPdf: string | null = null;
   switch (result.type) {
     case "build":
     case "watermark":
     case "compress":
     case "protect":
       outputPdf =
         "output_path" in result.data && result.data.output_path
           ? (result.data.output_path as string)
           : null;
       break;
     default:
       outputPdf = null;
   }
   ```
   Then in the header actions row (next to the existing "open output folder" button), add:
   ```tsx
   {outputPdf && onView && (
     <button onClick={() => onView(outputPdf)} className="btn-ghost">
       <Maximize2 className="h-3 w-3" strokeWidth={1.5} />
       {t("action.view")}
     </button>
   )}
   ```
   Add `Maximize2` to the lucide import if not present.

- [ ] **Step 4: Format + build**

Run: `bunx prettier --check src/components/PdfPageCard.tsx src/components/PdfPageGrid.tsx src/components/PdfWorkbenchTab.tsx && bun run build`
Expected: prettier clean; `bun run build` exits 0. Resolve any TS error (e.g. `outputPdf` typing — the `"output_path" in result.data` guard narrows it; if TS complains, cast as shown).

- [ ] **Step 5: Visual check**

`bun run tauri dev`, PDF tool: add a PDF → hover a PDF page tile → a maximize button appears → click → the scrolling viewer opens at that page; scroll renders pages lazily; zoom in/out + fit-width work; Escape/backdrop/✕ close. Build a PDF → the result panel shows a "voir" button → opens the output in the viewer. Image tiles show no view button.

- [ ] **Step 6: Commit**

```bash
git add src/components/PdfPageCard.tsx src/components/PdfPageGrid.tsx src/components/PdfWorkbenchTab.tsx
git commit -m "feat(pdf): open PdfViewer from page tiles + result view button"
```

---

## Self-Review

**1. Spec coverage (§3):** full-screen overlay scrolling viewer (Task 1); lazy per-page render via `render_pdf_page` + cache + `content-visibility` (Task 1); zoom (−/+/fit-width) + page x/n + Escape/backdrop/✕ (Task 1); open from PDF page tile + result "voir" for single-PDF outputs (Task 2); any real PDF (source via tile, output via voir). ✓

**2. Placeholder scan:** Task 1 is a complete component. Task 2 gives complete edits (props, button JSX, viewer render, ResultPanel onView + outputPdf derivation). No TBD. ✓

**3. Type/name consistency:** `render_pdf_page` invoked with `{ pdfPath, pageNumber, targetWidth }` (camelCase ↔ the Rust `pdf_path`/`page_number`/`target_width`); `get_pdf_page_count` with `{ pdfPath }` (matches existing usage in usePdfPages). `PdfViewer` props `{ pdfPath, initialPage, onClose }` match the call site. `BuilderPage` fields (`sourcePath`, `pageNumber`, `sourceType`) match `usePdfPages`. `onOpen`/`onView` signatures consistent across card/grid/tab. `getFileName` exists in lib/utils. ✓

**Verification note:** No frontend test runner; `prettier --check` + `bun run build` + visual check (the lazy render/zoom is verified live).
