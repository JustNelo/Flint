import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, ZoomIn, Info } from "lucide-react";
import { safeAssetUrl } from "../lib/utils";

interface ImageGridCardProps {
  id: string;
  filePath: string;
  onRemove: (index: number) => void;
  index: number;
  onPreview: (filePath: string) => void;
  onInfo?: (filePath: string) => void;
}

export const ImageGridCard = memo(
  function ImageGridCard({ id, filePath, onRemove, index, onPreview, onInfo }: ImageGridCardProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
      zIndex: isDragging ? 50 : ("auto" as const),
    };

    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const ext = fileName.split(".").pop()?.toUpperCase() || "";

    const mergedStyle = {
      ...style,
      borderRadius: 8,
      border: "1px solid var(--bg-border)",
      background: "var(--bg-overlay)",
      // Skip rendering/decoding cards that are scrolled out of view (kept active
      // while dragging so dnd-kit can move them). `auto` length remembers the
      // real size once painted, so the scrollbar doesn't jump.
      contentVisibility: isDragging ? "visible" : "auto",
      containIntrinsicSize: "auto 140px",
    } as React.CSSProperties;

    return (
      <div
        ref={setNodeRef}
        style={mergedStyle}
        {...attributes}
        {...listeners}
        className="group relative aspect-square overflow-hidden cursor-grab active:cursor-grabbing"
      >
        {/* Remove button */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(index)}
          className="absolute top-1 right-1 z-10 rounded-full p-0.5 opacity-0 group-hover:opacity-100 cursor-pointer"
          style={{ background: "var(--danger)", transition: "opacity 150ms ease" }}
        >
          <X className="h-3 w-3 text-white" strokeWidth={1.5} />
        </button>

        {/* Preview button */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onPreview(filePath)}
          className="absolute top-1 left-1 z-10 rounded-full p-1 opacity-0 group-hover:opacity-100 cursor-pointer"
          style={{ background: "rgba(0,0,0,0.6)", transition: "opacity 150ms ease" }}
        >
          <ZoomIn className="h-3 w-3 text-white" strokeWidth={1.5} />
        </button>

        {/* Info button */}
        {onInfo && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onInfo(filePath)}
            className="absolute top-1 left-7 z-10 rounded-full p-1 opacity-0 group-hover:opacity-100 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.6)", transition: "opacity 150ms ease" }}
          >
            <Info className="h-3 w-3 text-white" strokeWidth={1.5} />
          </button>
        )}

        {/* Thumbnail */}
        <img
          src={safeAssetUrl(filePath)}
          alt={fileName}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />

        {/* Info bar */}
        <div
          className="absolute bottom-0 inset-x-0 px-1.5 py-1"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)" }}
        >
          <p
            style={{ fontSize: 9, color: "rgba(255,255,255,0.9)", fontWeight: 500, lineHeight: 1.2 }}
            className="truncate"
          >
            {fileName}
          </p>
          {ext && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", lineHeight: 1.2 }}>{ext}</span>}
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.id === next.id &&
      prev.filePath === next.filePath &&
      prev.index === next.index &&
      prev.onRemove === next.onRemove &&
      prev.onPreview === next.onPreview &&
      prev.onInfo === next.onInfo
    );
  },
);
