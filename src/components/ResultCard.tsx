import type { ReactNode } from "react";
import { CheckCircle, XCircle, FolderOpen } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useT } from "../i18n/i18n";

interface ResultCardProps {
  success: boolean;
  title: string;
  chips?: ReactNode;
  errors: string[];
  /** When set, shows an "open output folder" button that reveals this path. */
  revealPath?: string;
}

export function ResultCard({ success, title, chips, errors, revealPath }: ResultCardProps) {
  const { t } = useT();
  return (
    <div className="forge-card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {success ? (
            <CheckCircle className="h-4 w-4 shrink-0" style={{ color: "var(--success)" }} strokeWidth={1.5} />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" style={{ color: "var(--warning)" }} strokeWidth={1.5} />
          )}
          <span
            className="truncate"
            style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}
          >
            {title}
          </span>
        </div>
        {revealPath && (
          <button onClick={() => revealItemInDir(revealPath)} className="btn-ghost shrink-0">
            <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
            {t("label.open_output_folder")}
          </button>
        )}
      </div>

      {chips && <div className="flex flex-wrap gap-1.5">{chips}</div>}

      {errors.length > 0 && (
        <div className="max-h-24 overflow-y-auto space-y-1">
          {errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-2"
              style={{ fontSize: "var(--text-sm)", color: "rgba(239,68,68,0.8)" }}
            >
              <XCircle className="h-3 w-3 shrink-0 mt-0.5" strokeWidth={1.5} />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
