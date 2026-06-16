import { useState, useCallback } from "react";
import { ArrowRightLeft } from "lucide-react";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { ActionButton } from "./ui/ActionButton";
import { useTabProcessor } from "../hooks/useTabProcessor";
import { useT } from "../i18n/i18n";
import type { OutputFormat } from "../types";

const FORMAT_INFO: Record<string, { typeKey: string; alpha: boolean }> = {
  png: { typeKey: "format.lossless", alpha: true },
  jpg: { typeKey: "format.lossy", alpha: false },
  webp: { typeKey: "format.lossy_lossless", alpha: true },
  bmp: { typeKey: "format.uncompressed", alpha: false },
  ico: { typeKey: "format.lossless", alpha: true },
  tiff: { typeKey: "format.lossless", alpha: true },
};

const FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "webp", label: "WebP" },
  { value: "bmp", label: "BMP" },
  { value: "ico", label: "ICO" },
  { value: "tiff", label: "TIFF" },
];

export function ConvertTab() {
  const { t } = useT();
  const {
    files,
    removeFile,
    reorderFiles,
    handleFilesSelected,
    handleClearFiles,
    loading,
    results,
    lastOutputDir,
    process,
  } = useTabProcessor({ tabId: "convert", command: "convert_images" });
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");

  const handleConvert = useCallback(async () => {
    await process({
      extraParams: { outputFormat },
      successMessage: t("toast.convert_success", { n: files.length, format: outputFormat.toUpperCase() }),
    });
  }, [process, outputFormat, files.length, t]);

  return (
    <div className="space-y-5">
      <DropZone
        accept="png,jpg,jpeg,bmp,ico,tiff,tif,webp,gif"
        label={t("dropzone.images_convert")}
        sublabel={t("dropzone.sublabel_convert")}
        onFilesSelected={handleFilesSelected}
      />

      <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />

      <div className="space-y-3">
        <div className="space-y-2">
          <label
            className="font-semibold uppercase"
            style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
          >
            {t("label.output_format")}
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FORMAT_OPTIONS.map((fmt) => (
              <button
                key={fmt.value}
                onClick={() => setOutputFormat(fmt.value)}
                className={`btn-toggle ${outputFormat === fmt.value ? "btn-toggle-active" : ""}`}
                style={{ flex: "none" }}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Format info badges */}
        <div className="flex items-center gap-2">
          <span
            style={{
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: "var(--text-xs)",
              fontFamily: "var(--font-mono)",
              background: "rgba(232, 87, 42, 0.08)",
              border: "1px solid rgba(232, 87, 42, 0.2)",
              color: "var(--indigo-glow)",
            }}
          >
            {t(FORMAT_INFO[outputFormat]?.typeKey)}
          </span>
          {FORMAT_INFO[outputFormat]?.alpha && (
            <span
              style={{
                borderRadius: 4,
                padding: "2px 7px",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-mono)",
                background: "rgba(34, 197, 94, 0.08)",
                border: "1px solid rgba(34, 197, 94, 0.2)",
                color: "#4ade80",
              }}
            >
              {t("format.alpha_yes")}
            </span>
          )}
          {!FORMAT_INFO[outputFormat]?.alpha && (
            <span
              style={{
                borderRadius: 4,
                padding: "2px 7px",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-mono)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--bg-border)",
                color: "var(--text-tertiary)",
              }}
            >
              {t("format.alpha_no")}
            </span>
          )}
        </div>
      </div>

      <ActionButton
        onClick={handleConvert}
        disabled={files.length === 0}
        loading={loading}
        loadingText={t("status.converting")}
        text={
          files.length > 0
            ? t("action.convert_n", { n: files.length, format: outputFormat.toUpperCase() })
            : t("action.convert", { format: outputFormat.toUpperCase() })
        }
        icon={<ArrowRightLeft className="h-4 w-4" strokeWidth={1.5} />}
      />

      <ResultsBanner results={results} total={files.length} outputDir={lastOutputDir} />
    </div>
  );
}
