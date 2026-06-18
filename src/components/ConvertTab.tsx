import { useState, useCallback, useEffect } from "react";
import { ArrowRightLeft } from "lucide-react";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useTabProcessor } from "../hooks/useTabProcessor";
import { useT } from "../i18n/i18n";
import type { OutputFormat } from "../types";

const FORMAT_INFO: Record<string, { typeKey: string; alpha: boolean }> = {
  png: { typeKey: "format.lossless", alpha: true },
  jpg: { typeKey: "format.lossy", alpha: false },
  webp: { typeKey: "format.lossy_lossless", alpha: true },
  avif: { typeKey: "format.lossy", alpha: true },
  bmp: { typeKey: "format.uncompressed", alpha: false },
  ico: { typeKey: "format.lossless", alpha: true },
  tiff: { typeKey: "format.lossless", alpha: true },
};

const FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
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
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  // Show results after a run, fall back to material when the list is cleared.
  // Guarded by !loading so an in-flight run (which clears results first) does not
  // flash the material view before the new results arrive.
  useEffect(() => {
    if (!loading) setPanelMode(results.length > 0 ? "results" : "material");
  }, [results, loading]);

  const handleConvert = useCallback(async () => {
    await process({
      extraParams: { outputFormat },
      successMessage: t("toast.convert_success", { n: files.length, format: outputFormat.toUpperCase() }),
    });
  }, [process, outputFormat, files.length, t]);

  const isEmpty = files.length === 0;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={results.length > 0}
        material={
          <div className="space-y-3">
            <DropZone
              accept="png,jpg,jpeg,bmp,ico,tiff,tif,webp,gif"
              label={isEmpty ? t("dropzone.images_convert") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_convert")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />
            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />
          </div>
        }
        results={<ResultsBanner results={results} total={files.length} outputDir={lastOutputDir} />}
      />

      <ControlsPanel
        disabled={isEmpty}
        action={
          <ActionButton
            onClick={handleConvert}
            disabled={isEmpty}
            loading={loading}
            loadingText={t("status.converting")}
            text={
              isEmpty
                ? t("action.convert", { format: outputFormat.toUpperCase() })
                : t("action.convert_n", { n: files.length, format: outputFormat.toUpperCase() })
            }
            icon={<ArrowRightLeft className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
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
          {FORMAT_INFO[outputFormat]?.alpha ? (
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
          ) : (
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
      </ControlsPanel>
    </div>
  );
}
