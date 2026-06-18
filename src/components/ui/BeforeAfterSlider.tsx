import { useRef, useCallback, useMemo, memo } from "react";
import { X, ArrowRight } from "lucide-react";
import { formatSize, safeAssetUrl } from "../../lib/utils";
import { useT } from "../../i18n/i18n";
import type { ProcessingResult } from "../../types";

interface BeforeAfterSliderProps {
  result: ProcessingResult;
  onClose: () => void;
}

export const BeforeAfterSlider = memo(function BeforeAfterSlider({ result, onClose }: BeforeAfterSliderProps) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateSlider = useCallback((pct: number) => {
    const v = `${pct}%`;
    if (clipRef.current) clipRef.current.style.width = v;
    if (lineRef.current) lineRef.current.style.left = v;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      updateSlider(Math.max(2, Math.min(98, x)));
    },
    [updateSlider],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      updateSlider(Math.max(2, Math.min(98, x)));
    },
    [updateSlider],
  );

  const sizeDiff = result.input_size > 0 ? (1 - result.output_size / result.input_size) * 100 : 0;

  // Stable URLs — computed once per result, never during drag
  const beforeSrc = useMemo(() => safeAssetUrl(result.input_path), [result.input_path]);
  const bust = useMemo(() => Date.now(), [result.output_path]);
  const afterSrc = useMemo(() => safeAssetUrl(result.output_path, bust), [result.output_path, bust]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[85vh] overflow-hidden"
        style={{
          borderRadius: 12,
          border: "1px solid var(--bg-border)",
          background: "var(--bg-elevated)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--bg-border)" }}
        >
          <div
            className="flex items-center gap-3"
            style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}
          >
            <span className="font-medium">{t("preview.before_after")}</span>
            <span style={{ color: "var(--text-tertiary)" }}>{formatSize(result.input_size)}</span>
            <ArrowRight className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} strokeWidth={1.5} />
            <span style={{ color: "var(--text-tertiary)" }}>{formatSize(result.output_size)}</span>
            {sizeDiff !== 0 && (
              <span className="font-medium" style={{ color: sizeDiff > 0 ? "var(--success)" : "var(--warning)" }}>
                {sizeDiff > 0 ? "-" : "+"}
                {Math.abs(sizeDiff).toFixed(1)}%
              </span>
            )}
          </div>
          <button onClick={onClose} className="btn-icon">
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Slider area */}
        <div
          ref={containerRef}
          className="relative select-none touch-none"
          style={{ background: "var(--bg-base)", cursor: "ew-resize" }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerMove={handlePointerMove}
        >
          {/* After image (full width) */}
          <img
            src={afterSrc}
            alt="After"
            className="block max-w-[85vw] max-h-[70vh] object-contain pointer-events-none"
            draggable={false}
          />

          {/* Before image (clipped) — width driven by ref, no React re-render */}
          <div ref={clipRef} className="absolute top-0 left-0 bottom-0 overflow-hidden" style={{ width: "50%" }}>
            <img
              src={beforeSrc}
              alt="Before"
              className="block max-w-[85vw] max-h-[70vh] object-contain pointer-events-none"
              draggable={false}
            />
          </div>

          {/* Slider line — left driven by ref, no React re-render */}
          <div
            ref={lineRef}
            className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.5)] pointer-events-none"
            style={{ left: "50%", transform: "translateX(-50%)" }}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 border-2 border-white flex items-center justify-center shadow-lg">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M4 3L1 7L4 11M10 3L13 7L10 11"
                  stroke="#333"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          {/* Labels */}
          <div className="absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/80 pointer-events-none">
            {t("preview.original")}
          </div>
          <div className="absolute top-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/80 pointer-events-none">
            {t("preview.result")}
          </div>

          {/* Dimension labels */}
          {result.input_width > 0 && (
            <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-mono text-white/70 pointer-events-none">
              {result.input_width}×{result.input_height}
            </div>
          )}
          {result.output_width > 0 && (
            <div className="absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-mono text-white/70 pointer-events-none">
              {result.output_width}×{result.output_height}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
