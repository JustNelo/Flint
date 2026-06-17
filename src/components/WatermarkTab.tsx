import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Stamp, Type, ImageIcon, Upload } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { Slider } from "./ui/Slider";
import { useTabProcessor } from "../hooks/useTabProcessor";
import { useT } from "../i18n/i18n";
import { cn, safeAssetUrl, getFileName } from "../lib/utils";
import type { WatermarkPosition } from "../types";

type WatermarkMode = "text" | "image";

const POSITION_KEYS: { value: WatermarkPosition; labelKey: string }[] = [
  { value: "center", labelKey: "label.center" },
  { value: "bottom-right", labelKey: "label.bottom_right" },
  { value: "bottom-left", labelKey: "label.bottom_left" },
  { value: "top-right", labelKey: "label.top_right" },
  { value: "top-left", labelKey: "label.top_left" },
  { value: "tiled", labelKey: "label.tiled" },
];

export function WatermarkTab() {
  const { t } = useT();
  const [mode, setMode] = useState<WatermarkMode>("text");
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
  } = useTabProcessor({
    tabId: "watermark",
    command: mode === "text" ? "add_watermark" : "add_image_watermark",
  });
  const [text, setText] = useState("");
  const [position, setPosition] = useState<WatermarkPosition>("center");
  const [opacity, setOpacity] = useState(30);
  const [fontSize, setFontSize] = useState(48);
  const [textColor, setTextColor] = useState("#B3B3B3");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoScale, setLogoScale] = useState(25);
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  // Show results after a run, fall back to material when the list is cleared.
  // Guarded by !loading so an in-flight run (which clears results first) does not
  // flash the material view before the new results arrive.
  useEffect(() => {
    if (!loading) setPanelMode(results.length > 0 ? "results" : "material");
  }, [results, loading]);

  const handleSelectLogo = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "svg"] }],
      });
      if (typeof selected === "string") {
        setLogoPath(selected);
      }
    } catch {
      // Dialog cancelled — no notification needed
    }
  }, []);

  const canExecute = mode === "text" ? files.length > 0 && !!text.trim() : files.length > 0 && !!logoPath;

  const handleWatermark = useCallback(async () => {
    if (mode === "text" && !text.trim()) {
      toast.error(t("toast.watermark_text_missing"));
      return;
    }
    if (mode === "image" && !logoPath) {
      toast.error(t("toast.watermark_image_missing"));
      return;
    }

    const extraParams =
      mode === "text"
        ? {
            text: text.trim(),
            position,
            opacity: opacity / 100,
            fontSize,
            color: textColor,
          }
        : {
            watermarkPath: logoPath,
            position,
            opacity: opacity / 100,
            scale: logoScale / 100,
          };

    await process({
      extraParams,
      successMessage: t("toast.watermark_success", { n: files.length }),
    });
  }, [process, mode, text, logoPath, position, opacity, fontSize, textColor, logoScale, files.length, t]);

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
              accept="png,jpg,jpeg,bmp,tiff,tif,webp"
              label={isEmpty ? t("dropzone.images_watermark") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_watermark")}
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
            onClick={handleWatermark}
            disabled={!canExecute}
            loading={loading}
            loadingText={t("status.watermarking")}
            text={isEmpty ? t("action.watermark") : t("action.watermark_n", { n: files.length })}
            icon={<Stamp className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        {/* Mode toggle: Text / Image */}
        <div className="flex gap-2">
          {(["text", "image"] as WatermarkMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn("btn-toggle", mode === m && "btn-toggle-active")}>
              {m === "text" ? (
                <Type className="h-3.5 w-3.5" strokeWidth={1.5} />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {m === "text" ? t("label.watermark_text_mode") : t("label.watermark_image_mode")}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* Text-specific controls */}
          {mode === "text" && (
            <>
              <div>
                <label className="forge-label">{t("label.watermark_text")}</label>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("label.placeholder_watermark")}
                  className="forge-input w-full"
                />
              </div>
              <Slider
                label={t("label.font_size")}
                value={fontSize}
                min={8}
                max={200}
                unit="px"
                onChange={setFontSize}
              />
              <div>
                <label className="forge-label">{t("label.watermark_color")}</label>
                <div className="flex items-center gap-2">
                  <label className="relative cursor-pointer">
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="absolute inset-0 opacity-0 w-0 h-0 cursor-pointer"
                    />
                    <div
                      className="h-8 w-8 cursor-pointer"
                      style={{
                        borderRadius: 6,
                        border: "1px solid var(--bg-border)",
                        transition: "border-color 150ms ease",
                        backgroundColor: textColor,
                      }}
                    />
                  </label>
                  <input
                    type="text"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    maxLength={7}
                    className="forge-input"
                    style={{ width: 96, flex: "none", fontFamily: "var(--font-mono)" }}
                  />
                </div>
              </div>
            </>
          )}

          {/* Image-specific controls */}
          {mode === "image" && (
            <>
              <div>
                <label className="forge-label">{t("label.watermark_logo")}</label>
                <button
                  onClick={handleSelectLogo}
                  className="flex items-center gap-2 w-full px-3 py-3 cursor-pointer"
                  style={{
                    borderRadius: 8,
                    border: "1px dashed var(--bg-border)",
                    background: "var(--bg-overlay)",
                    fontSize: "var(--text-sm)",
                    color: "var(--text-secondary)",
                    transition: "all 150ms ease",
                  }}
                >
                  <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {logoPath ? getFileName(logoPath) : t("label.select_logo")}
                </button>
                {logoPath && (
                  <div
                    className="mt-2 flex items-center gap-2 p-2"
                    style={{ borderRadius: 8, border: "1px solid var(--bg-border)", background: "var(--bg-overlay)" }}
                  >
                    <img
                      src={safeAssetUrl(logoPath)}
                      alt="Logo"
                      className="h-8 w-8 rounded object-contain"
                      style={{ background: "var(--bg-elevated)" }}
                    />
                    <span className="truncate flex-1 forge-hint">{getFileName(logoPath)}</span>
                  </div>
                )}
              </div>
              <Slider
                label={t("label.watermark_scale")}
                value={logoScale}
                min={5}
                max={80}
                unit="%"
                onChange={setLogoScale}
              />
            </>
          )}

          {/* Shared controls */}
          <div>
            <label className="forge-label">{t("label.position")}</label>
            <div className="flex gap-2 flex-wrap">
              {POSITION_KEYS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPosition(opt.value)}
                  className={`btn-toggle ${position === opt.value ? "btn-toggle-active" : ""}`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <Slider label={t("label.opacity")} value={opacity} min={5} max={100} onChange={setOpacity} />
        </div>
      </ControlsPanel>
    </div>
  );
}
