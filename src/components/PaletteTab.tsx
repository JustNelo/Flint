import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Pipette, Copy, Check, FileJson, FileCode, Crosshair } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { useFileSelection } from "../hooks/useFileSelection";
import { useT } from "../i18n/i18n";
import { safeAssetUrl, logError } from "../lib/utils";

interface ColorInfo {
  hex: string;
  r: number;
  g: number;
  b: number;
  percentage: number;
}

interface PaletteResult {
  colors: ColorInfo[];
  source_path: string;
}

type PaletteMode = "palette" | "eyedropper";

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function formatHsl(r: number, g: number, b: number): string {
  const { h, s, l } = rgbToHsl(r, g, b);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function ColorCard({
  color,
  index,
  copiedIndex,
  onCopy,
}: {
  color: ColorInfo;
  index: number;
  copiedIndex: number | null;
  onCopy: (hex: string, index: number) => void;
}) {
  const hsl = useMemo(() => formatHsl(color.r, color.g, color.b), [color.r, color.g, color.b]);

  return (
    <button
      onClick={() => onCopy(color.hex, index)}
      className="flex items-center gap-3 p-2.5 cursor-pointer group"
      style={{
        borderRadius: 12,
        border: "1px solid var(--bg-border)",
        background: "var(--bg-overlay)",
        transition: "background 150ms ease",
      }}
    >
      <div
        className="h-8 w-8 shrink-0"
        style={{ borderRadius: 8, border: "1px solid var(--bg-border)", backgroundColor: color.hex }}
      />
      <div className="flex-1 text-left min-w-0">
        <p
          style={{
            fontSize: "var(--text-sm)",
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          {color.hex}
        </p>
        <p className="text-[10px] text-neutral-500 truncate">
          rgb({color.r}, {color.g}, {color.b})
        </p>
        <p className="text-[10px] text-neutral-600 truncate">{hsl}</p>
        {color.percentage > 0 && <p className="text-[10px] text-neutral-600">{color.percentage}%</p>}
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        {copiedIndex === index ? (
          <Check className="h-3.5 w-3.5 text-green-400" strokeWidth={1.5} />
        ) : (
          <Copy className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.5} />
        )}
      </div>
    </button>
  );
}

export function PaletteTab() {
  const { t } = useT();
  const { files, addFiles, removeFile, clearFiles, reorderFiles } = useFileSelection();
  const [mode, setMode] = useState<PaletteMode>("palette");
  const [numColors, setNumColors] = useState(6);
  const [, setLoading] = useState(false);
  const [palette, setPalette] = useState<ColorInfo[]>([]);
  const [pickedColor, setPickedColor] = useState<ColorInfo | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Cleanup timer on unmount to prevent setting state on unmounted component
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      addFiles(paths.slice(0, 1));
      setPalette([]);
      setPickedColor(null);
    },
    [addFiles],
  );

  const handleClearFiles = useCallback(() => {
    clearFiles();
    setPalette([]);
    setPickedColor(null);
  }, [clearFiles]);

  // Draw image onto canvas when file changes (eyedropper mode)
  useEffect(() => {
    if (mode !== "eyedropper" || files.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const maxW = canvas.parentElement?.clientWidth || 600;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    };
    img.src = safeAssetUrl(files[0]);
  }, [files, mode]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const [r, g, b] = pixel;
    const hex = `#${r.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}`;

    setPickedColor({ hex, r, g, b, percentage: 0 });
  }, []);

  // Live palette extraction (palette mode), debounced on the color-count slider.
  useEffect(() => {
    if (mode !== "palette" || files.length === 0) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const id = setTimeout(() => {
      invoke<PaletteResult>("extract_palette", { imagePath: files[0], numColors })
        .then((result) => {
          if (!cancelled) setPalette(result.colors);
        })
        .catch((err) => {
          if (!cancelled) {
            logError("palette:extract", err);
            setPalette([]);
            toast.error(t("toast.operation_failed"));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [files, numColors, mode, t]);

  const copyHex = useCallback(async (hex: string, index: number) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedIndex(index);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      // Fallback for environments where clipboard API isn't available
    }
  }, []);

  const copyAllHex = useCallback(async () => {
    if (palette.length === 0) return;
    try {
      await navigator.clipboard.writeText(palette.map((c) => c.hex).join("\n"));
      toast.success(t("toast.copied"));
    } catch (err) {
      logError("palette:copyall", err);
      toast.error(t("toast.copy_failed"));
    }
  }, [palette, t]);

  const copyPickedColor = useCallback(async () => {
    if (!pickedColor) return;
    try {
      await navigator.clipboard.writeText(pickedColor.hex);
      toast.success(t("toast.copied"));
    } catch {
      // ignore
    }
  }, [pickedColor, t]);

  const exportJson = useCallback(() => {
    const colors = palette.length > 0 ? palette : pickedColor ? [pickedColor] : [];
    const json = JSON.stringify(
      colors.map((c) => ({
        hex: c.hex,
        rgb: { r: c.r, g: c.g, b: c.b },
        hsl: rgbToHsl(c.r, c.g, c.b),
        percentage: c.percentage,
      })),
      null,
      2,
    );
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "palette.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [palette, pickedColor]);

  const exportCss = useCallback(() => {
    const colors = palette.length > 0 ? palette : pickedColor ? [pickedColor] : [];
    const lines = colors.map((c, i) => `  --color-${i + 1}: ${c.hex};`).join("\n");
    const css = `:root {\n${lines}\n}`;
    const blob = new Blob([css], { type: "text/css" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "palette.css";
    a.click();
    URL.revokeObjectURL(url);
  }, [palette, pickedColor]);

  const PANEL: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid var(--bg-border)",
    background: "var(--bg-elevated)",
    padding: 14,
  };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <section className="flex-1 min-w-0" style={PANEL}>
        {/* LEFT — source */}
        <div className="space-y-5">
          {/* Mode toggle */}
          <div className="space-y-2">
            <label className="forge-label">{t("label.palette_mode")}</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("palette")}
                className={`btn-toggle ${mode === "palette" ? "btn-toggle-active" : ""}`}
              >
                <Pipette className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t("label.palette_extract")}
              </button>
              <button
                onClick={() => setMode("eyedropper")}
                className={`btn-toggle ${mode === "eyedropper" ? "btn-toggle-active" : ""}`}
              >
                <Crosshair className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t("label.eyedropper")}
              </button>
            </div>
          </div>

          <DropZone
            accept="png,jpg,jpeg,bmp,tiff,tif,webp"
            label={files.length === 0 ? t("dropzone.images_palette") : t("dropzone.add_more")}
            sublabel={t("dropzone.sublabel_palette")}
            compact={files.length > 0}
            multiple={false}
            onFilesSelected={handleFilesSelected}
          />

          <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />

          {/* Eyedropper mode */}
          {mode === "eyedropper" && files.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-neutral-500">{t("label.eyedropper_hint")}</p>
              <div className="forge-card overflow-hidden p-0">
                <canvas ref={canvasRef} onClick={handleCanvasClick} className="w-full cursor-crosshair" />
              </div>
            </div>
          )}
        </div>
      </section>

      <section style={{ width: 360, flexShrink: 0, ...PANEL }}>
        {/* RIGHT — output */}
        {mode === "palette" ? (
          <>
            <div className="space-y-2">
              <label className="forge-label">{t("label.num_colors")}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={3}
                  max={12}
                  value={numColors}
                  onChange={(e) => setNumColors(Number(e.target.value))}
                  className="flex-1 forge-slider"
                  style={{
                    background: `linear-gradient(to right, var(--indigo-core) 0%, var(--indigo-core) ${((numColors - 3) / (12 - 3)) * 100}%, var(--bg-overlay) ${((numColors - 3) / (12 - 3)) * 100}%, var(--bg-overlay) 100%)`,
                  }}
                />
                <span
                  style={{
                    fontSize: "var(--text-sm)",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-tertiary)",
                    width: 24,
                    textAlign: "right" as const,
                  }}
                >
                  {numColors}
                </span>
              </div>
            </div>

            {palette.length > 0 ? (
              <div className="mt-4 space-y-3">
                <div className="forge-card p-4 space-y-3">
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>
                    {t("result.colors_extracted", { n: palette.length })}
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    {palette.map((color, index) => (
                      <ColorCard key={index} color={color} index={index} copiedIndex={copiedIndex} onCopy={copyHex} />
                    ))}
                  </div>

                  {/* Color bar preview */}
                  <div
                    className="flex h-8 overflow-hidden"
                    style={{ borderRadius: 8, border: "1px solid var(--bg-border)" }}
                  >
                    {palette.map((color, index) => (
                      <div key={index} className="flex-1" style={{ backgroundColor: color.hex }} />
                    ))}
                  </div>
                </div>

                <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                  <button onClick={exportJson} className="btn-ghost">
                    <FileJson className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {t("label.export_json")}
                  </button>
                  <button onClick={exportCss} className="btn-ghost">
                    <FileCode className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {t("label.export_css")}
                  </button>
                  <button onClick={copyAllHex} disabled={palette.length === 0} className="btn-ghost">
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {t("action.copy_all_hex")}
                  </button>
                </div>
              </div>
            ) : (
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                {t("dropzone.sublabel_palette")}
              </span>
            )}
          </>
        ) : (
          <>
            {pickedColor ? (
              <div className="forge-card p-4">
                <div className="flex items-center gap-4">
                  <div
                    className="h-14 w-14 shrink-0"
                    style={{ borderRadius: 12, border: "1px solid var(--bg-border)", backgroundColor: pickedColor.hex }}
                  />
                  <div className="flex-1 space-y-1">
                    <p
                      style={{
                        fontSize: "var(--text-base)",
                        fontFamily: "var(--font-mono)",
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {pickedColor.hex}
                    </p>
                    <p className="text-xs font-mono text-neutral-400">
                      rgb({pickedColor.r}, {pickedColor.g}, {pickedColor.b})
                    </p>
                    <p className="text-xs font-mono text-neutral-500">
                      {formatHsl(pickedColor.r, pickedColor.g, pickedColor.b)}
                    </p>
                  </div>
                  <button onClick={copyPickedColor} className="btn-icon">
                    <Copy className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ) : (
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                {t("label.eyedropper_hint")}
              </span>
            )}
          </>
        )}
      </section>
    </div>
  );
}
