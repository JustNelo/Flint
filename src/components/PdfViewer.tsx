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
  // Real page aspect (height / width), learned from the first rendered page so
  // placeholders reserve the correct space for any page size (not just A4).
  const aspectRef = useRef(1.414);

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
      // Render at physical pixels so text stays crisp on HiDPI / Windows scaling.
      const renderW = Math.round(w * (window.devicePixelRatio || 1));
      invoke<string>("render_pdf_page", { pdfPath, pageNumber: page, targetWidth: renderW })
        .then((b64) => {
          if (widthRef.current !== w) return;
          cacheRef.current.set(page, `data:image/jpeg;base64,${b64}`);
          force((n) => n + 1);
        })
        .catch((err) => logError(`viewer:render:${page}`, err));
    },
    [pdfPath],
  );

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
  const intrinsicH = Math.round(width * aspectRef.current);

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
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-tertiary)",
                width: 52,
                textAlign: "center",
              }}
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
                  borderRadius: 4,
                  overflow: "hidden",
                  background: "#ffffff",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.3)",
                }}
              >
                {src ? (
                  <img
                    src={src}
                    alt={`page ${page}`}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth > 0) {
                        const a = img.naturalHeight / img.naturalWidth;
                        if (Math.abs(a - aspectRef.current) > 0.01) {
                          aspectRef.current = a;
                          force((n) => n + 1);
                        }
                      }
                    }}
                    style={{ width: "100%", display: "block" }}
                  />
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
