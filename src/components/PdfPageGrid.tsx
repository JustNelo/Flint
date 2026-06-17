import { useCallback, useMemo } from "react";
import { useT } from "../i18n/i18n";
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
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import { Loader2 } from "lucide-react";
import { PdfPageCard } from "./PdfPageCard";
import type { BuilderPage } from "../hooks/usePdfWorkbench";

interface PdfPageGridProps {
  pages: BuilderPage[];
  loadingThumbnails: boolean;
  onReorder: (pages: BuilderPage[]) => void;
  onRemove: (id: string) => void;
}

// Reduce measuring frequency — only measure before dragging starts
const MEASURING_CONFIG = {
  droppable: { strategy: MeasuringStrategy.BeforeDragging },
};

// Min card width — CSS auto-fill handles column count responsively
const CARD_MIN_W = 100;

export function PdfPageGrid({ pages, loadingThumbnails, onReorder, onRemove }: PdfPageGridProps) {
  const { t } = useT();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const itemIds = useMemo(() => pages.map((p) => p.id), [pages]);

  const sourcesSummary = useMemo(() => {
    const pdfSources = new Set<string>();
    let imageCount = 0;
    for (const p of pages) {
      if (p.sourceType === "pdf") pdfSources.add(p.sourcePath);
      else imageCount++;
    }
    const pdfs = pdfSources.size;
    if (pdfs > 0 && imageCount > 0) return t("pdf_tool.sources_summary", { pdfs, images: imageCount });
    if (pdfs > 0) return t("label.n_pdfs", { n: pdfs });
    if (imageCount > 0) return t("label.n_images_count", { n: imageCount });
    return "";
  }, [pages, t]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = pages.findIndex((p) => p.id === active.id);
        const newIndex = pages.findIndex((p) => p.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorder(arrayMove(pages, oldIndex, newIndex));
        }
      }
    },
    [pages, onReorder],
  );

  if (pages.length === 0 && !loadingThumbnails) return null;

  return (
    <div className="forge-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-secondary)" }}>
          {pages.length} {t("pdf_tool.pages_count")}
          {sourcesSummary && <span className="text-neutral-500"> — {sourcesSummary}</span>}
          {" — "}
          {t("pdf_tool.drag_hint")}
        </span>
        {loadingThumbnails && (
          <span className="flex items-center gap-1.5 text-[10px] text-neutral-500">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            {t("pdf_tool.loading_pages")}
          </span>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        measuring={MEASURING_CONFIG}
      >
        <SortableContext items={itemIds} strategy={rectSortingStrategy}>
          <div
            className="max-h-[60vh] overflow-y-auto pr-1"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_W}px, 1fr))`,
              gap: "6px",
            }}
          >
            {pages.map((page) => (
              <PdfPageCard key={page.id} page={page} onRemove={onRemove} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
