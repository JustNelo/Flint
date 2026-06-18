import { useState, useCallback, useRef, useEffect } from "react";
import { Crop, RotateCcw } from "lucide-react";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useTabProcessor } from "../hooks/useTabProcessor";
import { useT } from "../i18n/i18n";
import { safeAssetUrl } from "../lib/utils";

/** Rectangle in normalised image coordinates (0–1) */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move" | null;

const HANDLE_CURSORS: Record<string, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  move: "move",
};

const HANDLE_SIZE = 14; // px — hit target for edge/corner handles

/** Default crop: 80 % of the image, centred */
const DEFAULT_RECT: Rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function CropTab() {
  const { t } = useT();
  const {
    files,
    addFiles,
    removeFile,
    clearFiles,
    reorderFiles,
    loading,
    results,
    setResults,
    lastOutputDir,
    process,
  } = useTabProcessor({ tabId: "crop", command: "crop_images" });
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [sel, setSel] = useState<Rect>({ ...DEFAULT_RECT });

  // Drag state — stored in refs so pointer-move doesn't trigger extra renders
  const activeHandle = useRef<Handle>(null);
  const dragOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragSelStart = useRef<Rect>({ ...DEFAULT_RECT });
  const [isDragging, setIsDragging] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Rendered image bounds relative to the container (px)
  const [imgBounds, setImgBounds] = useState<{ oX: number; oY: number; rW: number; rH: number } | null>(null);

  // ── File handlers ────────────────────────────────────────────────────
  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      clearFiles();
      addFiles(paths.slice(0, 1));
      setResults([]);
      setSel({ ...DEFAULT_RECT });
      setNaturalSize(null);
      setPanelMode("material");
    },
    [addFiles, clearFiles, setResults],
  );

  const handleClearFiles = useCallback(() => {
    clearFiles();
    setResults([]);
    setSel({ ...DEFAULT_RECT });
    setNaturalSize(null);
    setPanelMode("material");
  }, [clearFiles, setResults]);

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (img) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, []);

  const resetSelection = useCallback(() => setSel({ ...DEFAULT_RECT }), []);

  // Keep rendered image bounds in sync via ResizeObserver
  const updateImgBounds = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !naturalSize) {
      setImgBounds(null);
      return;
    }
    const cR = container.getBoundingClientRect();
    const cW = cR.width;
    const cH = cR.height;
    const iA = naturalSize.w / naturalSize.h;
    const cA = cW / cH;
    let rW: number, rH: number, oX: number, oY: number;
    if (iA > cA) {
      rW = cW;
      rH = cW / iA;
      oX = 0;
      oY = (cH - rH) / 2;
    } else {
      rH = cH;
      rW = cH * iA;
      oX = (cW - rW) / 2;
      oY = 0;
    }
    setImgBounds({ oX, oY, rW, rH });
  }, [naturalSize]);

  useEffect(() => {
    updateImgBounds();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => updateImgBounds());
    ro.observe(container);
    return () => ro.disconnect();
  }, [updateImgBounds]);

  // ── Coordinate helpers ───────────────────────────────────────────────
  /** Rendered image bounds in screen coordinates (for pointer events) */
  const getRenderedBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container || !imgBounds) return null;
    const cR = container.getBoundingClientRect();
    return {
      left: cR.left + imgBounds.oX,
      top: cR.top + imgBounds.oY,
      width: imgBounds.rW,
      height: imgBounds.rH,
    };
  }, [imgBounds]);

  /** Determine which handle (if any) sits under the pointer */
  const hitTest = useCallback(
    (clientX: number, clientY: number): Handle => {
      const b = getRenderedBounds();
      if (!b) return null;
      const px = clientX - b.left;
      const py = clientY - b.top;
      const hs = HANDLE_SIZE;

      // Selection edges in pixel-space
      const l = sel.x * b.width;
      const t = sel.y * b.height;
      const r = (sel.x + sel.w) * b.width;
      const bo = (sel.y + sel.h) * b.height;

      const nearL = Math.abs(px - l) < hs;
      const nearR = Math.abs(px - r) < hs;
      const nearT = Math.abs(py - t) < hs;
      const nearB = Math.abs(py - bo) < hs;
      const inX = px > l + hs && px < r - hs;
      const inY = py > t + hs && py < bo - hs;

      if (nearT && nearL) return "nw";
      if (nearT && nearR) return "ne";
      if (nearB && nearL) return "sw";
      if (nearB && nearR) return "se";
      if (nearT && inX) return "n";
      if (nearB && inX) return "s";
      if (nearL && inY) return "w";
      if (nearR && inY) return "e";
      if (inX && inY) return "move";
      return null;
    },
    [getRenderedBounds, sel],
  );

  // ── Pointer handlers ─────────────────────────────────────────────────
  const [cursor, setCursor] = useState("crosshair");

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const handle = hitTest(e.clientX, e.clientY);
      if (!handle) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      activeHandle.current = handle;
      dragOrigin.current = { x: e.clientX, y: e.clientY };
      dragSelStart.current = { ...sel };
      setIsDragging(true);
    },
    [hitTest, sel],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Update cursor even when not dragging
      if (!isDragging) {
        const handle = hitTest(e.clientX, e.clientY);
        setCursor(handle ? HANDLE_CURSORS[handle] : "crosshair");
        return;
      }

      const b = getRenderedBounds();
      if (!b) return;
      const dx = (e.clientX - dragOrigin.current.x) / b.width;
      const dy = (e.clientY - dragOrigin.current.y) / b.height;
      const s = dragSelStart.current;
      const h = activeHandle.current;

      let nx = s.x;
      let ny = s.y;
      let nw = s.w;
      let nh = s.h;

      if (h === "move") {
        nx = clamp(s.x + dx, 0, 1 - s.w);
        ny = clamp(s.y + dy, 0, 1 - s.h);
      } else {
        // Resize — compute new edges
        let left = s.x;
        let top = s.y;
        let right = s.x + s.w;
        let bottom = s.y + s.h;

        if (h === "nw" || h === "w" || h === "sw") left = clamp(s.x + dx, 0, right - 0.01);
        if (h === "ne" || h === "e" || h === "se") right = clamp(right + dx, left + 0.01, 1);
        if (h === "nw" || h === "n" || h === "ne") top = clamp(s.y + dy, 0, bottom - 0.01);
        if (h === "sw" || h === "s" || h === "se") bottom = clamp(bottom + dy, top + 0.01, 1);

        nx = left;
        ny = top;
        nw = right - left;
        nh = bottom - top;
      }

      setSel({ x: nx, y: ny, w: nw, h: nh });
    },
    [isDragging, hitTest, getRenderedBounds],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    activeHandle.current = null;
    setIsDragging(false);
  }, []);

  // ── Pixel values ─────────────────────────────────────────────────────
  const pixelRect = naturalSize
    ? {
        x: Math.round(sel.x * naturalSize.w),
        y: Math.round(sel.y * naturalSize.h),
        w: Math.max(1, Math.round(sel.w * naturalSize.w)),
        h: Math.max(1, Math.round(sel.h * naturalSize.h)),
      }
    : null;

  // Show results after a run, fall back to material when the list is cleared.
  // Guarded by !loading so an in-flight run (which clears results first) does not
  // flash the material view before the new results arrive.
  useEffect(() => {
    if (!loading) setPanelMode(results.length > 0 ? "results" : "material");
  }, [results, loading]);

  // ── Crop action ──────────────────────────────────────────────────────
  const handleCrop = useCallback(async () => {
    if (!pixelRect) return;
    await process({
      extraParams: {
        ratio: "free",
        anchor: "top-left",
        width: pixelRect.w,
        height: pixelRect.h,
        cropX: pixelRect.x,
        cropY: pixelRect.y,
      },
      successMessage: t("toast.crop_success", { n: files.length }),
    });
  }, [pixelRect, process, files.length, t]);

  const isEmpty = files.length === 0;

  // ── Render ───────────────────────────────────────────────────────────
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
              label={isEmpty ? t("dropzone.images_crop") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_crop")}
              compact={!isEmpty}
              multiple={false}
              onFilesSelected={handleFilesSelected}
            />

            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />

            {/* Interactive crop canvas */}
            {files.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-neutral-500">{t("label.crop_draw_hint")}</span>
                  <button
                    onClick={resetSelection}
                    className="flex items-center gap-1 cursor-pointer forge-hint"
                    style={{ transition: "color 150ms ease" }}
                  >
                    <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                    {t("label.reset")}
                  </button>
                </div>

                <div
                  ref={containerRef}
                  className="relative overflow-hidden select-none touch-none"
                  style={{
                    borderRadius: 12,
                    border: "1px solid var(--bg-border)",
                    background: "var(--bg-base)",
                    cursor,
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  <img
                    ref={imgRef}
                    src={safeAssetUrl(files[0])}
                    alt=""
                    onLoad={handleImageLoad}
                    className="w-full max-h-112 object-contain pointer-events-none"
                    draggable={false}
                  />

                  {/* Dark overlay with cut-out — positioned in px relative to rendered image */}
                  {sel.w > 0 && sel.h > 0 && imgBounds && (
                    <div
                      className="absolute border-2 border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] pointer-events-none"
                      style={{
                        left: imgBounds.oX + sel.x * imgBounds.rW,
                        top: imgBounds.oY + sel.y * imgBounds.rH,
                        width: sel.w * imgBounds.rW,
                        height: sel.h * imgBounds.rH,
                      }}
                    >
                      {/* Rule-of-thirds grid lines */}
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/15" />
                        <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/15" />
                        <div className="absolute top-1/3 left-0 right-0 h-px bg-white/15" />
                        <div className="absolute top-2/3 left-0 right-0 h-px bg-white/15" />
                      </div>

                      {/* 8 resize handles */}
                      {/* Corners */}
                      <div className="absolute -top-1.5 -left-1.5 h-3 w-3 border-2 border-white bg-white rounded-sm" />
                      <div className="absolute -top-1.5 -right-1.5 h-3 w-3 border-2 border-white bg-white rounded-sm" />
                      <div className="absolute -bottom-1.5 -left-1.5 h-3 w-3 border-2 border-white bg-white rounded-sm" />
                      <div className="absolute -bottom-1.5 -right-1.5 h-3 w-3 border-2 border-white bg-white rounded-sm" />
                      {/* Edge midpoints */}
                      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-2 w-5 bg-white rounded-full" />
                      <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-2 w-5 bg-white rounded-full" />
                      <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-2 h-5 bg-white rounded-full" />
                      <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-2 h-5 bg-white rounded-full" />
                    </div>
                  )}

                  {/* Pixel info badge */}
                  {pixelRect && (
                    <div className="absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-0.5 text-[10px] font-mono text-white/80 backdrop-blur-sm pointer-events-none">
                      {pixelRect.w} × {pixelRect.h}px
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        }
        results={<ResultsBanner results={results} total={files.length} outputDir={lastOutputDir} sourceTab="crop" />}
      />

      <ControlsPanel
        disabled={isEmpty}
        action={
          <ActionButton
            onClick={handleCrop}
            disabled={files.length === 0 || !pixelRect}
            loading={loading}
            loadingText={t("status.cropping")}
            text={files.length > 0 ? t("action.crop_n", { n: files.length }) : t("action.crop")}
            icon={<Crop className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        {pixelRect && naturalSize ? (
          <div className="space-y-2">
            <label
              className="font-semibold uppercase"
              style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
            >
              {t("label.crop_draw_hint")}
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(["x", "y", "w", "h"] as const).map((field) => {
                const labelMap = { x: "X", y: "Y", w: t("label.width"), h: t("label.height") };
                const maxMap = { x: naturalSize.w, y: naturalSize.h, w: naturalSize.w, h: naturalSize.h };
                return (
                  <div key={field} className="space-y-1.5">
                    <label className="forge-label">{labelMap[field]}</label>
                    <input
                      type="number"
                      min={field === "w" || field === "h" ? 1 : 0}
                      max={maxMap[field]}
                      value={pixelRect[field]}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(Number(e.target.value) || 0, maxMap[field]));
                        setSel((prev) => {
                          if (field === "x") return { ...prev, x: v / naturalSize.w };
                          if (field === "y") return { ...prev, y: v / naturalSize.h };
                          if (field === "w") return { ...prev, w: Math.max(1 / naturalSize.w, v / naturalSize.w) };
                          return { ...prev, h: Math.max(1 / naturalSize.h, v / naturalSize.h) };
                        });
                      }}
                      className="forge-input w-full"
                    />
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              {naturalSize.w} × {naturalSize.h}px
            </p>
          </div>
        ) : (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>{t("label.crop_draw_hint")}</p>
        )}
      </ControlsPanel>
    </div>
  );
}
