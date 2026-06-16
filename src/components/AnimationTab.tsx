import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Film, CheckCircle, XCircle, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useWorkspace } from "../hooks/useWorkspace";
import { useHistory } from "../hooks/useHistory";
import { useT } from "../i18n/i18n";
import { safeAssetUrl } from "../lib/utils";

interface AnimationResult {
  output_path: string;
  frame_count: number;
  format: string;
  errors: string[];
}

export function AnimationTab() {
  const { t } = useT();
  const { getOutputDir } = useWorkspace();
  const { addEntry } = useHistory();
  const [frames, setFrames] = useState<string[]>([]);
  const [delayMs, setDelayMs] = useState(100);
  const [loopCount, setLoopCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnimationResult | null>(null);
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  const handleFilesSelected = useCallback((paths: string[]) => {
    setFrames((prev) => [...prev, ...paths]);
    setResult(null);
    setPanelMode("material");
  }, []);

  const moveFrame = useCallback((index: number, direction: -1 | 1) => {
    setFrames((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const removeFrame = useCallback((index: number) => {
    setFrames((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearFrames = useCallback(() => {
    setFrames([]);
    setResult(null);
    setPanelMode("material");
  }, []);

  const handleCreate = useCallback(async () => {
    if (frames.length < 2) {
      toast.error(t("toast.select_images"));
      return;
    }
    const outputDir = await getOutputDir("animation");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await invoke<AnimationResult>("create_gif", {
        imagePaths: frames,
        delayMs: delayMs,
        loopCount: loopCount,
        outputDir: outputDir,
      });

      setResult(res);
      if (res.frame_count > 0) setPanelMode("results");

      const successCount = res.frame_count > 0 ? 1 : 0;
      addEntry({
        tabId: "animation",
        filesCount: frames.length,
        successCount,
        failCount: res.errors.length,
        outputDir,
      });

      if (res.frame_count > 0 && res.errors.length === 0) {
        toast.success(t("toast.animation_success", { frames: res.frame_count }));
      } else if (res.frame_count > 0) {
        toast.warning(t("toast.partial", { completed: res.frame_count, total: frames.length }));
      } else {
        toast.error(t("toast.all_failed"));
      }
    } catch (err) {
      toast.error(t("toast.operation_failed"));
    } finally {
      setLoading(false);
    }
  }, [frames, delayMs, loopCount, getOutputDir, addEntry, t]);

  const getFilename = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || path;
  };

  const isEmpty = frames.length === 0;
  const hasResults = result !== null && result.frame_count > 0;

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
              label={isEmpty ? t("dropzone.images_animation") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_animation")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />

            {frames.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-secondary)" }}>
                    {t("result.files_selected", { n: frames.length })}
                  </p>
                  <button
                    onClick={clearFrames}
                    className="text-[10px] text-neutral-500 hover:text-red-400 transition-colors duration-200 cursor-pointer"
                  >
                    {t("label.clear_all")}
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto space-y-1 forge-card p-2">
                  {frames.map((path, index) => (
                    <div
                      key={`${path}-${index}`}
                      className="flex items-center gap-2 px-2 py-1.5 group"
                      style={{
                        borderRadius: 8,
                        fontSize: "var(--text-sm)",
                        color: "var(--text-secondary)",
                        background: "var(--bg-overlay)",
                        transition: "background 150ms ease",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-tertiary)",
                          width: 20,
                          textAlign: "right",
                          flexShrink: 0,
                        }}
                      >
                        {index + 1}
                      </span>
                      <img
                        src={safeAssetUrl(path)}
                        alt=""
                        className="h-7 w-7 rounded object-cover shrink-0"
                        style={{ border: "1px solid var(--bg-border)" }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <span className="flex-1 truncate">{getFilename(path)}</span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => moveFrame(index, -1)}
                          disabled={index === 0}
                          className="btn-icon p-0.5 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => moveFrame(index, 1)}
                          disabled={index === frames.length - 1}
                          className="btn-icon p-0.5 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                        <button onClick={() => removeFrame(index)} className="btn-icon p-0.5">
                          <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
        results={
          hasResults && (
            <div className="forge-card space-y-2">
              <div className="flex items-center gap-2">
                {result.errors.length === 0 ? (
                  <CheckCircle className="h-4 w-4" style={{ color: "var(--success)" }} strokeWidth={1.5} />
                ) : (
                  <XCircle className="h-4 w-4" style={{ color: "var(--warning)" }} strokeWidth={1.5} />
                )}
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>
                  {t("result.animation_created", { frames: result.frame_count, format: "GIF" })}
                </span>
              </div>
              {/* GIF preview */}
              {result.output_path && (
                <div
                  className="overflow-hidden flex items-center justify-center max-h-96"
                  style={{ borderRadius: 12, border: "1px solid var(--bg-border)", background: "var(--bg-base)" }}
                >
                  <img
                    src={safeAssetUrl(result.output_path, true)}
                    alt="Generated GIF"
                    className="max-h-96 object-contain"
                  />
                </div>
              )}
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
            onClick={handleCreate}
            disabled={frames.length < 2}
            loading={loading}
            loadingText={t("status.creating_animation")}
            text={t("action.create_animation")}
            icon={<Film className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="forge-label">{t("label.frame_delay")}</label>
            <input
              type="number"
              min={10}
              max={5000}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              className="forge-input w-full"
            />
          </div>
          <div className="space-y-1.5">
            <label className="forge-label">{t("label.loop_count")}</label>
            <input
              type="number"
              min={0}
              max={9999}
              value={loopCount}
              onChange={(e) => setLoopCount(Number(e.target.value))}
              className="forge-input w-full"
            />
          </div>
        </div>
      </ControlsPanel>
    </div>
  );
}
