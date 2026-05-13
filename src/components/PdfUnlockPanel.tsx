import { Lock, Unlock } from "lucide-react";
import { ActionButton } from "./ui/ActionButton";
import type { WorkbenchResult } from "../hooks/usePdfWorkbench";

interface PdfUnlockPanelProps {
  unlockFile: string | null;
  unlockPassword: string;
  loading: boolean;
  result: WorkbenchResult | null;
  onSelectFile: () => void;
  onPasswordChange: (value: string) => void;
  onUnlock: () => void;
  ResultPanel: React.ComponentType<{ result: WorkbenchResult | null }>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export function PdfUnlockPanel({
  unlockFile,
  unlockPassword,
  loading,
  result,
  onSelectFile,
  onPasswordChange,
  onUnlock,
  ResultPanel,
  t,
}: PdfUnlockPanelProps) {
  return (
    <div className="space-y-4">
      <div
        onClick={onSelectFile}
        className="relative flex flex-col items-center justify-center gap-3 p-8 cursor-pointer"
        style={{
          borderRadius: 16,
          border: "2px dashed var(--bg-border)",
          background: "var(--bg-overlay)",
          transition: "all 200ms ease",
        }}
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
        >
          <Lock className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <div className="text-center">
          <p style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text-primary)" }}>
            {t("pdf_tool.drop_locked_pdf")}
          </p>
          <p className="mt-1 text-xs text-neutral-500">{t("pdf_tool.drop_locked_pdf_hint")}</p>
        </div>
      </div>

      {unlockFile && (
        <div className="forge-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} strokeWidth={1.5} />
            <span
              className="truncate"
              style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}
            >
              {unlockFile.split(/[\\/]/).pop()}
            </span>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-widest text-neutral-500">
              {t("label.pdf_password")}
            </label>
            <input
              type="password"
              value={unlockPassword}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="••••••••"
              className="forge-input w-full"
            />
          </div>
          <ActionButton
            onClick={onUnlock}
            disabled={loading || !unlockPassword.trim()}
            loading={loading}
            loadingText={t("status.unlocking_pdf")}
            text={t("action.unlock_pdf")}
            icon={<Unlock className="h-4 w-4" />}
          />
        </div>
      )}

      <ResultPanel result={result} />
    </div>
  );
}
