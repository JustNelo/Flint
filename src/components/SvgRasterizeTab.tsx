import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileImage, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { Slider } from "./ui/Slider";
import { useFileSelection } from "../hooks/useFileSelection";
import { useWorkspace } from "../hooks/useWorkspace";
import { useT } from "../i18n/i18n";

interface SvgRasterizeResult {
  output_path: string;
  width: number;
  height: number;
}

type SvgOutputFormat = "png" | "webp";

export function SvgRasterizeTab() {
  const { t } = useT();
  const { files, addFiles, removeFile, clearFiles, reorderFiles } = useFileSelection();
  const { getOutputDir } = useWorkspace();
  const [targetWidth, setTargetWidth] = useState(1024);
  const [outputFormat, setOutputFormat] = useState<SvgOutputFormat>("png");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SvgRasterizeResult | null>(null);
  const [lastOutputDir, setLastOutputDir] = useState("");
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  useEffect(() => {
    if (!loading) setPanelMode(result !== null ? "results" : "material");
  }, [result, loading]);

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      addFiles(paths.slice(0, 1));
      setResult(null);
    },
    [addFiles],
  );

  const handleClearFiles = useCallback(() => {
    clearFiles();
    setResult(null);
  }, [clearFiles]);

  const handleRasterize = useCallback(async () => {
    if (files.length === 0) {
      toast.error(t("toast.select_images"));
      return;
    }
    const outputDir = await getOutputDir("svg-rasterize");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }

    setLoading(true);
    setResult(null);
    setLastOutputDir(outputDir);

    try {
      const res = await invoke<SvgRasterizeResult>("rasterize_svg_cmd", {
        inputPath: files[0],
        targetWidth,
        outputFormat,
        outputDir,
      });

      setResult(res);
      toast.success(t("toast.svg_rasterize_success", { w: res.width, h: res.height }));
    } catch (err) {
      toast.error(t("toast.operation_failed"));
    } finally {
      setLoading(false);
    }
  }, [files, targetWidth, outputFormat, getOutputDir, t]);

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
              accept="svg"
              multiple={false}
              label={isEmpty ? t("dropzone.svg_rasterize") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_svg_rasterize")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />
            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />
          </div>
        }
        results={
          result && (
            <div className="forge-card space-y-2">
              <div className="flex items-center justify-between">
                <p style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>
                  {t("result.svg_rasterized", { w: result.width, h: result.height })}
                </p>
                {lastOutputDir && (
                  <button onClick={() => revealItemInDir(lastOutputDir)} className="btn-ghost">
                    <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
                    {t("label.open_output_folder")}
                  </button>
                )}
              </div>
              <p className="truncate forge-hint">{result.output_path}</p>
            </div>
          )
        }
      />

      <ControlsPanel
        disabled={isEmpty}
        action={
          <ActionButton
            onClick={handleRasterize}
            disabled={isEmpty}
            loading={loading}
            loadingText={t("status.rasterizing")}
            text={t("action.rasterize_svg")}
            icon={<FileImage className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        <div className="space-y-2">
          <label className="forge-label">{t("label.output_format")}</label>
          <div className="flex gap-2">
            {(["png", "webp"] as SvgOutputFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setOutputFormat(f)}
                className={`btn-toggle ${outputFormat === f ? "btn-toggle-active" : ""}`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label={t("label.target_width")}
          value={targetWidth}
          min={16}
          max={4096}
          leftHint="16px"
          rightHint="4096px"
          onChange={setTargetWidth}
        />
      </ControlsPanel>
    </div>
  );
}
