import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Upload, AlertTriangle } from "lucide-react";
import { useT } from "../i18n/i18n";

interface DropZoneProps {
  accept: string;
  multiple?: boolean;
  label: string;
  sublabel?: string;
  /** Slim variant — used once files are selected, so the zone stays available without dominating. */
  compact?: boolean;
  onFilesSelected: (paths: string[]) => void;
}

export function DropZone({
  accept,
  multiple = true,
  label,
  sublabel,
  compact = false,
  onFilesSelected,
}: DropZoneProps) {
  const { t } = useT();
  const [isDragging, setIsDragging] = useState(false);
  const [rejected, setRejected] = useState(0);
  const rejectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const extensions = useMemo(() => accept.split(",").map((ext) => ext.trim().toLowerCase().replace(".", "")), [accept]);

  const flashRejected = useCallback((count: number) => {
    if (count <= 0) return;
    setRejected(count);
    if (rejectedTimer.current) clearTimeout(rejectedTimer.current);
    rejectedTimer.current = setTimeout(() => setRejected(0), 4000);
  }, []);

  useEffect(() => () => void (rejectedTimer.current && clearTimeout(rejectedTimer.current)), []);

  // Split incoming paths into accepted (supported extension) and a rejected count.
  const partitionPaths = useCallback(
    (paths: string[]) => {
      const accepted: string[] = [];
      let rejectedCount = 0;
      for (const p of paths) {
        const ext = p.split(".").pop()?.toLowerCase() || "";
        if (extensions.includes(ext)) accepted.push(p);
        else rejectedCount++;
      }
      return { accepted: multiple ? accepted : accepted.slice(0, 1), rejectedCount };
    },
    [extensions, multiple],
  );

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setIsDragging(true);
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        const { accepted, rejectedCount } = partitionPaths(event.payload.paths);
        flashRejected(rejectedCount);
        if (accepted.length > 0) {
          onFilesSelected(accepted);
        }
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [partitionPaths, flashRejected, onFilesSelected]);

  const handleClick = useCallback(async () => {
    try {
      const selected = await open({
        multiple,
        filters: [{ name: "Files", extensions }],
      });

      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      onFilesSelected(paths);
    } catch (err) {
      console.error("Dialog error:", err);
    }
  }, [extensions, multiple, onFilesSelected]);

  return (
    <div
      onClick={handleClick}
      className={`relative flex items-center justify-center cursor-pointer ${compact ? "gap-2.5" : "flex-col gap-3"}`}
      style={{
        height: compact ? 56 : 180,
        borderRadius: 12,
        border: isDragging ? "1px solid var(--indigo-glow)" : "1px dashed var(--glass-border)",
        background: isDragging ? "var(--glass-bg)" : "var(--bg-elevated)",
        boxShadow: isDragging ? "0 0 0 4px rgba(232,87,42,0.1)" : "none",
        transform: isDragging ? "scale(1.01)" : "scale(1)",
        transition:
          "height 200ms cubic-bezier(0.16,1,0.3,1), border 150ms ease, background 150ms ease, box-shadow 150ms ease, transform 150ms ease",
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          e.currentTarget.style.border = "1px solid var(--indigo-core)";
          e.currentTarget.style.background = "var(--glass-bg)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          e.currentTarget.style.border = "1px dashed var(--glass-border)";
          e.currentTarget.style.background = "var(--bg-elevated)";
        }
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay"
        style={{
          borderRadius: 12,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />
      <Upload
        style={{
          width: compact ? 18 : 28,
          height: compact ? 18 : 28,
          color: isDragging ? "var(--indigo-bright)" : "var(--indigo-muted)",
          transition: "color 150ms ease",
        }}
        strokeWidth={1.5}
      />
      {compact ? (
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-secondary)" }}>{label}</span>
      ) : (
        <div className="text-center">
          <p style={{ fontSize: "var(--text-md)", fontWeight: 500, color: "var(--text-primary)" }}>{label}</p>
          {sublabel && (
            <p style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{sublabel}</p>
          )}
          <p style={{ marginTop: 6 }}>
            <kbd
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                background: "var(--bg-border)",
                color: "var(--text-tertiary)",
                border: "none",
              }}
            >
              Ctrl+O
            </kbd>
          </p>
        </div>
      )}

      {rejected > 0 && (
        <div
          className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1"
          style={{
            borderRadius: 6,
            background: "rgba(245, 158, 11, 0.12)",
            color: "var(--warning)",
            fontSize: 10,
            whiteSpace: "nowrap",
          }}
        >
          <AlertTriangle style={{ width: 11, height: 11 }} strokeWidth={1.8} />
          {t("dropzone.rejected", { n: rejected })}
        </div>
      )}
    </div>
  );
}
