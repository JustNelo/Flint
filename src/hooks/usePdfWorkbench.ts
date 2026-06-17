import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { logError } from "../lib/utils";
import { useT } from "../i18n/i18n";
import { usePdfPages, type BuilderPage } from "./usePdfPages";
import { usePdfMaterializer, buildMergeArgs } from "./usePdfMaterializer";
import type {
  MergePdfResult,
  PdfExtractionResult,
  PdfWatermarkResult,
  PdfWatermarkPosition,
} from "../types";

export type PrimaryAction = "build" | "split" | "export-images" | "extract-images" | "watermark";
type ProtectMode = "protect" | "unlock";
export type ExportFormat = "png" | "jpg";
export type ExportDpi = 72 | 150 | 300;
export type { BuilderPage };

export interface PostProcessing {
  compress: boolean;
  compressQuality: number;
  protect: boolean;
  protectPassword: string;
}

export type PipelineStep =
  | "materialize"
  | "build"
  | "split"
  | "export-images"
  | "extract-images"
  | "watermark"
  | "compress"
  | "protect";

async function uniquePath(basePath: string): Promise<string> {
  const { exists: fsExists } = await import("@tauri-apps/plugin-fs");
  if (!(await fsExists(basePath))) return basePath;

  const dotIdx = basePath.lastIndexOf(".");
  const stem = dotIdx > 0 ? basePath.substring(0, dotIdx) : basePath;
  const ext = dotIdx > 0 ? basePath.substring(dotIdx) : "";

  let counter = 2;
  let candidate = `${stem}_${counter}${ext}`;
  while (await fsExists(candidate)) {
    counter++;
    candidate = `${stem}_${counter}${ext}`;
  }
  return candidate;
}

const ACTION_SUBFOLDERS: Record<PrimaryAction | "unlock", string> = {
  build: "build",
  split: "split",
  "export-images": "exported-pages",
  "extract-images": "extracted-images",
  watermark: "watermarked",
  unlock: "unlocked",
};

interface PdfSplitResult {
  output_files: string[];
  errors: string[];
}

interface PdfToImagesResult {
  pdf_path: string;
  output_dir: string;
  exported_count: number;
  errors: string[];
}

interface PdfCompressResult {
  output_path: string;
  original_size: number;
  compressed_size: number;
  errors: string[];
}

interface PdfProtectResult {
  output_path: string;
  success: boolean;
  errors: string[];
}

export type WorkbenchResult =
  | { type: "build"; data: MergePdfResult; outputDir: string }
  | { type: "split"; data: PdfSplitResult; outputDir: string }
  | { type: "export-images"; data: { exported: number; errors: string[] }; outputDir: string }
  | { type: "extract-images"; data: { total_extracted: number; errors: string[] }; outputDir: string }
  | { type: "compress"; data: PdfCompressResult; outputDir: string }
  | { type: "protect"; data: PdfProtectResult; mode: ProtectMode; outputDir: string }
  | { type: "watermark"; data: PdfWatermarkResult; outputDir: string }
  | { type: "pipeline"; steps: string[]; errors: string[]; outputDir: string };

async function ensureSubFolder(parent: string, folder: string, sep: string): Promise<string> {
  const dir = `${parent}${sep}${folder}`;
  try {
    const { mkdir, exists: fsExists } = await import("@tauri-apps/plugin-fs");
    if (!(await fsExists(dir))) {
      await mkdir(dir, { recursive: true });
    }
  } catch (err) {
    logError("pdf:mkdir", err);
  }
  return dir;
}

/**
 * Orchestrates the PDF workbench feature: composes page state
 * (`usePdfPages`), grid materialization (`usePdfMaterializer`), and the
 * pipeline / watermark / unlock actions. Result + loading + pipeline-step
 * UI state lives here; everything page-shaped lives in `usePdfPages`.
 */
export function usePdfWorkbench() {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WorkbenchResult | null>(null);
  const [pipelineStep, setPipelineStep] = useState<PipelineStep | null>(null);

  const pageState = usePdfPages();
  const { pagesRef, gridModified, getSingleSourcePdf, getOutputStem } = pageState;

  const { materializeGrid, cleanupTemp } = usePdfMaterializer({
    pagesRef,
    gridModified,
    getSingleSourcePdf,
    onStart: () => setPipelineStep("materialize"),
  });

  // Wrap page-mutating callbacks so result/pipelineStep are reset for the user.
  const addFiles = useCallback(
    async (paths: string[]) => {
      setResult(null);
      await pageState.addFiles(paths);
    },
    [pageState],
  );

  const removePage = useCallback(
    (id: string) => {
      pageState.removePage(id);
      setResult(null);
    },
    [pageState],
  );

  const clearAll = useCallback(() => {
    pageState.clearAll();
    setResult(null);
    setPipelineStep(null);
  }, [pageState]);

  const executePipeline = useCallback(
    async (
      primaryAction: PrimaryAction,
      outputDir: string,
      actionOptions: {
        outputName?: string;
        ranges?: string;
        exportFormat?: ExportFormat;
        exportDpi?: ExportDpi;
      },
      postProcessing: PostProcessing,
    ) => {
      const currentPages = pagesRef.current;
      if (currentPages.length === 0) {
        toast.error(t("toast.select_files"));
        return;
      }

      setLoading(true);
      setResult(null);
      const pipelineErrors: string[] = [];
      const pipelineSteps: string[] = [];
      let materializedPath: string | null = null;

      const sep = outputDir.includes("/") ? "/" : "\\";
      const actionDir = await ensureSubFolder(outputDir, ACTION_SUBFOLDERS[primaryAction], sep);

      const safeName = (actionOptions.outputName || "document.pdf").endsWith(".pdf")
        ? actionOptions.outputName || "document.pdf"
        : `${actionOptions.outputName || "document"}.pdf`;

      try {
        // === PRIMARY ACTION ===

        if (primaryAction === "build") {
          setPipelineStep("build");
          pipelineSteps.push("build");

          const needsPostProcessing = postProcessing.compress || postProcessing.protect;
          const directPath = await uniquePath(`${actionDir}${sep}${safeName}`);
          const buildPath = needsPostProcessing
            ? `${outputDir}${sep}_rustine_temp_build_${Date.now()}.pdf`
            : directPath;

          const { items, options } = buildMergeArgs(currentPages, buildPath);

          const buildRes = await invoke<MergePdfResult>("merge_to_pdf", { items, options });
          if (buildRes.page_count === 0) {
            toast.error(t("toast.pdf_build_failed"));
            setLoading(false);
            return;
          }

          materializedPath = buildPath;

          if (!needsPostProcessing) {
            setResult({ type: "build", data: buildRes, outputDir: actionDir });
            toast.success(t("toast.build_success", { n: buildRes.page_count }));
            setLoading(false);
            setPipelineStep(null);
            return;
          }
        } else if (primaryAction === "split") {
          materializedPath = await materializeGrid(outputDir);
          if (!materializedPath) {
            toast.error(t("toast.select_pdf"));
            setLoading(false);
            return;
          }

          setPipelineStep("split");
          pipelineSteps.push("split");

          const res = await invoke<PdfSplitResult>("split_pdf", {
            pdfPath: materializedPath,
            ranges: actionOptions.ranges || "1-end",
            outputDir: actionDir,
            outputStem: getOutputStem(),
          });

          await cleanupTemp(materializedPath);

          setResult({ type: "split", data: res, outputDir: actionDir });
          if (res.output_files.length > 0) {
            toast.success(t("toast.pdf_split_success", { n: res.output_files.length }));
          } else {
            toast.error(t("toast.all_failed"));
          }
          setLoading(false);
          setPipelineStep(null);
          return;
        } else if (primaryAction === "export-images") {
          materializedPath = await materializeGrid(outputDir);
          if (!materializedPath) {
            toast.error(t("toast.select_pdf"));
            setLoading(false);
            return;
          }

          setPipelineStep("export-images");
          pipelineSteps.push("export-images");

          const res = await invoke<PdfToImagesResult>("pdf_to_images", {
            pdfPath: materializedPath,
            outputDir: actionDir,
            format: actionOptions.exportFormat || "png",
            dpi: actionOptions.exportDpi || 150,
            outputStem: getOutputStem(),
          });

          await cleanupTemp(materializedPath);

          setResult({
            type: "export-images",
            data: { exported: res.exported_count, errors: res.errors },
            outputDir: actionDir,
          });
          if (res.exported_count > 0) {
            toast.success(t("toast.pdf_to_images_success", { n: res.exported_count }));
          } else {
            toast.error(t("toast.all_failed"));
          }
          setLoading(false);
          setPipelineStep(null);
          return;
        } else if (primaryAction === "extract-images") {
          materializedPath = await materializeGrid(outputDir);
          if (!materializedPath) {
            toast.error(t("toast.select_pdf"));
            setLoading(false);
            return;
          }

          setPipelineStep("extract-images");
          pipelineSteps.push("extract-images");

          const res = await invoke<PdfExtractionResult>("extract_pdf_images", {
            pdfPath: materializedPath,
            outputDir: actionDir,
            outputStem: getOutputStem(),
          });

          await cleanupTemp(materializedPath);

          setResult({
            type: "extract-images",
            data: { total_extracted: res.extracted_count, errors: res.errors },
            outputDir: actionDir,
          });
          if (res.extracted_count > 0) {
            toast.success(t("toast.extract_success", { n: res.extracted_count }));
          } else if (res.errors.length > 0) {
            toast.error(t("toast.all_failed"));
          } else {
            toast.info(t("result.no_images"));
          }
          setLoading(false);
          setPipelineStep(null);
          return;
        }

        // === POST-PROCESSING (Build action only) ===

        const desiredPath = await uniquePath(`${actionDir}${sep}${safeName}`);

        let currentPdfPath = materializedPath!;
        const intermediates: string[] = [];

        if (postProcessing.compress) {
          setPipelineStep("compress");
          pipelineSteps.push("compress");

          const compressRes = await invoke<PdfCompressResult>("compress_pdf_cmd", {
            pdfPath: currentPdfPath,
            quality: postProcessing.compressQuality,
            outputDir: actionDir,
          });

          if (compressRes.errors.length > 0 || !compressRes.output_path) {
            pipelineErrors.push(...compressRes.errors);
          } else {
            intermediates.push(currentPdfPath);
            currentPdfPath = compressRes.output_path;
          }
        }

        if (postProcessing.protect && postProcessing.protectPassword.trim()) {
          setPipelineStep("protect");
          pipelineSteps.push("protect");

          const protectRes = await invoke<PdfProtectResult>("protect_pdf_cmd", {
            pdfPath: currentPdfPath,
            password: postProcessing.protectPassword,
            outputDir: actionDir,
          });

          if (!protectRes.success) {
            pipelineErrors.push(...protectRes.errors);
          } else {
            intermediates.push(currentPdfPath);
            currentPdfPath = protectRes.output_path;
          }
        }

        if (pipelineErrors.length === 0 && currentPdfPath !== desiredPath) {
          try {
            const { rename } = await import("@tauri-apps/plugin-fs");
            await rename(currentPdfPath, desiredPath);
          } catch (renameErr) {
            logError("pdf:rename", renameErr);
            pipelineErrors.push(t("toast.rename_failed"));
          }
        }

        for (const tmp of intermediates) {
          await cleanupTemp(tmp);
        }

        setResult({
          type: "pipeline",
          steps: pipelineSteps,
          errors: pipelineErrors,
          outputDir: actionDir,
        });

        if (pipelineErrors.length === 0) {
          toast.success(t("result.pipeline_complete", { steps: pipelineSteps.join(" → ") }));
        } else {
          toast.warning(
            t("toast.partial", {
              completed: pipelineSteps.length,
              total: pipelineSteps.length + pipelineErrors.length,
            }),
          );
        }
      } catch (err) {
        logError(`pdf:pipeline:${primaryAction}`, err);
        const msg = String(err).toLowerCase();
        if (msg.includes("password")) {
          toast.error(t("toast.pdf_password_protected"));
        } else if (msg.includes("materialize_failed")) {
          toast.error(t("toast.pdf_materialize_failed"));
        } else {
          toast.error(t("toast.unexpected_error"));
        }
        if (materializedPath) {
          await cleanupTemp(materializedPath);
        }
      } finally {
        setLoading(false);
        setPipelineStep(null);
      }
    },
    [pagesRef, materializeGrid, cleanupTemp, getOutputStem, t],
  );

  const watermarkPdf = useCallback(
    async (
      outputDir: string,
      watermarkMode: "text" | "image",
      options: {
        text?: string;
        imagePath?: string;
        position: PdfWatermarkPosition;
        opacity: number;
        fontSize?: number;
        color?: string;
        scale?: number;
      },
    ) => {
      const currentPages = pagesRef.current;
      if (currentPages.length === 0) {
        toast.error(t("toast.select_files"));
        return;
      }

      setLoading(true);
      setResult(null);
      let materializedPath: string | null = null;

      const sep = outputDir.includes("/") ? "/" : "\\";
      const actionDir = await ensureSubFolder(outputDir, ACTION_SUBFOLDERS.watermark, sep);

      try {
        materializedPath = await materializeGrid(outputDir);
        if (!materializedPath) {
          toast.error(t("toast.select_pdf"));
          setLoading(false);
          return;
        }

        setPipelineStep("watermark");

        const res =
          watermarkMode === "text"
            ? await invoke<PdfWatermarkResult>("watermark_pdf_text_cmd", {
                pdfPath: materializedPath,
                text: options.text || "",
                position: options.position,
                opacity: options.opacity,
                fontSize: options.fontSize || 48,
                color: options.color || "#B3B3B3",
                outputDir: actionDir,
              })
            : await invoke<PdfWatermarkResult>("watermark_pdf_image_cmd", {
                pdfPath: materializedPath,
                imagePath: options.imagePath || "",
                position: options.position,
                opacity: options.opacity,
                scale: options.scale || 0.25,
                outputDir: actionDir,
              });

        await cleanupTemp(materializedPath);

        setResult({ type: "watermark", data: res, outputDir: actionDir });

        if (res.page_count > 0 && res.errors.length === 0) {
          toast.success(t("toast.pdf_watermark_success", { n: res.page_count }));
        } else {
          toast.error(t("toast.pdf_watermark_failed"));
        }
      } catch (err) {
        logError("pdf:watermark", err);
        toast.error(t("toast.pdf_watermark_failed"));
        if (materializedPath) {
          await cleanupTemp(materializedPath);
        }
      } finally {
        setLoading(false);
        setPipelineStep(null);
      }
    },
    [pagesRef, materializeGrid, cleanupTemp, t],
  );

  const unlockPdf = useCallback(
    async (pdfPath: string, password: string, outputDir: string) => {
      if (!password.trim()) {
        toast.error(t("toast.enter_password"));
        return;
      }

      setLoading(true);
      setResult(null);

      const sep = outputDir.includes("/") ? "/" : "\\";
      const unlockDir = await ensureSubFolder(outputDir, ACTION_SUBFOLDERS.unlock, sep);

      try {
        const res = await invoke<PdfProtectResult>("unlock_pdf_cmd", {
          pdfPath,
          password,
          outputDir: unlockDir,
        });

        setResult({ type: "protect", data: res, mode: "unlock", outputDir: unlockDir });

        if (res.success) {
          toast.success(t("toast.pdf_unlock_success"));
        } else {
          toast.error(t("toast.pdf_unlock_failed"));
        }
      } catch (err) {
        logError("pdf:unlock", err);
        toast.error(t("toast.pdf_unlock_failed"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  return {
    pages: pageState.pages,
    loading,
    loadingThumbnails: pageState.loadingThumbnails,
    result,
    setResult,
    gridModified,
    pipelineStep,
    addFiles,
    removePage,
    reorderPages: pageState.reorderPages,
    clearAll,
    executePipeline,
    watermarkPdf,
    unlockPdf,
  };
}
