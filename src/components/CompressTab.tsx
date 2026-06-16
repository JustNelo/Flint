import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { Slider } from "./ui/Slider";
import { useFileSelection } from "../hooks/useFileSelection";
import { useWorkspace } from "../hooks/useWorkspace";
import { useHistory } from "../hooks/useHistory";
import { usePersistedState } from "../hooks/usePersistedState";
import { useT } from "../i18n/i18n";
import type { BatchProgress, ProcessingResult } from "../types";

type CompressFormat = "webp" | "jpeg";

export function CompressTab() {
  const { t } = useT();
  const { files, addFiles, removeFile, clearFiles, reorderFiles } = useFileSelection();
  const { getOutputDir } = useWorkspace();
  const { addEntry } = useHistory();
  const [format, setFormat] = usePersistedState<CompressFormat>("compress.format", "webp");
  const [quality, setQuality] = usePersistedState("compress.quality", 80);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProcessingResult[]>([]);
  const [lastOutputDir, setLastOutputDir] = useState("");
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      addFiles(paths);
      setResults([]);
      setPanelMode("material");
    },
    [addFiles],
  );

  const handleClearFiles = useCallback(() => {
    clearFiles();
    setResults([]);
    setPanelMode("material");
  }, [clearFiles]);

  const handleCompress = useCallback(async () => {
    if (files.length === 0) {
      toast.error(t("toast.select_images"));
      return;
    }
    const outputDir = await getOutputDir("compress");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }

    setLoading(true);
    setResults([]);
    setLastOutputDir(outputDir);

    try {
      const command = format === "webp" ? "compress_webp" : "compress_jpeg";
      const result = await invoke<BatchProgress>(command, {
        inputPaths: files,
        quality,
        outputDir,
      });

      setResults(result.results);
      if (result.results.length > 0) setPanelMode("results");

      const successCount = result.results.filter((r) => r.success).length;
      const failCount = result.results.filter((r) => !r.success).length;
      addEntry({ tabId: "compress", filesCount: result.total, successCount, failCount, outputDir });

      if (result.completed === result.total) {
        toast.success(t("toast.compress_success", { n: result.completed, format: format.toUpperCase() }));
      } else if (result.completed > 0) {
        toast.warning(t("toast.partial", { completed: result.completed, total: result.total }));
      } else {
        toast.error(t("toast.all_failed"));
      }
    } catch (err) {
      toast.error(t("toast.operation_failed"));
    } finally {
      setLoading(false);
    }
  }, [files, format, quality, getOutputDir, addEntry, t]);

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
              accept="png,jpg,jpeg,bmp,ico,tiff,tif,webp"
              label={isEmpty ? t("dropzone.images_compress") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_compress")}
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
          <>
            <ActionButton
              onClick={handleCompress}
              disabled={isEmpty}
              loading={loading}
              loadingText={t("status.compressing")}
              text={isEmpty ? t("action.compress") : t("action.compress_n", { n: files.length })}
              icon={<Zap className="h-4 w-4" strokeWidth={1.5} />}
            />
            {!isEmpty && !loading && (
              <p
                className="text-center"
                style={{ marginTop: 6, fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
              >
                {t("action.ready_hint")}
              </p>
            )}
          </>
        }
      >
        <div className="space-y-2">
          <label
            className="font-semibold uppercase"
            style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
          >
            {t("label.output_format")}
          </label>
          <div className="flex gap-2">
            {(["webp", "jpeg"] as CompressFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`btn-toggle ${format === f ? "btn-toggle-active" : ""}`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label={t("label.quality")}
          value={quality}
          min={1}
          max={100}
          leftHint={t("label.smaller_file")}
          rightHint={t("label.higher_quality")}
          onChange={setQuality}
        />
      </ControlsPanel>
    </div>
  );
}
