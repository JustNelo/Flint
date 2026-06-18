import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, ShieldOff, MapPin } from "lucide-react";
import { ActionButton } from "./ui/ActionButton";
import { DropZone } from "./DropZone";
import { ImageGrid } from "./ImageGrid";
import { ResultsBanner } from "./ResultsBanner";
import { MetadataPanel } from "./MetadataPanel";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { useTabProcessor } from "../hooks/useTabProcessor";
import { useT } from "../i18n/i18n";
import type { ImageMetadata } from "../types";

export function ExifStripTab() {
  const { t } = useT();
  const {
    files,
    removeFile,
    reorderFiles,
    handleFilesSelected,
    handleClearFiles: baseClear,
    loading,
    results,
    lastOutputDir,
    process,
  } = useTabProcessor({ tabId: "strip", command: "strip_metadata" });
  const [metadataList, setMetadataList] = useState<ImageMetadata[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");
  // Per-path metadata cache so adding a batch only reads the NEW files instead
  // of re-scanning the whole selection on every change.
  const metaCacheRef = useRef<Map<string, ImageMetadata>>(new Map());
  const metaReqRef = useRef(0);

  // Show results after a run, fall back to material when the list is cleared.
  // Guarded by !loading so an in-flight run (which clears results first) does not
  // flash the material view before the new results arrive.
  useEffect(() => {
    if (!loading) setPanelMode(results.length > 0 ? "results" : "material");
  }, [results, loading]);

  const handleClearFiles = useCallback(() => {
    baseClear();
    metaCacheRef.current = new Map();
    setMetadataList([]);
  }, [baseClear]);

  useEffect(() => {
    const token = ++metaReqRef.current;

    if (files.length === 0) {
      metaCacheRef.current = new Map();
      setMetadataList([]);
      setLoadingMeta(false);
      return;
    }

    // Drop cached entries no longer selected so the cache can't grow unbounded.
    const pruned = new Map<string, ImageMetadata>();
    for (const f of files) {
      const cached = metaCacheRef.current.get(f);
      if (cached) pruned.set(f, cached);
    }
    metaCacheRef.current = pruned;

    // Build the visible list in file order from whatever is already cached.
    const orderedFromCache = () =>
      files.map((f) => metaCacheRef.current.get(f)).filter((m): m is ImageMetadata => m !== undefined);

    const missing = files.filter((f) => !metaCacheRef.current.has(f));
    setMetadataList(orderedFromCache());

    if (missing.length === 0) {
      setLoadingMeta(false);
      return;
    }

    // Read only the newly-added files, in parallel (read_metadata is a
    // spawn_blocking command, so concurrent calls are safe).
    setLoadingMeta(true);
    Promise.all(
      missing.map((file) =>
        invoke<ImageMetadata>("read_metadata", { filePath: file })
          .then((meta) => ({ file, meta }))
          .catch(() => ({ file, meta: null as ImageMetadata | null })),
      ),
    ).then((entries) => {
      if (token !== metaReqRef.current) return; // superseded by a newer change
      for (const { file, meta } of entries) {
        if (meta) metaCacheRef.current.set(file, meta);
      }
      setMetadataList(orderedFromCache());
      setLoadingMeta(false);
    });
  }, [files]);

  const totalExifFields = metadataList.reduce((acc, m) => acc + m.exif.length, 0);
  const hasGps = metadataList.some((m) => m.exif.some((e) => e.tag.startsWith("GPS")));

  const handleStrip = useCallback(async () => {
    await process({
      successMessage: t("toast.strip_success", { n: files.length }),
    });
  }, [process, files.length, t]);

  const isEmpty = files.length === 0;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={results.length > 0}
        material={
          <div className="space-y-3">
            <DropZone
              accept="png,jpg,jpeg,bmp,tiff,tif,webp"
              label={isEmpty ? t("dropzone.images_strip") : t("dropzone.add_more")}
              sublabel={t("dropzone.sublabel_strip")}
              compact={!isEmpty}
              onFilesSelected={handleFilesSelected}
            />

            <ImageGrid files={files} onReorder={reorderFiles} onRemove={removeFile} onClear={handleClearFiles} />

            {files.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                    {t("label.metadata_inspector")}
                  </span>
                  {loadingMeta ? (
                    <span className="flex items-center gap-1.5 text-[10px] text-neutral-500">
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                      {t("status.scanning")}
                    </span>
                  ) : (
                    <div className="flex items-center gap-3">
                      {totalExifFields > 0 && (
                        <span className="text-[10px] font-medium text-neutral-300">
                          {t("result.fields_found", { n: totalExifFields })}
                        </span>
                      )}
                      {hasGps && (
                        <span className="flex items-center gap-1 text-[10px] text-neutral-300 font-medium">
                          <MapPin className="h-3 w-3" strokeWidth={1.5} />
                          {t("result.gps_detected")}
                        </span>
                      )}
                      {totalExifFields === 0 && (
                        <span className="text-[10px] text-neutral-500 font-medium">{t("result.clean")}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {metadataList.map((meta) => (
                    <MetadataPanel key={meta.path} metadata={meta} />
                  ))}
                </div>
              </div>
            )}
          </div>
        }
        results={<ResultsBanner results={results} total={files.length} outputDir={lastOutputDir} sourceTab="strip" />}
      />

      <ControlsPanel
        disabled={isEmpty}
        action={
          <ActionButton
            onClick={handleStrip}
            disabled={isEmpty}
            loading={loading}
            loadingText={t("status.stripping")}
            text={files.length > 0 ? t("action.strip_n", { n: files.length }) : t("action.strip")}
            icon={<ShieldOff className="h-4 w-4" />}
          />
        }
      >
        <></>
      </ControlsPanel>
    </div>
  );
}
