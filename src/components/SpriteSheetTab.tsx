import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultCard } from "./ResultCard";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useFileSelection } from "../hooks/useFileSelection";
import { useWorkspace } from "../hooks/useWorkspace";
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
  const [columns, setColumns] = useState(4);
  const [padding, setPadding] = useState(2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpriteSheetResult | null>(null);
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  const hasResults = result !== null && result.sprite_count > 0;

  useEffect(() => {
    if (!loading) setPanelMode(hasResults ? "results" : "material");
  }, [hasResults, loading]);

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      addFiles(paths);
      setResult(null);
    },
    [addFiles],
  );

  const handleClearFiles = useCallback(() => {
    clearFiles();
    setResult(null);
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
  }, [files, columns, padding, getOutputDir, t]);

  const isEmpty = files.length === 0;

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
            <ResultCard
              success={result.errors.length === 0}
              title={t("result.spritesheet_created", {
                n: result.sprite_count,
                w: result.sheet_width,
                h: result.sheet_height,
              })}
              chips={
                <>
                  <span className="forge-chip">spritesheet.png</span>
                  <span className="forge-chip">spritesheet.json</span>
                </>
              }
              errors={result.errors}
            />
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
