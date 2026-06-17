import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PenLine, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ActionButton } from "./ui/ActionButton";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useFileSelection } from "../hooks/useFileSelection";
import { useWorkspace } from "../hooks/useWorkspace";
import { useT } from "../i18n/i18n";

interface RenameEntry {
  original_name: string;
  new_name: string;
}

interface RenameResult {
  renamed_count: number;
  results: RenameEntry[];
  errors: string[];
}

const TOKENS = ["{name}", "{index}", "{date}", "{ext}"];

export function BulkRenameTab() {
  const { t } = useT();
  const { files, addFiles, removeFile, clearFiles, reorderFiles } = useFileSelection();
  const { getOutputDir } = useWorkspace();
  const [pattern, setPattern] = useState("{name}_{index}");
  const [startIndex, setStartIndex] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RenameResult | null>(null);
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      addFiles(paths);
      setResult(null);
      setPanelMode("material");
    },
    [addFiles],
  );

  const handleClearFiles = useCallback(() => {
    clearFiles();
    setResult(null);
    setPanelMode("material");
  }, [clearFiles]);

  // Live preview of new names
  const previewNames = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return files.slice(0, 5).map((file, i) => {
      const parts = file.replace(/\\/g, "/").split("/");
      const fullName = parts[parts.length - 1] || file;
      const dotIdx = fullName.lastIndexOf(".");
      const stem = dotIdx > 0 ? fullName.slice(0, dotIdx) : fullName;
      const ext = dotIdx > 0 ? fullName.slice(dotIdx + 1) : "";
      const idx = startIndex + i;

      let newName = pattern
        .replace(/\{name\}/g, stem)
        .replace(/\{index\}/g, String(idx).padStart(3, "0"))
        .replace(/\{date\}/g, today)
        .replace(/\{ext\}/g, ext);

      if (!newName.includes(".") && ext) {
        newName = `${newName}.${ext}`;
      }

      return { original: fullName, preview: newName };
    });
  }, [files, pattern, startIndex]);

  const handleRename = useCallback(async () => {
    if (files.length === 0) {
      toast.error(t("toast.select_images"));
      return;
    }
    const outputDir = await getOutputDir("bulk-rename");
    if (!outputDir) {
      toast.error(t("toast.workspace_missing"));
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await invoke<RenameResult>("bulk_rename_cmd", {
        inputPaths: files,
        pattern: pattern,
        startIndex: startIndex,
        outputDir: outputDir,
      });

      setResult(res);
      if (res.renamed_count > 0) setPanelMode("results");

      if (res.renamed_count > 0 && res.errors.length === 0) {
        toast.success(t("toast.rename_success", { n: res.renamed_count }));
      } else if (res.renamed_count > 0) {
        toast.warning(t("toast.partial", { completed: res.renamed_count, total: files.length }));
      } else {
        toast.error(t("toast.all_failed"));
      }
    } catch (err) {
      toast.error(t("toast.operation_failed"));
    } finally {
      setLoading(false);
    }
  }, [files, pattern, startIndex, getOutputDir, t]);

  const isEmpty = files.length === 0;
  const hasResults = result !== null && result.renamed_count > 0;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={hasResults}
        material={
          <div className="space-y-3">
            <DropZone
              accept="png,jpg,jpeg,bmp,tiff,tif,webp,gif,ico,svg"
              label={isEmpty ? t("dropzone.images_bulk_rename") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_bulk_rename")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />

            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />

            {/* Live preview */}
            {previewNames.length > 0 && (
              <div className="forge-card p-3 space-y-1.5">
                <span className="forge-label" style={{ marginBottom: 0 }}>
                  {t("label.rename_preview")}
                </span>
                {previewNames.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="truncate flex-1" style={{ color: "var(--text-tertiary)" }}>
                      {p.original}
                    </span>
                    <span className="shrink-0" style={{ color: "var(--text-tertiary)" }}>
                      &rarr;
                    </span>
                    <span
                      className="truncate flex-1 text-right"
                      style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
                    >
                      {p.preview}
                    </span>
                  </div>
                ))}
                {files.length > 5 && (
                  <span className="forge-hint">{t("label.more_files", { n: files.length - 5 })}</span>
                )}
              </div>
            )}
          </div>
        }
        results={
          result && (
            <div className="forge-card space-y-2">
              <div className="flex items-center gap-2">
                {result.errors.length === 0 ? (
                  <CheckCircle className="h-4 w-4" style={{ color: "var(--success)" }} strokeWidth={1.5} />
                ) : (
                  <XCircle className="h-4 w-4" style={{ color: "var(--warning)" }} strokeWidth={1.5} />
                )}
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>
                  {t("result.renamed", { n: result.renamed_count })}
                </span>
              </div>
              {result.results.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {result.results.slice(0, 10).map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span className="truncate flex-1" style={{ color: "var(--text-tertiary)" }}>
                        {entry.original_name}
                      </span>
                      <span className="shrink-0" style={{ color: "var(--text-tertiary)" }}>
                        &rarr;
                      </span>
                      <span
                        className="truncate flex-1 text-right"
                        style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
                      >
                        {entry.new_name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {result.errors.map((err, i) => (
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
          )
        }
      />

      <ControlsPanel
        disabled={isEmpty}
        action={
          <ActionButton
            onClick={handleRename}
            disabled={files.length === 0 || !pattern.trim()}
            loading={loading}
            loadingText={t("status.renaming")}
            text={t("action.bulk_rename")}
            icon={<PenLine className="h-4 w-4" strokeWidth={1.5} />}
          />
        }
      >
        {/* Pattern input */}
        <div className="space-y-2">
          <label className="forge-label">{t("label.rename_pattern")}</label>
          <input
            type="text"
            value={pattern}
            onChange={(e) => {
              setPattern(e.target.value);
              setResult(null);
            }}
            placeholder="{name}_{index}"
            className="forge-input w-full"
            style={{ fontFamily: "var(--font-mono)" }}
          />
          <div className="flex gap-1.5 flex-wrap">
            {TOKENS.map((token) => (
              <button key={token} onClick={() => setPattern((prev) => prev + token)} className="forge-chip">
                {token}
              </button>
            ))}
          </div>
          <p className="forge-hint">{t("label.rename_pattern_hint")}</p>
        </div>

        {/* Start index */}
        <div className="flex items-center gap-3">
          <label className="forge-label">{t("label.start_index")}</label>
          <input
            type="number"
            min={0}
            value={startIndex}
            onChange={(e) => setStartIndex(Number(e.target.value))}
            className="forge-input"
            style={{ width: 80, flex: "none", fontFamily: "var(--font-mono)" }}
          />
        </div>
      </ControlsPanel>
    </div>
  );
}
