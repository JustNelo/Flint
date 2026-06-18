import { useState, useCallback, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useTabProcessor } from "../hooks/useTabProcessor";
import { useT } from "../i18n/i18n";

export function OptimizeTab() {
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
  } = useTabProcessor({ tabId: "optimize", command: "optimize_images" });
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  useEffect(() => {
    if (!loading) setPanelMode(results.length > 0 ? "results" : "material");
  }, [results, loading]);

  const handleOptimize = useCallback(async () => {
    await process({
      successMessage: t("toast.optimize_success", { n: files.length }),
    });
  }, [process, files.length, t]);

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
              accept="png,jpg,jpeg"
              label={isEmpty ? t("dropzone.images_optimize") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_optimize")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />
            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />
          </div>
        }
        results={
          <ResultsBanner results={results} total={files.length} outputDir={lastOutputDir} sourceTab="optimize" />
        }
      />

      <ControlsPanel
        disabled={isEmpty}
        action={
          <ActionButton
            onClick={handleOptimize}
            disabled={isEmpty}
            loading={loading}
            loadingText={t("status.optimizing")}
            text={isEmpty ? t("action.optimize") : t("action.optimize_n", { n: files.length })}
            icon={<Sparkles className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        <></>
      </ControlsPanel>
    </div>
  );
}
