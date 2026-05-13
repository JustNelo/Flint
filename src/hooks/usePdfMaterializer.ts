import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MutableRefObject } from "react";
import type { PdfBuilderItem, MergePdfOptions, MergePdfResult } from "../types";
import type { BuilderPage } from "./usePdfPages";

interface UsePdfMaterializerArgs {
  pagesRef: MutableRefObject<BuilderPage[]>;
  gridModified: boolean;
  getSingleSourcePdf: () => string | null;
  onStart?: () => void;
}

/**
 * Turn the current grid into an on-disk PDF the pipeline can act on.
 *
 * Fast path: if the grid is one untouched PDF, we return its path
 * directly — no need to round-trip through merge_to_pdf. Otherwise we
 * materialize into a `_rustine_temp_*.pdf` next to the workspace and
 * the caller is responsible for cleaning it up after use.
 */
export function usePdfMaterializer({ pagesRef, gridModified, getSingleSourcePdf, onStart }: UsePdfMaterializerArgs) {
  const materializeGrid = useCallback(
    async (outputDir: string): Promise<string | null> => {
      const currentPages = pagesRef.current;
      if (currentPages.length === 0) return null;

      if (!gridModified) {
        const singleSource = getSingleSourcePdf();
        if (singleSource) return singleSource;
      }

      onStart?.();

      const sep = outputDir.includes("/") ? "/" : "\\";
      const tempPath = `${outputDir}${sep}_rustine_temp_${Date.now()}.pdf`;

      const items: PdfBuilderItem[] = currentPages.map((page) => ({
        source_path: page.sourcePath,
        page_number: page.sourceType === "pdf" ? page.pageNumber : null,
        source_type: page.sourceType,
      }));

      const options: MergePdfOptions = {
        page_format: "fit",
        orientation: "portrait",
        margin_px: 0,
        image_quality: 90,
        output_path: tempPath,
      };

      const res = await invoke<MergePdfResult>("merge_to_pdf", { items, options });
      if (res.page_count === 0) {
        throw new Error(res.errors[0] || "materialize_failed");
      }
      return tempPath;
    },
    [pagesRef, gridModified, getSingleSourcePdf, onStart],
  );

  const cleanupTemp = useCallback(async (path: string | null) => {
    if (!path) return;
    // Defensive: only remove files we created. Real source paths the user
    // dropped never start with this prefix.
    const fileName = path.split(/[\\/]/).pop() || "";
    if (fileName.startsWith("_rustine_temp_")) {
      try {
        const { remove } = await import("@tauri-apps/plugin-fs");
        await remove(path);
      } catch {
        // Best-effort cleanup
      }
    }
  }, []);

  return { materializeGrid, cleanupTemp };
}
