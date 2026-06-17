import type { ReactNode } from "react";
import { CheckCircle, XCircle } from "lucide-react";

interface ResultCardProps {
  success: boolean;
  title: string;
  chips?: ReactNode;
  errors: string[];
}

export function ResultCard({ success, title, chips, errors }: ResultCardProps) {
  return (
    <div className="forge-card space-y-3">
      <div className="flex items-center gap-2">
        {success ? (
          <CheckCircle className="h-4 w-4" style={{ color: "var(--success)" }} strokeWidth={1.5} />
        ) : (
          <XCircle className="h-4 w-4" style={{ color: "var(--warning)" }} strokeWidth={1.5} />
        )}
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>{title}</span>
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
