import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LayoutGrid, CheckCircle, XCircle } from "lucide-react";
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

interface SpriteSheetResult {
  image_path: string;
  atlas_path: string;
  sprite_count: number;
  sheet_width: number;
  sheet_height: number;
  errors: string[];
}

export function SpriteSheetTab() {
  const { t } = useT();
  const { files, addFiles, removeFile, clearFiles, reorderFiles } = useFileSelection();
  const { getOutputDir } = useWorkspace();
  const { addEntry } = useHistory();
  const [columns, setColumns] = useState(4);
  const [padding, setPadding] = useState(2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpriteSheetResult | null>(null);
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      addFiles(paths);
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
    if (files.length < 2) {
      toast.error(t("toast.select_images"));
      return;
    }
    const outputDir = await getOutputDir("spritesheet");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await invoke<SpriteSheetResult>("generate_spritesheet", {
        imagePaths: files,
        columns: columns,
        padding: padding,
        outputDir: outputDir,
      });

      setResult(res);
      if (res.sprite_count > 0) setPanelMode("results");

      const successCount = res.sprite_count > 0 ? 1 : 0;
      addEntry({
        tabId: "spritesheet",
        filesCount: files.length,
        successCount,
        failCount: res.errors.length,
        outputDir,
      });

      if (res.sprite_count > 0 && res.errors.length === 0) {
        toast.success(t("toast.spritesheet_success", { n: res.sprite_count }));
      } else if (res.sprite_count > 0) {
        toast.warning(t("toast.partial", { completed: res.sprite_count, total: files.length }));
      } else {
        toast.error(t("toast.all_failed"));
      }
    } catch (err) {
      toast.error(t("toast.operation_failed"));
    } finally {
      setLoading(false);
    }
  }, [files, columns, padding, getOutputDir, addEntry, t]);

  const isEmpty = files.length === 0;
  const hasResults = result !== null && result.sprite_count > 0;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={hasResults}
        material={
          <div className="space-y-3">
            <DropZone
              accept="png,jpg,jpeg,bmp,tiff,tif,webp"
              label={isEmpty ? t("dropzone.images_spritesheet") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_spritesheet")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />
            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />
          </div>
        }
        results={
          hasResults && (
            <div className="forge-card space-y-3">
              <div className="flex items-center gap-2">
                {result.errors.length === 0 ? (
                  <CheckCircle className="h-4 w-4" style={{ color: "var(--success)" }} strokeWidth={1.5} />
                ) : (
                  <XCircle className="h-4 w-4" style={{ color: "var(--warning)" }} strokeWidth={1.5} />
                )}
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>
                  {t("result.spritesheet_created", {
                    n: result.sprite_count,
                    w: result.sheet_width,
                    h: result.sheet_height,
                  })}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="forge-chip">spritesheet.png</span>
                <span className="forge-chip">spritesheet.json</span>
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
            disabled={files.length < 2}
            loading={loading}
            loadingText={t("status.creating_spritesheet")}
            text={t("action.create_spritesheet")}
            icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="forge-label">{t("label.columns")}</label>
            <input
              type="number"
              min={1}
              max={32}
              value={columns}
              onChange={(e) => setColumns(Number(e.target.value))}
              className="forge-input w-full"
            />
          </div>
          <div className="space-y-1.5">
            <label className="forge-label">{t("label.padding")}</label>
            <input
              type="number"
              min={0}
              max={64}
              value={padding}
              onChange={(e) => setPadding(Number(e.target.value))}
              className="forge-input w-full"
            />
          </div>
        </div>
      </ControlsPanel>
    </div>
  );
}
