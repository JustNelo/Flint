import { useState, useCallback, useEffect, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FileUp,
  Scissors,
  Image,
  FileDown,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Upload,
  CheckCircle,
  XCircle,
  Zap,
  Shield,
  AlertTriangle,
  FolderOpen,
  Stamp,
  Type,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { cn, formatSize, safeAssetUrl } from "../lib/utils";
import { PdfPageGrid } from "./PdfPageGrid";
import { MaterialPanel, type MaterialMode } from "./MaterialPanel";
import { ControlsPanel } from "./ControlsPanel";
import { ActionButton } from "./ui/ActionButton";
import { Slider } from "./ui/Slider";
import { useWorkspace } from "../hooks/useWorkspace";
import { useT } from "../i18n/i18n";
import {
  usePdfWorkbench,
  type PrimaryAction,
  type ExportFormat,
  type ExportDpi,
  type PostProcessing,
  type PipelineStep,
  type WorkbenchResult,
} from "../hooks/usePdfWorkbench";
import type { PdfWatermarkPosition } from "../types";

const ACCEPTED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "bmp", "ico", "tiff", "tif", "webp", "pdf"]);

// --- Password strength helper ---
function getPasswordStrength(pw: string): { level: number; label: string; color: string } {
  if (!pw) return { level: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 1, label: "label.password_weak", color: "bg-red-500" };
  if (score <= 3) return { level: 2, label: "label.password_medium", color: "bg-yellow-500" };
  return { level: 3, label: "label.password_strong", color: "bg-green-500" };
}

// --- Primary action definitions ---
interface ActionDef {
  id: PrimaryAction;
  labelKey: string;
  icon: typeof FileUp;
}

const PRIMARY_ACTIONS: ActionDef[] = [
  { id: "build", labelKey: "pdf_tool.build", icon: FileUp },
  { id: "split", labelKey: "pdf_tool.split", icon: Scissors },
  { id: "export-images", labelKey: "pdf_tool.export_images", icon: Image },
  { id: "extract-images", labelKey: "pdf_tool.extract_images", icon: FileDown },
  { id: "watermark", labelKey: "pdf_tool.watermark", icon: Stamp },
];

// Actions that output PDF (support post-processing)
const PDF_OUTPUT_ACTIONS = new Set<PrimaryAction>(["build"]);

// --- Pipeline step labels ---
const PIPELINE_STEP_LABELS: Record<PipelineStep, string> = {
  materialize: "status.materializing",
  build: "status.building",
  split: "status.splitting",
  "export-images": "status.exporting_pages",
  "extract-images": "status.extracting",
  watermark: "status.watermarking_pdf",
  compress: "status.compressing_pdf",
  protect: "status.protecting_pdf",
};

type PdfWmMode = "text" | "image";

const PDF_WM_POSITIONS = [
  { value: "center", labelKey: "label.center" },
  { value: "diagonal", labelKey: "label.diagonal" },
  { value: "bottom-right", labelKey: "label.bottom_right" },
  { value: "bottom-left", labelKey: "label.bottom_left" },
  { value: "top-right", labelKey: "label.top_right" },
  { value: "top-left", labelKey: "label.top_left" },
  { value: "tiled", labelKey: "label.tiled" },
] as const;

// --- Main Component ---

export function PdfWorkbenchTab() {
  const { t } = useT();
  const { getOutputDir } = useWorkspace();
  const {
    pages,
    loading,
    loadingThumbnails,
    result,
    gridModified,
    pipelineStep,
    addFiles,
    removePage,
    reorderPages,
    clearAll,
    executePipeline,
    watermarkPdf,
    unlockPdf,
  } = usePdfWorkbench();

  // Mode: "workbench" (grid + actions) or "unlock" (standalone)
  const [mode, setMode] = useState<"workbench" | "unlock">("workbench");
  const [panelMode, setPanelMode] = useState<MaterialMode>("material");

  useEffect(() => {
    if (!loading) setPanelMode(result ? "results" : "material");
  }, [result, loading]);

  // Primary action
  const [activeTool, setActiveTool] = useState<PrimaryAction>("build");

  // Build options
  const [outputName, setOutputName] = useState("document.pdf");

  // Split options
  const [ranges, setRanges] = useState("1-end");

  // Export images options
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exportDpi, setExportDpi] = useState<ExportDpi>(150);

  // Post-processing toggles
  const [ppCompress, setPpCompress] = useState(false);
  const [ppCompressQuality, setPpCompressQuality] = useState(60);
  const [ppProtect, setPpProtect] = useState(false);
  const [ppPassword, setPpPassword] = useState("");
  const ppPasswordStrength = useMemo(() => getPasswordStrength(ppPassword), [ppPassword]);

  // Watermark options
  const [wm, setWm] = useState({
    mode: "text" as PdfWmMode,
    text: "",
    position: "center" as PdfWatermarkPosition,
    opacity: 30,
    fontSize: 48,
    color: "#B3B3B3",
    logoPath: null as string | null,
    scale: 25,
  });
  const updateWm = useCallback(
    <K extends keyof typeof wm>(key: K, value: (typeof wm)[K]) => setWm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  // Unlock mode state
  const [unlockFile, setUnlockFile] = useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");

  // Show post-processing options only for PDF-output actions
  const showPostProcessing = PDF_OUTPUT_ACTIONS.has(activeTool);

  // Window-level drag-drop listener
  const filterPaths = useMemo(() => {
    return (paths: string[]) =>
      paths.filter((p) => {
        const ext = p.split(".").pop()?.toLowerCase() || "";
        return ACCEPTED_EXTENSIONS.has(ext);
      });
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const filtered = filterPaths(event.payload.paths);
        if (filtered.length > 0) {
          if (mode === "unlock") {
            const pdfs = filtered.filter((p) => p.toLowerCase().endsWith(".pdf"));
            if (pdfs.length > 0) setUnlockFile(pdfs[0]);
          } else {
            addFiles(filtered);
          }
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [filterPaths, addFiles, mode]);

  const handleAddMore = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Images & PDFs",
            extensions: ["png", "jpg", "jpeg", "bmp", "ico", "tiff", "tif", "webp", "pdf"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length > 0) addFiles(paths);
    } catch (err) {
      toast.error(t("toast.file_open_failed"));
    }
  }, [addFiles, t]);

  const handleSelectUnlockFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") setUnlockFile(selected);
    } catch (err) {
      toast.error(t("toast.file_open_failed"));
    }
  }, [t]);

  const handleSelectWmLogo = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "svg"] }],
      });
      if (typeof selected === "string") updateWm("logoPath", selected);
    } catch (err) {
      toast.error(t("toast.file_open_failed"));
    }
  }, [t]);

  // --- Pipeline execute ---
  const handleExecute = useCallback(async () => {
    const outputDir = await getOutputDir("pdf-toolkit");
    if (!outputDir) {
      toast.error(t("toast.no_workspace"));
      return;
    }

    // Watermark action uses its own path
    if (activeTool === "watermark") {
      await watermarkPdf(outputDir, wm.mode, {
        text: wm.text.trim(),
        imagePath: wm.logoPath || undefined,
        position: wm.position,
        opacity: wm.opacity / 100,
        fontSize: wm.fontSize,
        color: wm.color,
        scale: wm.scale / 100,
      });
      return;
    }

    const postProcessing: PostProcessing = {
      compress: showPostProcessing && ppCompress,
      compressQuality: ppCompressQuality,
      protect: showPostProcessing && ppProtect,
      protectPassword: ppPassword,
    };

    await executePipeline(
      activeTool,
      outputDir,
      {
        outputName,
        ranges,
        exportFormat,
        exportDpi,
      },
      postProcessing,
    );
  }, [
    activeTool,
    outputName,
    ranges,
    exportFormat,
    exportDpi,
    ppCompress,
    ppCompressQuality,
    ppProtect,
    ppPassword,
    showPostProcessing,
    getOutputDir,
    executePipeline,
    watermarkPdf,
    wm,
  ]);

  // --- Unlock execute ---
  const handleUnlock = useCallback(async () => {
    if (!unlockFile || !unlockPassword.trim()) return;
    const outputDir = await getOutputDir("pdf-toolkit");
    if (!outputDir) return;
    await unlockPdf(unlockFile, unlockPassword, outputDir);
  }, [unlockFile, unlockPassword, getOutputDir, unlockPdf]);

  // --- Disable logic ---
  const isExecuteDisabled = useMemo(() => {
    if (loading) return true;
    if (pages.length === 0) return true;
    if (activeTool === "watermark") {
      if (wm.mode === "text" && !wm.text.trim()) return true;
      if (wm.mode === "image" && !wm.logoPath) return true;
      return false;
    }
    if (ppProtect && showPostProcessing && !ppPassword.trim()) return true;
    return false;
  }, [loading, pages.length, ppProtect, ppPassword, showPostProcessing, activeTool, wm.mode, wm.text, wm.logoPath]);

  // --- Action button text ---
  const actionButtonText = useMemo(() => {
    if (pipelineStep) {
      return {
        text: t(PIPELINE_STEP_LABELS[pipelineStep]),
        loadingText: t(PIPELINE_STEP_LABELS[pipelineStep]),
      };
    }
    const map: Record<PrimaryAction, { text: string; loadingText: string }> = {
      build: { text: t("action.build_pdf"), loadingText: t("status.building") },
      split: { text: t("action.pdf_split"), loadingText: t("status.splitting") },
      "export-images": { text: t("action.pdf_to_images"), loadingText: t("status.exporting_pages") },
      "extract-images": { text: t("action.extract"), loadingText: t("status.extracting") },
      watermark: { text: t("action.pdf_watermark"), loadingText: t("status.watermarking_pdf") },
    };
    return map[activeTool];
  }, [activeTool, pipelineStep, t]);

  // --- Action icon ---
  const actionIcon = useMemo(() => {
    const map: Record<PrimaryAction, React.ReactNode> = {
      build: <FileUp className="h-4 w-4" strokeWidth={1.5} />,
      split: <Scissors className="h-4 w-4" strokeWidth={1.5} />,
      "export-images": <Image className="h-4 w-4" strokeWidth={1.5} />,
      "extract-images": <FileDown className="h-4 w-4" strokeWidth={1.5} />,
      watermark: <Stamp className="h-4 w-4" strokeWidth={1.5} />,
    };
    return map[activeTool];
  }, [activeTool]);

  // --- Build pipeline step summary ---
  const pipelineSummary = useMemo(() => {
    const actionDef = PRIMARY_ACTIONS.find((a) => a.id === activeTool);
    const steps: string[] = [actionDef ? t(actionDef.labelKey) : activeTool];
    if (showPostProcessing && ppCompress) steps.push(t("pdf_tool.compress"));
    if (showPostProcessing && ppProtect) steps.push(t("pdf_tool.protect"));
    return steps;
  }, [activeTool, ppCompress, ppProtect, showPostProcessing, t]);

  const pageMaterial = (
    <div className="space-y-3">
      {/* Drop zone / Add files bar */}
      {pages.length === 0 ? (
        <div
          onClick={handleAddMore}
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
            <Upload className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <p style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text-primary)" }}>
              {t("dropzone.pdf_workbench")}
            </p>
            <p className="mt-1 text-xs text-neutral-500">{t("dropzone.sublabel_pdf_workbench")}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={handleAddMore} className="btn-ghost">
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            {t("label.add_files")}
          </button>
          {/* Grid modified indicator */}
          {gridModified && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
              {t("pdf_tool.grid_modified")}
            </span>
          )}
          <span className="text-[10px] text-neutral-500 ml-auto">
            {pages.length} {t("pdf_tool.pages_count")}
          </span>
          <button onClick={clearAll} className="btn-ghost">
            <Trash2 className="h-3 w-3" strokeWidth={1.5} />
            {t("label.clear_all")}
          </button>
        </div>
      )}

      {/* Page grid */}
      <PdfPageGrid
        pages={pages}
        loadingThumbnails={loadingThumbnails}
        onReorder={reorderPages}
        onRemove={removePage}
      />
    </div>
  );

  const unlockMaterial = (
    <div className="space-y-3">
      <div
        onClick={handleSelectUnlockFile}
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
        <div className="forge-card p-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} strokeWidth={1.5} />
            <span
              className="truncate"
              style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}
            >
              {unlockFile.split(/[\\/]/).pop()}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <MaterialPanel
        mode={panelMode}
        onModeChange={setPanelMode}
        hasResults={result !== null}
        materialLabel={mode === "workbench" ? t("etabli.pages") : t("pdf_tool.unlock_mode")}
        material={mode === "workbench" ? pageMaterial : unlockMaterial}
        results={<ResultPanel result={result} t={t} />}
      />

      <ControlsPanel
        disabled={mode === "workbench" ? pages.length === 0 : !unlockFile}
        action={
          mode === "workbench" ? (
            <ActionButton
              onClick={handleExecute}
              disabled={isExecuteDisabled}
              loading={loading}
              loadingText={actionButtonText.loadingText}
              text={actionButtonText.text}
              icon={actionIcon}
            />
          ) : (
            <ActionButton
              onClick={handleUnlock}
              disabled={loading || !unlockFile || !unlockPassword.trim()}
              loading={loading}
              loadingText={t("status.unlocking_pdf")}
              text={t("action.unlock_pdf")}
              icon={<Unlock className="h-4 w-4" strokeWidth={1.5} />}
            />
          )
        }
      >
        <div className="flex gap-2">
          <button
            onClick={() => setMode("workbench")}
            className={cn("btn-toggle", mode === "workbench" && "btn-toggle-active")}
          >
            {t("pdf_tool.workbench_mode")}
          </button>
          <button
            onClick={() => setMode("unlock")}
            className={cn("btn-toggle", mode === "unlock" && "btn-toggle-active")}
          >
            <Unlock className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("pdf_tool.unlock_mode")}
          </button>
        </div>

        {mode === "workbench" ? (
          <>
            {/* Primary action selector */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                {t("pdf_tool.primary_action")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PRIMARY_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  const isActive = activeTool === action.id;
                  return (
                    <button
                      key={action.id}
                      onClick={() => setActiveTool(action.id)}
                      className={cn("btn-toggle flex-col gap-1.5! py-3! text-[11px]!", isActive && "btn-toggle-active")}
                    >
                      <Icon className={cn("h-4 w-4")} strokeWidth={1.5} />
                      {t(action.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeTool === "build" && (
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                  {t("label.filename")}
                </label>
                <input
                  type="text"
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  placeholder={t("label.placeholder_filename")}
                  className="forge-input w-full"
                />
              </div>
            )}

            {activeTool === "split" && (
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                  {t("label.page_ranges")}
                </label>
                <input
                  type="text"
                  value={ranges}
                  onChange={(e) => setRanges(e.target.value)}
                  placeholder="1-3, 4-10, 11-end"
                  className="forge-input w-full"
                />
                <p className="text-[10px] text-neutral-500">{t("label.page_ranges_hint")}</p>
              </div>
            )}

            {activeTool === "export-images" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium uppercase tracking-widest text-neutral-500 mb-2 block">
                    {t("label.output_format_images")}
                  </label>
                  <div className="flex gap-2">
                    {(["png", "jpg"] as ExportFormat[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setExportFormat(f)}
                        className={cn("btn-toggle uppercase", exportFormat === f && "btn-toggle-active")}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-widest text-neutral-500 mb-2 block">
                    {t("label.dpi")}
                  </label>
                  <div className="flex gap-2">
                    {([72, 150, 300] as ExportDpi[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => setExportDpi(d)}
                        className={cn("btn-toggle", exportDpi === d && "btn-toggle-active")}
                      >
                        {t("label.dpi_value", { n: d })}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTool === "extract-images" && (
              <p className="text-xs text-neutral-500">{t("pdf_tool.extract_images_hint")}</p>
            )}

            {activeTool === "watermark" && (
              <div className="space-y-3">
                {/* Text / Image toggle */}
                <div className="flex gap-2">
                  {(["text", "image"] as PdfWmMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => updateWm("mode", m)}
                      className={cn("btn-toggle", wm.mode === m && "btn-toggle-active")}
                    >
                      {m === "text" ? (
                        <Type className="h-3.5 w-3.5" strokeWidth={1.5} />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                      )}
                      {m === "text" ? t("label.watermark_text_mode") : t("label.watermark_image_mode")}
                    </button>
                  ))}
                </div>

                {/* Text-specific */}
                {wm.mode === "text" && (
                  <>
                    <div>
                      <label className="text-xs font-medium uppercase tracking-widest text-neutral-500 mb-1 block">
                        {t("label.watermark_text")}
                      </label>
                      <input
                        type="text"
                        value={wm.text}
                        onChange={(e) => updateWm("text", e.target.value)}
                        placeholder={t("label.placeholder_watermark")}
                        className="forge-input w-full"
                      />
                    </div>
                    <Slider
                      label={t("label.font_size")}
                      value={wm.fontSize}
                      min={8}
                      max={200}
                      unit="px"
                      onChange={(v) => updateWm("fontSize", v)}
                    />
                    <div>
                      <label className="text-xs font-medium uppercase tracking-widest text-neutral-500 mb-1 block">
                        {t("label.watermark_color")}
                      </label>
                      <div className="flex items-center gap-2">
                        <label className="relative cursor-pointer">
                          <input
                            type="color"
                            value={wm.color}
                            onChange={(e) => updateWm("color", e.target.value)}
                            className="absolute inset-0 opacity-0 w-0 h-0 cursor-pointer"
                          />
                          <div
                            className="h-8 w-8 cursor-pointer"
                            style={{
                              borderRadius: 6,
                              border: "1px solid var(--bg-border)",
                              transition: "border-color 150ms ease",
                              backgroundColor: wm.color,
                            }}
                          />
                        </label>
                        <input
                          type="text"
                          value={wm.color}
                          onChange={(e) => updateWm("color", e.target.value)}
                          maxLength={7}
                          className="forge-input"
                          style={{ width: 96, flex: "none", fontFamily: "var(--font-mono)" }}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Image-specific */}
                {wm.mode === "image" && (
                  <>
                    <div>
                      <label className="text-xs font-medium uppercase tracking-widest text-neutral-500 mb-1 block">
                        {t("label.watermark_logo")}
                      </label>
                      <button
                        onClick={handleSelectWmLogo}
                        className="flex items-center gap-2 w-full px-3 py-3 cursor-pointer"
                        style={{
                          borderRadius: 8,
                          border: "1px dashed var(--bg-border)",
                          background: "var(--bg-overlay)",
                          fontSize: "var(--text-sm)",
                          color: "var(--text-secondary)",
                          transition: "all 150ms ease",
                        }}
                      >
                        <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
                        {wm.logoPath ? wm.logoPath.split(/[\\/]/).pop() : t("label.select_logo")}
                      </button>
                      {wm.logoPath && (
                        <div
                          className="mt-2 flex items-center gap-2 p-2"
                          style={{
                            borderRadius: 8,
                            border: "1px solid var(--bg-border)",
                            background: "var(--bg-overlay)",
                          }}
                        >
                          <img
                            src={safeAssetUrl(wm.logoPath)}
                            alt="Logo"
                            className="h-8 w-8 rounded object-contain"
                            style={{ background: "var(--bg-elevated)" }}
                          />
                          <span className="text-[10px] text-neutral-500 truncate flex-1">
                            {wm.logoPath.split(/[\\/]/).pop()}
                          </span>
                        </div>
                      )}
                    </div>
                    <Slider
                      label={t("label.watermark_scale")}
                      value={wm.scale}
                      min={5}
                      max={80}
                      unit="%"
                      onChange={(v) => updateWm("scale", v)}
                    />
                  </>
                )}

                {/* Position */}
                <div>
                  <label className="text-xs font-medium uppercase tracking-widest text-neutral-500 mb-1.5 block">
                    {t("label.position")}
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {PDF_WM_POSITIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => updateWm("position", opt.value)}
                        className={cn("btn-toggle", wm.position === opt.value && "btn-toggle-active")}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Opacity */}
                <Slider
                  label={t("label.opacity")}
                  value={wm.opacity}
                  min={5}
                  max={100}
                  onChange={(v) => updateWm("opacity", v)}
                />
              </div>
            )}

            {/* Post-processing toggles (only for PDF output actions) */}
            {showPostProcessing && (
              <div className="pt-3 space-y-3" style={{ borderTop: "1px solid var(--bg-border)" }}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                  {t("pdf_tool.post_processing")}
                </p>

                {/* Compress toggle */}
                <div>
                  <button
                    onClick={() => setPpCompress(!ppCompress)}
                    className={cn("btn-toggle w-full", ppCompress && "btn-toggle-active")}
                  >
                    <Zap className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {t("pdf_tool.compress")}
                    <div
                      className={cn("ml-auto h-4 w-7 rounded-full transition-all", ppCompress ? "bg-indigo-400" : "")}
                    >
                      <div
                        className={cn(
                          "h-3 w-3 rounded-full mt-0.5 transition-all",
                          ppCompress ? "ml-3.5 bg-white" : "ml-0.5",
                        )}
                      />
                    </div>
                  </button>
                  {ppCompress && (
                    <div className="mt-2 pl-2">
                      <Slider
                        label={t("label.image_quality_pdf")}
                        value={ppCompressQuality}
                        min={10}
                        max={95}
                        leftHint={t("label.smaller_file")}
                        rightHint={t("label.higher_quality")}
                        onChange={setPpCompressQuality}
                      />
                    </div>
                  )}
                </div>

                {/* Protect toggle */}
                <div>
                  <button
                    onClick={() => setPpProtect(!ppProtect)}
                    className={cn("btn-toggle w-full", ppProtect && "btn-toggle-active")}
                  >
                    <Shield className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {t("pdf_tool.protect")}
                    <div
                      className={cn("ml-auto h-4 w-7 rounded-full transition-all", ppProtect ? "bg-indigo-400" : "")}
                    >
                      <div
                        className={cn(
                          "h-3 w-3 rounded-full mt-0.5 transition-all",
                          ppProtect ? "ml-3.5 bg-white" : "ml-0.5",
                        )}
                      />
                    </div>
                  </button>
                  {ppProtect && (
                    <div className="mt-2 pl-2 space-y-1.5">
                      <div className="flex gap-1.5 items-center text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                        <Shield className="h-3 w-3 shrink-0" strokeWidth={1.8} />
                        <span>{t("notice.protect_aes128")}</span>
                      </div>
                      <input
                        type="password"
                        value={ppPassword}
                        onChange={(e) => setPpPassword(e.target.value)}
                        placeholder="••••••••"
                        className="forge-input w-full"
                      />
                      {ppPassword && (
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1 flex-1">
                            {[1, 2, 3].map((i) => (
                              <div
                                key={i}
                                className={cn(
                                  "h-1 flex-1 rounded-full transition-all",
                                  i <= ppPasswordStrength.level ? ppPasswordStrength.color : "",
                                )}
                              />
                            ))}
                          </div>
                          <span
                            className={cn(
                              "text-[10px] font-medium",
                              ppPasswordStrength.level <= 1
                                ? "text-red-400"
                                : ppPasswordStrength.level <= 2
                                  ? "text-yellow-400"
                                  : "text-green-400",
                            )}
                          >
                            {t(ppPasswordStrength.label)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pipeline summary */}
            {pipelineSummary.length > 1 && (
              <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
                <span>{t("pdf_tool.pipeline")}:</span>
                {pipelineSummary.map((step, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-neutral-600">→</span>}
                    <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{step}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="forge-label">{t("label.pdf_password")}</label>
              <input
                type="password"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="••••••••"
                className="forge-input w-full"
              />
            </div>
          </>
        )}
      </ControlsPanel>
    </div>
  );
}

// --- Result display component ---

interface ResultPanelProps {
  result: WorkbenchResult | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function ResultPanel({ result, t }: ResultPanelProps) {
  if (!result) return null;

  let successIcon = true;
  let mainText = "";
  let errors: string[] = [];
  let extraContent: React.ReactNode = null;

  switch (result.type) {
    case "build":
      successIcon = result.data.errors.length === 0;
      mainText = t("toast.build_success", { n: result.data.page_count });
      errors = result.data.errors;
      break;

    case "split":
      successIcon = result.data.errors.length === 0;
      mainText = t("result.split_files", { n: result.data.output_files.length });
      errors = result.data.errors;
      break;

    case "export-images":
      successIcon = result.data.errors.length === 0;
      mainText = t("result.exported_pages", { n: result.data.exported });
      errors = result.data.errors;
      break;

    case "extract-images":
      successIcon = result.data.errors.length === 0;
      mainText = t("result.extracted", { n: result.data.total_extracted });
      errors = result.data.errors;
      break;

    case "compress": {
      const d = result.data;
      successIcon = d.errors.length === 0 && !!d.output_path;
      mainText = t("result.pdf_compressed", {
        original: formatSize(d.original_size),
        compressed: formatSize(d.compressed_size),
      });
      errors = d.errors;
      if (d.original_size > 0 && d.output_path) {
        extraContent = (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-border)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  background: "var(--text-primary)",
                  width: `${Math.max(5, (d.compressed_size / d.original_size) * 100)}%`,
                }}
              />
            </div>
            <span className="text-[10px] font-mono text-neutral-500">
              {d.original_size > d.compressed_size
                ? `-${(((d.original_size - d.compressed_size) / d.original_size) * 100).toFixed(1)}%`
                : t("result.no_reduction")}
            </span>
          </div>
        );
      }
      break;
    }

    case "watermark":
      successIcon = result.data.page_count > 0 && result.data.errors.length === 0;
      mainText = t("result.pdf_watermarked", { n: result.data.page_count });
      errors = result.data.errors;
      break;

    case "protect": {
      successIcon = result.data.success;
      if (result.data.success) {
        mainText = result.mode === "protect" ? t("result.pdf_protected") : t("result.pdf_unlocked");
        errors = [];
      } else {
        const firstErr = result.data.errors[0];
        // Translate the well-known sentinel emitted by unlock_pdf when pdfium
        // reports a password mismatch; show raw text otherwise.
        if (firstErr === "WRONG_PASSWORD") {
          mainText = t("toast.pdf_wrong_password");
        } else {
          mainText = firstErr || t("toast.all_failed");
        }
        // Single, already-displayed error — don't duplicate it below.
        errors = [];
      }
      break;
    }

    case "pipeline":
      successIcon = result.errors.length === 0;
      mainText = t("result.pipeline_complete", { steps: result.steps.join(" → ") });
      errors = result.errors;
      break;
  }

  return (
    <div className="forge-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {successIcon ? (
            <CheckCircle className="h-4 w-4" style={{ color: "var(--success)" }} strokeWidth={1.5} />
          ) : (
            <XCircle className="h-4 w-4" style={{ color: "var(--warning)" }} strokeWidth={1.5} />
          )}
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}>{mainText}</span>
        </div>
        <div className="flex items-center gap-2">
          {result.outputDir && (
            <button onClick={() => revealItemInDir(result.outputDir)} className="btn-ghost">
              <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
              {t("label.open_output_folder")}
            </button>
          )}
        </div>
      </div>

      {extraContent}

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
