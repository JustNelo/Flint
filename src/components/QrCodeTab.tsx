import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QrCode, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ActionButton } from "./ui/ActionButton";
import { useWorkspace } from "../hooks/useWorkspace";
import { useHistory } from "../hooks/useHistory";
import { useT } from "../i18n/i18n";
import { safeAssetUrl } from "../lib/utils";

interface QrResult {
  output_path: string;
  size: number;
  errors: string[];
}

const SIZE_OPTIONS = [256, 512, 1024, 2048];

export function QrCodeTab() {
  const { t } = useT();
  const { getOutputDir } = useWorkspace();
  const { addEntry } = useHistory();
  const [text, setText] = useState("");
  const [size, setSize] = useState(512);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QrResult | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!text.trim()) {
      toast.error(t("toast.qr_text_missing"));
      return;
    }
    const outputDir = await getOutputDir("qrcode");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await invoke<QrResult>("generate_qr_cmd", {
        text: text.trim(),
        size: size,
        outputDir: outputDir,
      });

      setResult(res);

      addEntry({
        tabId: "qrcode",
        filesCount: 1,
        successCount: res.output_path ? 1 : 0,
        failCount: res.errors.length,
        outputDir,
      });

      if (res.output_path && res.errors.length === 0) {
        toast.success(t("toast.qr_success"));
      } else {
        toast.error(t("toast.all_failed"));
      }
    } catch (err) {
      toast.error(t("toast.operation_failed"));
    } finally {
      setLoading(false);
    }
  }, [text, size, getOutputDir, addEntry, t]);

  return (
    <div className="space-y-5">
      {/* Text input */}
      <div className="space-y-1.5">
        <label className="forge-label">{t("label.qr_content")}</label>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder={t("label.qr_placeholder")}
          rows={3}
          className="forge-textarea"
          style={{ resize: "none" }}
        />
        <div className="flex justify-end">
          <span className="forge-hint">{t("label.chars_count", { n: text.length })}</span>
        </div>
      </div>

      {/* Size selector */}
      <div className="space-y-1.5">
        <label className="forge-label">{t("label.qr_size")}</label>
        <div className="flex gap-2">
          {SIZE_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`btn-toggle ${size === s ? "btn-toggle-active" : ""}`}
            >
              {s}px
            </button>
          ))}
        </div>
      </div>

      <ActionButton
        onClick={handleGenerate}
        disabled={!text.trim()}
        loading={loading}
        loadingText={t("status.generating_qr")}
        text={t("action.generate_qr")}
        icon={<QrCode className="h-4 w-4" strokeWidth={1.5} />}
      />

      {/* QR preview */}
      {result && result.output_path && (
        <div className="mt-4 forge-card flex flex-col items-center gap-3">
          <div
            className="overflow-hidden p-2"
            style={{ borderRadius: 8, border: "1px solid var(--bg-border)", background: "#ffffff" }}
          >
            <img src={safeAssetUrl(result.output_path, true)} alt="QR Code" className="w-40 h-40 object-contain" />
          </div>
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            {result.size}×{result.size}px
          </span>
          <button onClick={() => revealItemInDir(result.output_path)} className="btn-ghost">
            <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
            {t("label.open_output_folder")}
          </button>
        </div>
      )}
    </div>
  );
}
