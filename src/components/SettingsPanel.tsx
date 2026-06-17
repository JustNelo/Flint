import { useState, useCallback, useRef, useEffect } from "react";
import { X, FolderOpen, RotateCcw, Globe, RefreshCw, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useT, type Lang } from "../i18n/i18n";
import { useWorkspace } from "../hooks/useWorkspace";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { GlassModal } from "./ui/GlassModal";

interface SettingsPanelProps {
  onClose: () => void;
  onResetOnboarding: () => void;
}

export function SettingsPanel({ onClose, onResetOnboarding }: SettingsPanelProps) {
  const { lang, setLang, t } = useT();
  const { workspace, selectWorkspace, openInExplorer } = useWorkspace();
  const { checkNow, install } = useAutoUpdate();
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "downloading" | "up-to-date" | "error"
  >("idle");
  const [foundVersion, setFoundVersion] = useState("");
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount to prevent setting state on unmounted component
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setUpdateStatus("checking");
    try {
      const { available, version } = await checkNow();
      if (available) {
        setFoundVersion(version);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("up-to-date");
        statusTimerRef.current = setTimeout(() => setUpdateStatus("idle"), 3000);
      }
    } catch {
      setUpdateStatus("error");
    }
  }, [checkNow]);

  const handleInstallUpdate = useCallback(async () => {
    setUpdateStatus("downloading");
    try {
      await install();
    } catch {
      setUpdateStatus("error");
    }
  }, [install]);

  return (
    <GlassModal>
      <button onClick={onClose} className="btn-icon absolute right-5 top-5 z-10">
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>

      <h2
        className="relative font-semibold"
        style={{ fontSize: "var(--text-xl)", color: "var(--text-primary)", letterSpacing: "-0.01em", marginBottom: 28 }}
      >
        {t("settings.title")}
      </h2>

      <div className="relative" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Language */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label
            className="flex items-center gap-2 font-semibold uppercase"
            style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
          >
            <Globe className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("settings.language")}
          </label>
          <div className="flex gap-2">
            {(["en", "fr"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`btn-toggle ${lang === l ? "btn-toggle-active" : ""}`}
              >
                {l === "en" ? "English" : "Français"}
              </button>
            ))}
          </div>
        </div>

        {/* Workspace */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label
            className="flex items-center gap-2 font-semibold uppercase"
            style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("settings.workspace")}
          </label>
          {workspace ? (
            <div
              style={{
                borderRadius: 8,
                border: "1px solid var(--bg-border)",
                background: "var(--bg-elevated)",
                padding: "10px 14px",
              }}
            >
              <p
                className="truncate"
                style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
              >
                {workspace}
              </p>
              <div className="flex gap-2" style={{ marginTop: 10 }}>
                <button onClick={selectWorkspace} className="btn-pill">
                  {t("settings.change")}
                </button>
                <button onClick={openInExplorer} className="btn-pill">
                  {t("settings.open_explorer")}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={selectWorkspace} className="btn-toggle w-full border-dashed">
              {t("onboarding.choose_folder")}
            </button>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--bg-border)" }} />

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={onResetOnboarding} className="btn-ghost" style={{ justifyContent: "flex-start" }}>
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("settings.reset_onboarding")}
          </button>

          <button
            onClick={handleCheckUpdate}
            disabled={updateStatus === "checking" || updateStatus === "downloading"}
            className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ justifyContent: "flex-start" }}
          >
            {updateStatus === "checking" || updateStatus === "downloading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            ) : updateStatus === "up-to-date" ? (
              <CheckCircle className="h-3.5 w-3.5 text-green-400" strokeWidth={1.5} />
            ) : updateStatus === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 text-red-400" strokeWidth={1.5} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            {updateStatus === "checking"
              ? t("status.scanning")
              : updateStatus === "downloading"
                ? t("updater.downloading")
                : updateStatus === "up-to-date"
                  ? t("updater.up_to_date")
                  : updateStatus === "error"
                    ? t("updater.error")
                    : t("updater.check")}
          </button>
        </div>

        {updateStatus === "available" && (
          <div
            className="flex items-center justify-between"
            style={{
              borderRadius: 8,
              border: "1px solid var(--bg-border)",
              background: "var(--bg-elevated)",
              padding: "10px 14px",
            }}
          >
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
              {t("updater.new_version", { version: foundVersion })}
            </span>
            <button onClick={handleInstallUpdate} className="btn-primary-sm">
              {t("updater.download")}
            </button>
          </div>
        )}
      </div>
    </GlassModal>
  );
}
