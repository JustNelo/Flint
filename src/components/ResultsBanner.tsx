import { useMemo, useState, useCallback, memo } from "react";
import { CheckCircle, AlertCircle, XCircle, ZoomIn, FolderOpen } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { formatSize, isImage, safeAssetUrl } from "../lib/utils";
import { useThumbnails } from "../hooks/useThumbnails";
import { BeforeAfterSlider } from "./ui/BeforeAfterSlider";
import { useT } from "../i18n/i18n";
import type { ProcessingResult } from "../types";

interface ResultsBannerProps {
  results: ProcessingResult[];
  total: number;
  outputDir?: string;
}

export const ResultsBanner = memo(function ResultsBanner({ results, total, outputDir }: ResultsBannerProps) {
  const { t } = useT();
  const [previewResult, setPreviewResult] = useState<ProcessingResult | null>(null);

  const closePreview = useCallback(() => setPreviewResult(null), []);

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const successResults = results.filter((r) => r.success);

  const sizeStats = useMemo(() => {
    const totalInput = successResults.reduce((acc, r) => acc + r.input_size, 0);
    const totalOutput = successResults.reduce((acc, r) => acc + r.output_size, 0);
    const saved = totalInput > 0 ? (1 - totalOutput / totalInput) * 100 : 0;
    return { totalInput, totalOutput, saved };
  }, [results]);

  // Bounded-size thumbnails for the output grid. `alwaysFresh` regenerates on
  // every new result set since a re-run can overwrite the same output path.
  const outputPaths = useMemo(() => results.filter((r) => r.success).map((r) => r.output_path), [results]);
  const thumbs = useThumbnails(outputPaths, true);

  if (results.length === 0) return null;

  return (
    <>
      <div
        className="mt-4 overflow-hidden p-3 space-y-3"
        style={{ borderRadius: 12, border: "1px solid var(--bg-border)", background: "var(--bg-elevated)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {failed === 0 ? (
              <CheckCircle className="h-4 w-4" style={{ color: "var(--success)" }} strokeWidth={1.5} />
            ) : succeeded === 0 ? (
              <XCircle className="h-4 w-4" style={{ color: "var(--danger)" }} strokeWidth={1.5} />
            ) : (
              <AlertCircle className="h-4 w-4" style={{ color: "var(--warning)" }} strokeWidth={1.5} />
            )}
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>
              {t("result.processed", { succeeded, total })}
            </span>
          </div>
          {outputDir && (
            <button onClick={() => revealItemInDir(outputDir)} className="btn-ghost">
              <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
              {t("label.open_output_folder")}
            </button>
          )}
        </div>

        {succeeded > 0 && sizeStats.totalInput > 0 && (
          <div
            className="flex items-center gap-3"
            style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}
          >
            <span>{formatSize(sizeStats.totalInput)}</span>
            <span style={{ color: "var(--text-tertiary)" }}>→</span>
            <span>{formatSize(sizeStats.totalOutput)}</span>
            {sizeStats.saved > 0 && (
              <span className="ml-auto font-medium" style={{ color: "var(--success)" }}>
                -{sizeStats.saved.toFixed(1)}%
              </span>
            )}
            {sizeStats.saved < 0 && (
              <span className="ml-auto font-medium" style={{ color: "var(--warning)" }}>
                +{Math.abs(sizeStats.saved).toFixed(1)}%
              </span>
            )}
          </div>
        )}

        {successResults.length > 0 && (
          <div
            className="max-h-56 overflow-y-auto pr-1"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
              gap: "10px",
            }}
          >
            {successResults.map((r, i) => {
              const outName = r.output_path.split(/[\\/]/).pop() || "";
              const canPreview = isImage(r.output_path);
              const thumb = thumbs.get(r.output_path);
              // Prefer the thumbnail; fall back to the original only when the
              // backend couldn't rasterize it (null); render a placeholder while
              // it is still being generated (undefined).
              const previewSrc = thumb != null ? thumb : thumb === null ? safeAssetUrl(r.output_path, true) : undefined;
              return (
                <div
                  key={i}
                  className="group relative overflow-hidden aspect-square cursor-pointer"
                  style={{
                    borderRadius: 8,
                    border: "1px solid var(--bg-border)",
                    background: "var(--bg-overlay)",
                    contentVisibility: "auto",
                    containIntrinsicSize: "auto 120px",
                  }}
                  onClick={() => canPreview && setPreviewResult(r)}
                >
                  {canPreview && previewSrc ? (
                    <img
                      src={previewSrc}
                      alt={outName}
                      decoding="async"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : canPreview ? (
                    <div className="h-full w-full" style={{ background: "var(--bg-elevated)" }} aria-hidden />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <CheckCircle className="h-5 w-5 text-green-400/50" strokeWidth={1.5} />
                    </div>
                  )}

                  {canPreview && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <ZoomIn className="h-4 w-4 text-white" strokeWidth={1.5} />
                    </div>
                  )}

                  <div
                    className="absolute bottom-0 left-0 right-0 px-1.5 py-1"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)" }}
                  >
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.9)" }} className="truncate block">
                      {outName}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--text-tertiary)" }}>{formatSize(r.output_size)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {failed > 0 && (
          <div className="max-h-24 overflow-y-auto space-y-1">
            {results
              .filter((r) => !r.success)
              .map((r, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2"
                  style={{ fontSize: "var(--text-sm)", color: "rgba(239,68,68,0.8)" }}
                >
                  <XCircle className="h-3 w-3 shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span className="truncate">
                    {r.input_path.split(/[\\/]/).pop()}: {r.error}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {previewResult && <BeforeAfterSlider result={previewResult} onClose={closePreview} />}
    </>
  );
});
