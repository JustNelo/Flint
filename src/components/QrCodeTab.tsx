import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QrCode, FolderOpen, Copy } from "lucide-react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ActionButton } from "./ui/ActionButton";
import { useWorkspace } from "../hooks/useWorkspace";
import { useHistory } from "../hooks/useHistory";
import { useT } from "../i18n/i18n";
import { logError } from "../lib/utils";

interface QrResult {
  output_path: string;
  size: number;
  errors: string[];
}

const SIZE_OPTIONS = [256, 512, 1024, 2048];

const PANEL: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--bg-border)",
  background: "var(--bg-elevated)",
  padding: 14,
};

export function QrCodeTab() {
  const { t } = useT();
  const { getOutputDir } = useWorkspace();
  const { addEntry } = useHistory();
  const [text, setText] = useState("");
  const [size, setSize] = useState(512);
  const [previewB64, setPreviewB64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<QrResult | null>(null);

  const content = text.trim();

  // Live preview — debounced, no file written (generate_qr_preview returns base64).
  useEffect(() => {
    if (!content) {
      setPreviewB64(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      invoke<string>("generate_qr_preview", { text: content, size })
        .then((b64) => {
          if (!cancelled) setPreviewB64(b64);
        })
        .catch((err) => {
          if (!cancelled) {
            logError("qr:preview", err);
            setPreviewB64(null);
          }
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [content, size]);

  const previewSrc = previewB64 ? `data:image/png;base64,${previewB64}` : null;

  const handleSave = useCallback(async () => {
    if (!content) return;
    const outputDir = await getOutputDir("qrcode");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const res = await invoke<QrResult>("generate_qr_cmd", { text: content, size, outputDir });
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
      logError("qr:save", err);
      toast.error(t("toast.operation_failed"));
    } finally {
      setSaving(false);
    }
  }, [content, size, getOutputDir, addEntry, t]);

  const handleCopy = useCallback(async () => {
    if (!previewB64) return;
    try {
      const res = await fetch(`data:image/png;base64,${previewB64}`);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success(t("toast.qr_copied"));
    } catch (err) {
      logError("qr:copy", err);
      toast.error(t("toast.copy_failed"));
    }
  }, [previewB64, t]);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <section className="flex-1 min-w-0" style={PANEL}>
        <div className="space-y-1.5">
          <label className="forge-label">{t("label.qr_content")}</label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            placeholder={t("label.qr_placeholder")}
            rows={4}
            className="forge-textarea"
            style={{ resize: "none" }}
          />
          <div className="flex justify-end">
            <span className="forge-hint">{t("label.chars_count", { n: text.length })}</span>
          </div>
        </div>

        <div className="space-y-1.5" style={{ marginTop: 16 }}>
          <label className="forge-label">{t("label.qr_size")}</label>
          <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
            {SIZE_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`btn-toggle ${size === s ? "btn-toggle-active" : ""}`}
                style={{ flex: "none" }}
              >
                {s}px
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={{ width: 320, flexShrink: 0, ...PANEL }}>
        <label className="forge-label">{t("label.qr_preview")}</label>
        <div
          className="flex items-center justify-center"
          style={{
            marginTop: 8,
            marginBottom: 12,
            aspectRatio: "1 / 1",
            borderRadius: 8,
            border: "1px solid var(--bg-border)",
            background: previewSrc ? "#ffffff" : "var(--bg-overlay)",
            overflow: "hidden",
          }}
        >
          {previewSrc ? (
            <img src={previewSrc} alt="QR Code" className="w-full h-full object-contain" style={{ padding: 12 }} />
          ) : (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              {t("label.qr_placeholder")}
            </span>
          )}
        </div>

        <ActionButton
          onClick={handleSave}
          disabled={!content}
          loading={saving}
          loadingText={t("status.generating_qr")}
          text={t("action.save_qr")}
          icon={<QrCode className="h-4 w-4" strokeWidth={1.5} />}
        />

        <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
          <button onClick={handleCopy} disabled={!previewB64} className="btn-ghost">
            <Copy className="h-3 w-3" strokeWidth={1.5} />
            {t("action.copy_image")}
          </button>
          {result && result.output_path && (
            <button onClick={() => revealItemInDir(result.output_path)} className="btn-ghost">
              <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
              {t("label.open_output_folder")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
