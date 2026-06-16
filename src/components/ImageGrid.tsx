import { useCallback, useState, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  MeasuringStrategy,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import { useT } from "../i18n/i18n";
import { safeAssetUrl } from "../lib/utils";
import { useThumbnails } from "../hooks/useThumbnails";
import { ImageGridCard } from "./ImageGridCard";
import { MetadataPanel } from "./MetadataPanel";
import type { ImageMetadata } from "../types";

interface ImageGridProps {
  files: string[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}

const MEASURING_CONFIG = {
  droppable: { strategy: MeasuringStrategy.BeforeDragging },
};

const CARD_MIN_W = 100;

export const ImageGrid = memo(function ImageGrid({ files, onReorder, onRemove, onClear }: ImageGridProps) {
  const { t } = useT();
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Resolve bounded-size thumbnails so cards never decode the full-res original.
  const thumbs = useThumbnails(files);

  // File paths are unique within the list (addFiles dedupes by path), so they
  // serve as stable DnD ids / React keys — no array index, so removing or
  // reordering never remounts (and re-decodes) the surviving cards.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = files.indexOf(active.id as string);
        const newIndex = files.indexOf(over.id as string);
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorder(oldIndex, newIndex);
        }
      }
    },
    [files, onReorder],
  );

  const [infoMetadata, setInfoMetadata] = useState<ImageMetadata | null>(null);

  const openPreview = useCallback((filePath: string) => {
    setPreviewSrc(safeAssetUrl(filePath));
    setPreviewName(filePath.split(/[\\/]/).pop() || filePath);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewSrc(null);
    setPreviewName("");
  }, []);

  const openInfo = useCallback(async (filePath: string) => {
    try {
      const meta = await invoke<ImageMetadata>("read_metadata", { filePath });
      setInfoMetadata(meta);
    } catch {
      // silently ignore files that cannot be read
    }
  }, []);

  const closeInfo = useCallback(() => {
    setInfoMetadata(null);
  }, []);

  if (files.length === 0) return null;

  return (
    <>
      <div
        className="overflow-hidden p-3 space-y-3"
        style={{ borderRadius: 12, border: "1px solid var(--bg-border)", background: "var(--bg-elevated)" }}
      >
        <div className="flex items-center justify-between">
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-secondary)" }}>
            {t("label.n_files_selected", { n: files.length })}
            <span style={{ color: "var(--text-tertiary)" }}> — {t("pdf_tool.drag_hint")}</span>
          </span>
          <button
            onClick={onClear}
            data-clear-button
            title={`${t("label.clear_all")} (Ctrl+L)`}
            className="cursor-pointer"
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-tertiary)",
              background: "none",
              border: "none",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            {t("label.clear_all")}
          </button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          measuring={MEASURING_CONFIG}
        >
          <SortableContext items={files} strategy={rectSortingStrategy}>
            <div
              className="max-h-64 overflow-y-auto pr-1"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_W}px, 1fr))`,
                gap: "10px",
              }}
            >
              {files.map((file, index) => (
                <ImageGridCard
                  key={file}
                  id={file}
                  filePath={file}
                  index={index}
                  onRemove={onRemove}
                  onPreview={openPreview}
                  onInfo={openInfo}
                  thumbnailSrc={thumbs.get(file)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Info modal */}
      {infoMetadata && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={closeInfo}
        >
          <div
            className="relative w-full max-w-md overflow-hidden p-4"
            style={{ borderRadius: 12, border: "1px solid var(--bg-border)", background: "var(--bg-elevated)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span
                className="font-semibold uppercase"
                style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
              >
                {t("info.image_details")}
              </span>
              <button onClick={closeInfo} className="btn-icon">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <MetadataPanel metadata={infoMetadata} />
          </div>
        </div>
      )}

      {/* Fullscreen preview modal */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={closePreview}
        >
          <div
            className="relative max-w-[85vw] max-h-[85vh] overflow-hidden"
            style={{ borderRadius: 12, border: "1px solid var(--bg-border)", background: "var(--bg-elevated)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ borderBottom: "1px solid var(--bg-border)" }}
            >
              <span
                className="truncate max-w-md"
                style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-secondary)" }}
              >
                {previewName}
              </span>
              <button onClick={closePreview} className="btn-icon">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex items-center justify-center p-4" style={{ background: "var(--bg-base)" }}>
              <img
                src={previewSrc}
                alt={previewName}
                className="max-w-full max-h-[75vh] object-contain"
                style={{ borderRadius: 4 }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
});
