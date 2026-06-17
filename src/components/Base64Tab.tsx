import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { useFileSelection } from "../hooks/useFileSelection";
import { useT } from "../i18n/i18n";
import { logError } from "../lib/utils";

const PANEL: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--bg-border)",
  background: "var(--bg-elevated)",
  padding: 14,
};

export function Base64Tab() {
  const { t } = useT();
  const { files, addFiles, removeFile, clearFiles, reorderFiles } = useFileSelection();
  const [dataUri, setDataUri] = useState("");
  const [converting, setConverting] = useState(false);

  const handleFilesSelected = useCallback((paths: string[]) => addFiles(paths.slice(0, 1)), [addFiles]);
  const handleClearFiles = useCallback(() => {
    clearFiles();
    setDataUri("");
  }, [clearFiles]);

  // Live conversion when the selected file changes.
  useEffect(() => {
    if (files.length === 0) {
      setDataUri("");
      return;
    }
    let cancelled = false;
    setConverting(true);
    invoke<string>("image_to_base64", { imagePath: files[0] })
      .then((res) => {
        if (!cancelled) setDataUri(res);
      })
      .catch((err) => {
        if (!cancelled) {
          logError("base64:convert", err);
          setDataUri("");
          toast.error(t("toast.operation_failed"));
        }
      })
      .finally(() => {
        if (!cancelled) setConverting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [files, t]);

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(t("toast.copied"));
      } catch (err) {
        logError("base64:copy", err);
        toast.error(t("toast.copy_failed"));
      }
    },
    [t],
  );

  const charCount = dataUri.length;
  const sizeKb = (charCount / 1024).toFixed(1);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <section className="flex-1 min-w-0" style={PANEL}>
        <label className="forge-label">{t("label.source")}</label>
        <div className="space-y-3" style={{ marginTop: 8 }}>
          <DropZone
            accept="png,jpg,jpeg,gif,webp,bmp,ico,svg,tiff,tif"
            label={files.length === 0 ? t("dropzone.images_base64") : t("dropzone.add_more")}
            sublabel={t("dropzone.sublabel_base64")}
            compact={files.length > 0}
            multiple={false}
            onFilesSelected={handleFilesSelected}
          />
          <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />
        </div>
      </section>

      <section style={{ width: 360, flexShrink: 0, ...PANEL }}>
        <div className="flex items-center justify-between">
          <label className="forge-label" style={{ marginBottom: 0 }}>
            {t("result.base64_ready")}
          </label>
          {dataUri && (
            <span className="forge-chip">
              {charCount.toLocaleString()} chars · {sizeKb} KB
            </span>
          )}
        </div>

        <div className="forge-card p-3 max-h-40 overflow-y-auto" style={{ marginTop: 8 }}>
          {dataUri ? (
            <code
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--text-secondary)",
                wordBreak: "break-all",
                lineHeight: 1.6,
              }}
            >
              {dataUri.slice(0, 1000)}
              {dataUri.length > 1000 ? "…" : ""}
            </code>
          ) : (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              {converting ? t("status.converting") : t("dropzone.sublabel_base64")}
            </span>
          )}
        </div>

        <div className="flex gap-2" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={() => copy(dataUri)} disabled={!dataUri} className="btn-ghost">
            <Copy className="h-3 w-3" strokeWidth={1.5} />
            {t("action.copy_datauri")}
          </button>
          <button onClick={() => copy(`<img src="${dataUri}" alt="" />`)} disabled={!dataUri} className="btn-ghost">
            {t("action.copy_img")}
          </button>
          <button
            onClick={() => copy(`background-image: url("${dataUri}");`)}
            disabled={!dataUri}
            className="btn-ghost"
          >
            {t("action.copy_css")}
          </button>
        </div>
      </section>
    </div>
  );
}
