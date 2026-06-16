import type { ReactNode } from "react";
import { useT } from "../i18n/i18n";

interface ControlsPanelProps {
  children: ReactNode;
  action: ReactNode;
  /** Dim + disable the controls (e.g. before any file is selected). */
  disabled?: boolean;
}

export function ControlsPanel({ children, action, disabled = false }: ControlsPanelProps) {
  const { t } = useT();

  return (
    <aside
      className="shrink-0"
      style={{
        width: 300,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        borderRadius: 12,
        border: "1px solid var(--bg-border)",
        background: "var(--bg-elevated)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <span
        className="font-semibold uppercase"
        style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
      >
        {t("etabli.settings")}
      </span>

      <div
        aria-hidden={disabled}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          opacity: disabled ? 0.35 : 1,
          pointerEvents: disabled ? "none" : "auto",
          transition: "opacity 200ms ease",
        }}
      >
        {children}
      </div>

      <div style={{ marginTop: "auto" }}>{action}</div>
    </aside>
  );
}
