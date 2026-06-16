import { useCallback, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Clock, Settings } from "lucide-react";
import { FlintLogo } from "./FlintLogo";

interface TitleBarProps {
  onShowHistory?: () => void;
  onShowSettings?: () => void;
}

export function TitleBar({ onShowHistory, onShowSettings }: TitleBarProps) {
  const appWindow = useMemo(() => getCurrentWindow(), []);

  const handleMinimize = useCallback(async () => {
    await appWindow.minimize();
  }, [appWindow]);

  const handleToggleMaximize = useCallback(async () => {
    await appWindow.toggleMaximize();
  }, [appWindow]);

  const handleClose = useCallback(async () => {
    await appWindow.close();
  }, [appWindow]);

  const handleMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button === 0 && e.detail === 1) {
        await appWindow.startDragging();
      }
    },
    [appWindow],
  );

  const handleDoubleClick = useCallback(async () => {
    await appWindow.toggleMaximize();
  }, [appWindow]);

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className="relative z-20 flex shrink-0 items-center justify-between select-none"
      style={{ height: 36, background: "var(--bg-surface)", borderBottom: "1px solid var(--bg-border)" }}
    >
      <div className="flex items-center gap-2 px-3 pointer-events-none">
        <FlintLogo size={16} />
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            letterSpacing: "-0.01em",
          }}
        >
          Flint
        </span>
      </div>

      <div className="flex h-full items-center">
        {/* History + Settings */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onShowHistory}
          className="flex h-full items-center justify-center"
          style={{
            width: 36,
            color: "var(--text-tertiary)",
            transition: "all 150ms ease",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-overlay)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onShowSettings}
          className="flex h-full items-center justify-center"
          style={{
            width: 36,
            color: "var(--text-tertiary)",
            transition: "all 150ms ease",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-overlay)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        {/* Pipe separator */}
        <div style={{ width: 1, height: 14, background: "var(--bg-border)", margin: "0 2px" }} />

        {/* Window controls */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleMinimize}
          className="flex h-full items-center justify-center"
          style={{
            width: 44,
            color: "var(--text-tertiary)",
            transition: "all 150ms ease",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-overlay)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleToggleMaximize}
          className="flex h-full items-center justify-center"
          style={{
            width: 44,
            color: "var(--text-tertiary)",
            transition: "all 150ms ease",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-overlay)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <Square className="h-3 w-3" strokeWidth={1.5} />
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          className="flex h-full items-center justify-center"
          style={{
            width: 44,
            color: "var(--text-tertiary)",
            transition: "all 150ms ease",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--danger)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
