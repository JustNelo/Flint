import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { safeAssetUrl, logError } from "../lib/utils";
import { useT } from "../i18n/i18n";
import type { PageThumbnail } from "../types";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "bmp", "ico", "tiff", "tif", "webp"]);
const THUMBNAIL_BATCH_SIZE = 30;

function isImageFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

function isPdfFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return ext === "pdf";
}

export interface BuilderPage {
  id: string;
  sourcePath: string;
  pageNumber: number;
  sourceType: "pdf" | "image";
  thumbnailSrc: string;
  fileName: string;
  thumbnailLoaded: boolean;
}

/**
 * Manages the grid of pages in the PDF workbench: drag-and-drop adds,
 * thumbnail loading (paged for big PDFs), reorder, and dirty-tracking
 * relative to the initial snapshot.
 *
 * Intentionally excludes pipeline result/loading state — that belongs to
 * the orchestrating hook so this one stays focused on page state.
 */
export function usePdfPages() {
  const { t } = useT();
  const [pages, setPages] = useState<BuilderPage[]>([]);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);
  const [gridModified, setGridModified] = useState(false);

  // pagesRef gives synchronous read access from callbacks that don't
  // want to re-render on every page change (e.g. materializeGrid).
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const initialSnapshotRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const captureSnapshot = useCallback((pageList: BuilderPage[]) => {
    const sig = pageList.map((p) => `${p.sourcePath}:${p.pageNumber}`).join("|");
    initialSnapshotRef.current = sig;
    setGridModified(false);
  }, []);

  const checkIfModified = useCallback((pageList: BuilderPage[]) => {
    const sig = pageList.map((p) => `${p.sourcePath}:${p.pageNumber}`).join("|");
    setGridModified(sig !== initialSnapshotRef.current);
  }, []);

  const getSingleSourcePdf = useCallback((): string | null => {
    const currentPages = pagesRef.current;
    if (currentPages.length === 0) return null;
    const uniqueSources = new Set(currentPages.map((p) => p.sourcePath));
    if (uniqueSources.size !== 1) return null;
    const firstPage = currentPages[0];
    if (firstPage.sourceType !== "pdf") return null;
    return firstPage.sourcePath;
  }, []);

  const getOutputStem = useCallback((): string | null => {
    const currentPages = pagesRef.current;
    if (currentPages.length === 0) return null;
    const firstPdf = currentPages.find((p) => p.sourceType === "pdf");
    if (firstPdf) {
      const fileName = firstPdf.sourcePath.split(/[\\/]/).pop() || "";
      const dotIdx = fileName.lastIndexOf(".");
      return dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName || null;
    }
    const first = currentPages[0];
    const fileName = first.sourcePath.split(/[\\/]/).pop() || "";
    const dotIdx = fileName.lastIndexOf(".");
    return dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName || null;
  }, []);

  const addFiles = useCallback(
    async (paths: string[]) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      const imagePaths = paths.filter(isImageFile);
      const pdfPaths = paths.filter(isPdfFile);

      const willHaveMultipleSources = pagesRef.current.length > 0;

      const imagePages: BuilderPage[] = imagePaths.map((path, index) => {
        const fileName = path.split(/[\\/]/).pop() || path;
        return {
          id: `img_${fileName}_${index}_${crypto.randomUUID()}`,
          sourcePath: path,
          pageNumber: 0,
          sourceType: "image" as const,
          thumbnailSrc: safeAssetUrl(path),
          fileName,
          thumbnailLoaded: true,
        };
      });

      if (imagePages.length > 0) {
        setPages((prev) => [...prev, ...imagePages]);
      }

      for (const pdfPath of pdfPaths) {
        if (controller.signal.aborted) break;
        setLoadingThumbnails(true);
        try {
          const pageCount = await invoke<number>("get_pdf_page_count", { pdfPath });
          const fileName = pdfPath.split(/[\\/]/).pop() || pdfPath;

          const placeholders: BuilderPage[] = [];
          for (let i = 1; i <= pageCount; i++) {
            placeholders.push({
              id: `pdf_${fileName}_p${i}_${crypto.randomUUID()}`,
              sourcePath: pdfPath,
              pageNumber: i,
              sourceType: "pdf",
              thumbnailSrc: "",
              fileName,
              thumbnailLoaded: false,
            });
          }
          setPages((prev) => [...prev, ...placeholders]);

          for (let batch = 0; batch < pageCount; batch += THUMBNAIL_BATCH_SIZE) {
            if (controller.signal.aborted) break;
            const startPage = batch + 1;
            const maxPages = Math.min(THUMBNAIL_BATCH_SIZE, pageCount - batch);
            try {
              const thumbnails = await invoke<PageThumbnail[]>("generate_pdf_thumbnails", {
                filePaths: [pdfPath],
                startPage,
                maxPages,
              });

              const thumbMap = new Map<number, string>();
              for (const th of thumbnails) {
                if (th.source_path === pdfPath && th.thumbnail_b64) {
                  thumbMap.set(th.page_number, `data:image/jpeg;base64,${th.thumbnail_b64}`);
                }
              }
              setPages((prev) =>
                prev.map((page) => {
                  if (page.sourcePath !== pdfPath || page.thumbnailLoaded) return page;
                  const src = thumbMap.get(page.pageNumber);
                  if (src !== undefined) {
                    return { ...page, thumbnailSrc: src, thumbnailLoaded: true };
                  }
                  return page;
                }),
              );
            } catch (batchErr) {
              logError(`pdf:thumbnails:${startPage}-${startPage + maxPages}`, batchErr);
            }
          }
        } catch (err) {
          logError("pdf:load", err);
          const msg = String(err).toLowerCase();
          if (msg.includes("password")) {
            toast.error(t("toast.pdf_password_protected"));
          } else {
            toast.error(t("toast.pdf_load_failed"));
          }
        }
      }
      setLoadingThumbnails(false);

      // Read-only setPages: needed to access the just-mutated page list
      // synchronously before deciding whether to capture a fresh snapshot
      // or mark the grid as dirty.
      setPages((currentPages) => {
        if (!willHaveMultipleSources && pdfPaths.length <= 1 && imagePaths.length === 0) {
          captureSnapshot(currentPages);
        } else if (willHaveMultipleSources || pdfPaths.length > 1 || (pdfPaths.length > 0 && imagePaths.length > 0)) {
          setGridModified(true);
        }
        return currentPages;
      });
    },
    [captureSnapshot, t],
  );

  const removePage = useCallback(
    (id: string) => {
      setPages((prev) => {
        const next = prev.filter((p) => p.id !== id);
        checkIfModified(next);
        return next;
      });
    },
    [checkIfModified],
  );

  const reorderPages = useCallback(
    (reordered: BuilderPage[]) => {
      setPages(reordered);
      checkIfModified(reordered);
    },
    [checkIfModified],
  );

  const clearAll = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setPages([]);
    setGridModified(false);
    initialSnapshotRef.current = "";
  }, []);

  return {
    pages,
    pagesRef,
    loadingThumbnails,
    gridModified,
    addFiles,
    removePage,
    reorderPages,
    clearAll,
    getSingleSourcePdf,
    getOutputStem,
  };
}
