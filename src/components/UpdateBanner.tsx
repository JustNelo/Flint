import { Download, X, Loader2, AlertCircle } from "lucide-react";
import { useT } from "../i18n/i18n";
import type { UpdateStatus } from "../hooks/useAutoUpdate";

interface UpdateBannerProps {
  status: UpdateStatus;
  version: string;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ status, version, onInstall, onDismiss }: UpdateBannerProps) {
  const { t } = useT();

  if (status !== "available" && status !== "downloading" && status !== "error") {
    return null;
  }

  return (
    <div
      className="relative z-20 flex items-center justify-between gap-3 px-4 py-2"
      style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--bg-border)" }}
    >
      <div className="flex items-center gap-2.5">
        {status === "downloading" ? (
          <Loader2
            className="h-3.5 w-3.5 animate-spin shrink-0"
            style={{ color: "var(--text-tertiary)" }}
            strokeWidth={1.5}
          />
        ) : status === "error" ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--danger)" }} strokeWidth={1.5} />
        ) : (
          <Download className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} strokeWidth={1.5} />
        )}
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
          {status === "downloading"
            ? t("updater.downloading")
            : status === "error"
              ? t("updater.error")
              : t("updater.new_version", { version })}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {status === "available" && (
          <button onClick={onInstall} className="btn-primary-sm">
            {t("updater.download")}
          </button>
        )}
        {status !== "downloading" && (
          <button onClick={onDismiss} className="btn-icon">
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
