import type { ReactNode } from "react";
import { useT } from "../i18n/i18n";

export type MaterialMode = "material" | "results";

interface MaterialPanelProps {
  mode: MaterialMode;
  onModeChange: (mode: MaterialMode) => void;
  hasResults: boolean;
  material: ReactNode;
  results: ReactNode;
}

function segStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 14px",
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "var(--font-sans)",
    border: "none",
    background: active ? "var(--bg-base)" : "transparent",
    color: active ? "var(--indigo-glow)" : "var(--text-secondary)",
    transition: "background 150ms ease, color 150ms ease",
  };
}

export function MaterialPanel({ mode, onModeChange, hasResults, material, results }: MaterialPanelProps) {
  const { t } = useT();

  return (
    <section
      className="flex-1 min-w-0 overflow-hidden"
      style={{ borderRadius: 12, border: "1px solid var(--bg-border)", background: "var(--bg-elevated)" }}
    >
      <div className="flex items-center p-3" style={{ borderBottom: "1px solid var(--bg-border)" }}>
        <div style={{ display: "inline-flex", background: "var(--bg-overlay)", borderRadius: 8, padding: 2 }}>
          <button
            onClick={() => onModeChange("material")}
            style={{ ...segStyle(mode === "material"), cursor: "pointer" }}
          >
            {t("etabli.material")}
          </button>
          <button
            onClick={() => hasResults && onModeChange("results")}
            disabled={!hasResults}
            style={{
              ...segStyle(mode === "results"),
              cursor: hasResults ? "pointer" : "not-allowed",
              opacity: hasResults ? 1 : 0.4,
            }}
          >
            {t("etabli.results")}
          </button>
        </div>
      </div>
      <div className="p-3">{mode === "material" ? material : results}</div>
    </section>
  );
}
