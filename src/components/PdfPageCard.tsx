import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, FileText, Image } from "lucide-react";
import { useT } from "../i18n/i18n";
import type { BuilderPage } from "../hooks/usePdfWorkbench";

interface PdfPageCardProps {
  page: BuilderPage;
  onRemove: (id: string) => void;
}

export const PdfPageCard = memo(
  function PdfPageCard({ page, onRemove }: PdfPageCardProps) {
    const { t } = useT();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });

    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
      zIndex: isDragging ? 50 : ("auto" as const),
      borderRadius: 12,
      border: "1px solid var(--bg-border)",
      background: "var(--bg-overlay)",
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="group relative h-40 overflow-hidden cursor-grab active:cursor-grabbing"
      >
        {/* Remove button — stops drag activation */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(page.id)}
          className="absolute top-1 right-1 z-10 rounded-full bg-red-600/80 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-red-500"
        >
          <X className="h-3 w-3 text-white" strokeWidth={1.5} />
        </button>

        {/* Type badge */}
        <div className="absolute top-1 left-1 z-10">
          <span className="inline-flex items-center gap-0.5 rounded-md bg-black/50 px-1 py-0.5 text-[9px] font-medium text-white/80 backdrop-blur-sm">
            {page.sourceType === "pdf" ? (
              <>
                <FileText className="h-2.5 w-2.5" strokeWidth={1.5} />
                PDF
              </>
            ) : (
              <>
                <Image className="h-2.5 w-2.5" strokeWidth={1.5} />
                IMG
              </>
            )}
          </span>
        </div>

        {/* Thumbnail — fixed area, image contained */}
        <div
          className="absolute inset-0 bottom-7 flex items-center justify-center"
          style={{ background: "var(--bg-elevated)" }}
        >
          {page.thumbnailLoaded && page.thumbnailSrc ? (
            <img
              src={page.thumbnailSrc}
              alt={page.fileName}
              loading="lazy"
              className="max-h-full max-w-full object-contain"
              draggable={false}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : !page.thumbnailLoaded ? (
            <div className="flex flex-col items-center justify-center gap-1 animate-pulse">
              <FileText className="h-5 w-5 text-neutral-600" strokeWidth={1.5} />
              {page.pageNumber > 0 && <span className="text-[9px] font-mono text-neutral-600">{page.pageNumber}</span>}
            </div>
          ) : (
            <FileText className="h-6 w-6 text-neutral-500" strokeWidth={1.5} />
          )}
        </div>

        {/* Info bar — pinned to bottom */}
        <div className="absolute bottom-0 inset-x-0 h-7 bg-black/50 px-1.5 py-1 backdrop-blur-sm flex flex-col justify-center">
          <p className="text-[9px] text-white/90 truncate font-medium leading-tight">{page.fileName}</p>
          {page.sourceType === "pdf" && page.pageNumber > 0 && (
            <p className="text-[8px] text-white/50 leading-tight">{t("label.page_n", { n: page.pageNumber })}</p>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.page.id === next.page.id &&
      prev.page.thumbnailSrc === next.page.thumbnailSrc &&
      prev.page.thumbnailLoaded === next.page.thumbnailLoaded &&
      prev.onRemove === next.onRemove
    );
  },
);
