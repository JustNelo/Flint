import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Globe, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useFileSelection } from "../hooks/useFileSelection";
import { useWorkspace } from "../hooks/useWorkspace";
import { useHistory } from "../hooks/useHistory";
import { useT } from "../i18n/i18n";

interface FaviconResult {
  zip_path: string;
  generated_files: string[];
  errors: string[];
}

export function FaviconTab() {
  const { t } = useT();
  const { files, addFiles, removeFile, clearFiles, reorderFiles } = useFileSelection();
  const { getOutputDir } = useWorkspace();
  const { addEntry } = useHistory();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FaviconResult | null>(null);
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      addFiles(paths.slice(0, 1));
      setResult(null);
      setPanelMode("material");
    },
    [addFiles],
  );

  const handleClearFiles = useCallback(() => {
    clearFiles();
    setResult(null);
    setPanelMode("material");
  }, [clearFiles]);

  const handleGenerate = useCallback(async () => {
    if (files.length === 0) {
      toast.error(t("toast.select_images"));
      return;
    }
    const outputDir = await getOutputDir("favicon");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await invoke<FaviconResult>("generate_favicons", {
        imagePath: files[0],
        outputDir: outputDir,
      });

      setResult(res);
      setPanelMode("results");

      addEntry({
        tabId: "favicon",
        filesCount: 1,
        successCount: res.generated_files.length > 0 ? 1 : 0,
        failCount: res.errors.length,
        outputDir,
      });

      if (res.generated_files.length > 0 && res.errors.length === 0) {
        toast.success(t("toast.favicon_success"));
      } else if (res.generated_files.length > 0) {
        toast.warning(
          t("toast.partial", {
            completed: res.generated_files.length,
            total: res.generated_files.length + res.errors.length,
          }),
        );
      } else {
        toast.error(t("toast.all_failed"));
      }
    } catch (err) {
      toast.error(t("toast.operation_failed"));
    } finally {
      setLoading(false);
    }
  }, [files, getOutputDir, addEntry, t]);

  const isEmpty = files.length === 0;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={result !== null}
        material={
          <div className="space-y-3">
            <DropZone
              accept="png,jpg,jpeg,bmp,tiff,tif,webp"
              label={isEmpty ? t("dropzone.images_favicon") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_favicon")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />
            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />
          </div>
        }
        results={
          result && (
            <div className="forge-card space-y-3">
              <div className="flex items-center gap-2">
                {result.errors.length === 0 ? (
                  <CheckCircle className="h-4 w-4" style={{ color: "var(--success)" }} strokeWidth={1.5} />
                ) : (
                  <XCircle className="h-4 w-4" style={{ color: "var(--warning)" }} strokeWidth={1.5} />
                )}
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>
                  {t("result.favicons_generated")}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {result.generated_files.map((file) => (
                  <span key={file} className="forge-chip">
                    {file}
                  </span>
                ))}
              </div>

              {result.errors.length > 0 && (
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {result.errors.map((err, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2"
                      style={{ fontSize: "var(--text-sm)", color: "rgba(239,68,68,0.8)" }}
                    >
                      <XCircle className="h-3 w-3 shrink-0 mt-0.5" strokeWidth={1.5} />
                      <span>{err}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        }
      />

      <ControlsPanel
        disabled={isEmpty}
        action={
          <ActionButton
            onClick={handleGenerate}
            disabled={isEmpty}
            loading={loading}
            loadingText={t("status.generating_favicons")}
            text={t("action.generate_favicons")}
            icon={<Globe className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        <></>
      </ControlsPanel>
    </div>
  );
}
