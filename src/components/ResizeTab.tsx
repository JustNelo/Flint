import { useState, useCallback, useEffect } from "react";
import { Scaling } from "lucide-react";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { Slider } from "./ui/Slider";
import { useTabProcessor } from "../hooks/useTabProcessor";
import { useT } from "../i18n/i18n";
import type { ResizeMode } from "../types";

const MODE_KEYS: { value: ResizeMode; labelKey: string }[] = [
  { value: "percentage", labelKey: "label.percentage" },
  { value: "width", labelKey: "label.by_width" },
  { value: "height", labelKey: "label.by_height" },
  { value: "exact", labelKey: "label.exact" },
];

const PRESETS: { labelKey: string; w: number; h: number }[] = [
  { labelKey: "preset.1080p", w: 1920, h: 1080 },
  { labelKey: "preset.4k", w: 3840, h: 2160 },
  { labelKey: "preset.instagram_square", w: 1080, h: 1080 },
  { labelKey: "preset.instagram_story", w: 1080, h: 1920 },
  { labelKey: "preset.twitter_header", w: 1500, h: 500 },
  { labelKey: "preset.youtube_thumb", w: 1280, h: 720 },
];

export function ResizeTab() {
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
  } = useTabProcessor({ tabId: "resize", command: "resize_images" });
  const [mode, setMode] = useState<ResizeMode>("percentage");
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [percentage, setPercentage] = useState(50);
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  // Show results after a run, fall back to material when the list is cleared.
  // Guarded by !loading so an in-flight run (which clears results first) does not
  // flash the material view before the new results arrive.
  useEffect(() => {
    if (!loading) setPanelMode(results.length > 0 ? "results" : "material");
  }, [results, loading]);

  const handleResize = useCallback(async () => {
    await process({
      extraParams: { mode, width, height, percentage },
      successMessage: t("toast.resize_success", { n: files.length }),
    });
  }, [process, mode, width, height, percentage, files.length, t]);

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
              label={isEmpty ? t("dropzone.images_resize") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_resize")}
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
            onClick={handleResize}
            disabled={isEmpty}
            loading={loading}
            loadingText={t("status.resizing")}
            text={isEmpty ? t("action.resize") : t("action.resize_n", { n: files.length })}
            icon={<Scaling className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        <div className="flex gap-2 flex-wrap">
          {MODE_KEYS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              className={`btn-toggle ${mode === opt.value ? "btn-toggle-active" : ""}`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>

        <div>
          <label className="forge-label">{t("label.presets")}</label>
          <div className="flex gap-1.5 flex-wrap">
            {PRESETS.map((preset) => (
              <button
                key={preset.labelKey}
                onClick={() => {
                  setMode("exact");
                  setWidth(preset.w);
                  setHeight(preset.h);
                }}
                className="forge-chip"
              >
                {t(preset.labelKey)} ({preset.w}x{preset.h})
              </button>
            ))}
          </div>
        </div>

        {mode === "percentage" && (
          <Slider
            label={t("label.scale")}
            value={percentage}
            min={1}
            max={200}
            leftHint="1%"
            rightHint="200%"
            onChange={setPercentage}
          />
        )}

        {(mode === "width" || mode === "exact") && (
          <div className="flex items-center gap-2">
            <label className="forge-hint" style={{ width: 48 }}>
              {t("label.width")}
            </label>
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="forge-input"
            />
            <span className="forge-hint">{t("label.px")}</span>
          </div>
        )}

        {(mode === "height" || mode === "exact") && (
          <div className="flex items-center gap-2">
            <label className="forge-hint" style={{ width: 48 }}>
              {t("label.height")}
            </label>
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="forge-input"
            />
            <span className="forge-hint">{t("label.px")}</span>
          </div>
        )}
      </ControlsPanel>
    </div>
  );
}
