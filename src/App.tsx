import { useState, useMemo, useCallback, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Toaster } from "sonner";
import {
  Zap,
  ArrowRightLeft,
  FileDown,
  Scaling,
  ShieldOff,
  Stamp,
  Sparkles,
  Crop,
  Pipette,
  Globe,
  Film,
  LayoutGrid,
  Code,
  QrCode,
  PenLine,
  FileImage,
} from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette, type CommandTool } from "./components/CommandPalette";
import { WorkbenchShell } from "./components/WorkbenchShell";
import { ToolRail } from "./components/ToolRail";
import { CompressTab } from "./components/CompressTab";
import { ConvertTab } from "./components/ConvertTab";
import { ResizeTab } from "./components/ResizeTab";
import { WatermarkTab } from "./components/WatermarkTab";
import { ExifStripTab } from "./components/ExifStripTab";
import { OptimizeTab } from "./components/OptimizeTab";
import { CropTab } from "./components/CropTab";
import { PdfWorkbenchTab } from "./components/PdfWorkbenchTab";
import { PaletteTab } from "./components/PaletteTab";
import { FaviconTab } from "./components/FaviconTab";
import { AnimationTab } from "./components/AnimationTab";
import { SpriteSheetTab } from "./components/SpriteSheetTab";
import { Base64Tab } from "./components/Base64Tab";
import { QrCodeTab } from "./components/QrCodeTab";
import { BulkRenameTab } from "./components/BulkRenameTab";
import { SvgRasterizeTab } from "./components/SvgRasterizeTab";
import { HistoryModal } from "./components/HistoryModal";
import { GlobalProgressBar } from "./components/GlobalProgressBar";
import { SplashScreen } from "./components/SplashScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { OnboardingModal } from "./components/OnboardingModal";
import { UpdateBanner } from "./components/UpdateBanner";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { useT } from "./i18n/i18n";
import type { TabId } from "./types";
import "./App.css";

const TAB_EXTENSIONS: Record<TabId, string[]> = {
  compress: ["png", "jpg", "jpeg", "bmp", "ico", "tiff", "tif", "webp"],
  convert: ["png", "jpg", "jpeg", "bmp", "ico", "tiff", "tif", "webp", "gif"],
  resize: ["png", "jpg", "jpeg", "bmp", "ico", "tiff", "tif", "webp", "gif"],
  watermark: ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"],
  strip: ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"],
  optimize: ["png", "jpg", "jpeg"],
  crop: ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"],
  "pdf-toolkit": ["png", "jpg", "jpeg", "bmp", "ico", "tiff", "tif", "webp", "pdf"],
  palette: ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"],
  favicon: ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"],
  animation: ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"],
  spritesheet: ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"],
  base64: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tiff", "tif"],
  qrcode: [],
  "bulk-rename": ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp", "gif", "ico", "svg"],
  "svg-rasterize": ["svg"],
};

interface TabDef {
  id: TabId;
  labelKey: string;
  icon: typeof Zap;
}

interface SidebarSection {
  titleKey: string;
  tabs: TabDef[];
}

const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    titleKey: "section.image_tools",
    tabs: [
      { id: "compress", labelKey: "tab.compress", icon: Zap },
      { id: "convert", labelKey: "tab.convert", icon: ArrowRightLeft },
      { id: "resize", labelKey: "tab.resize", icon: Scaling },
      { id: "crop", labelKey: "tab.crop", icon: Crop },
      { id: "optimize", labelKey: "tab.optimize", icon: Sparkles },
      { id: "watermark", labelKey: "tab.watermark", icon: Stamp },
      { id: "strip", labelKey: "tab.strip", icon: ShieldOff },
      { id: "palette", labelKey: "tab.palette", icon: Pipette },
      { id: "svg-rasterize", labelKey: "tab.svg_rasterize", icon: FileImage },
    ],
  },
  {
    titleKey: "section.pdf_tools",
    tabs: [{ id: "pdf-toolkit", labelKey: "tab.pdf_toolkit", icon: FileDown }],
  },
  {
    titleKey: "section.dev_tools",
    tabs: [
      { id: "favicon", labelKey: "tab.favicon", icon: Globe },
      { id: "animation", labelKey: "tab.animation", icon: Film },
      { id: "spritesheet", labelKey: "tab.spritesheet", icon: LayoutGrid },
      { id: "base64", labelKey: "tab.base64", icon: Code },
      { id: "qrcode", labelKey: "tab.qrcode", icon: QrCode },
      { id: "bulk-rename", labelKey: "tab.bulk_rename", icon: PenLine },
    ],
  },
];

const TAB_DESC_KEYS: Record<TabId, string> = {
  compress: "tab.compress.desc",
  convert: "tab.convert.desc",
  resize: "tab.resize.desc",
  watermark: "tab.watermark.desc",
  strip: "tab.strip.desc",
  optimize: "tab.optimize.desc",
  crop: "tab.crop.desc",
  "pdf-toolkit": "tab.pdf_toolkit.desc",
  palette: "tab.palette.desc",
  favicon: "tab.favicon.desc",
  animation: "tab.animation.desc",
  spritesheet: "tab.spritesheet.desc",
  base64: "tab.base64.desc",
  qrcode: "tab.qrcode.desc",
  "bulk-rename": "tab.bulk_rename.desc",
  "svg-rasterize": "tab.svg_rasterize.desc",
};

// Tools migrated to the full-width Établi 2-pane layout (others use the centered column).
const ETABLI_TOOLS = new Set<TabId>([
  "compress",
  "convert",
  "optimize",
  "resize",
  "watermark",
  "svg-rasterize",
  "favicon",
  "spritesheet",
]);

const TAB_LABEL_KEYS: Record<TabId, string> = {
  compress: "tab.compress",
  convert: "tab.convert",
  resize: "tab.resize",
  watermark: "tab.watermark",
  strip: "tab.strip",
  optimize: "tab.optimize",
  crop: "tab.crop",
  "pdf-toolkit": "tab.pdf_toolkit",
  palette: "tab.palette",
  favicon: "tab.favicon",
  animation: "tab.animation",
  spritesheet: "tab.spritesheet",
  base64: "tab.base64",
  qrcode: "tab.qrcode",
  "bulk-rename": "tab.bulk_rename",
  "svg-rasterize": "tab.svg_rasterize",
};

function App() {
  const { t } = useT();
  const {
    status: updateStatus,
    version: updateVersion,
    install: installUpdate,
    dismiss: dismissUpdate,
  } = useAutoUpdate();
  const [appVersion, setAppVersion] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("compress");
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return localStorage.getItem("rustine_onboarded") !== "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1200);
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => {});
    return () => clearTimeout(timer);
  }, []);

  // ⌘K / Ctrl+K — toggle the command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const commandTools = useMemo<CommandTool[]>(
    () =>
      SIDEBAR_SECTIONS.flatMap((section) =>
        section.tabs.map((tab) => ({
          id: tab.id,
          label: t(tab.labelKey),
          category: t(section.titleKey),
          icon: tab.icon,
        })),
      ),
    [t],
  );

  const activeExtensions = useMemo(() => TAB_EXTENSIONS[activeTab], [activeTab]);

  const handleShortcutFiles = useCallback((paths: string[]) => {
    // Dispatch a custom event that tab components can listen to
    window.dispatchEvent(new CustomEvent("rustine-shortcut-files", { detail: paths }));
  }, []);

  useGlobalShortcuts({
    acceptExtensions: activeExtensions,
    onFilesSelected: handleShortcutFiles,
  });

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <TitleBar onShowHistory={() => setShowHistory(true)} onShowSettings={() => setShowSettings(true)} />
      <UpdateBanner status={updateStatus} version={updateVersion} onInstall={installUpdate} onDismiss={dismissUpdate} />

      <WorkbenchShell
        rail={
          <ToolRail
            sections={SIDEBAR_SECTIONS}
            activeTab={activeTab}
            onSelect={setActiveTab}
            onOpenCommand={() => setCmdOpen(true)}
            appVersion={appVersion}
          />
        }
      >
        {ETABLI_TOOLS.has(activeTab) ? (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                }}
              >
                {t(TAB_LABEL_KEYS[activeTab])}
              </h2>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                {t(TAB_DESC_KEYS[activeTab])}
              </p>
            </div>
            {activeTab === "compress" && <CompressTab />}
            {activeTab === "convert" && <ConvertTab />}
            {activeTab === "optimize" && <OptimizeTab />}
            {activeTab === "resize" && <ResizeTab />}
            {activeTab === "watermark" && <WatermarkTab />}
            {activeTab === "svg-rasterize" && <SvgRasterizeTab />}
            {activeTab === "favicon" && <FaviconTab />}
            {activeTab === "spritesheet" && <SpriteSheetTab />}
          </div>
        ) : (
          <div className="mx-auto" style={{ maxWidth: 860 }}>
            <div style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                }}
              >
                {t(TAB_LABEL_KEYS[activeTab])}
              </h2>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                {t(TAB_DESC_KEYS[activeTab])}
              </p>
            </div>

            {activeTab === "crop" && <CropTab />}
            {activeTab === "strip" && <ExifStripTab />}
            {activeTab === "pdf-toolkit" && <PdfWorkbenchTab />}
            {activeTab === "palette" && <PaletteTab />}
            {activeTab === "animation" && <AnimationTab />}
            {activeTab === "base64" && <Base64Tab />}
            {activeTab === "qrcode" && <QrCodeTab />}
            {activeTab === "bulk-rename" && <BulkRenameTab />}
          </div>
        )}
      </WorkbenchShell>

      <SplashScreen visible={isLoading} />
      <GlobalProgressBar />

      <CommandPalette
        open={cmdOpen}
        tools={commandTools}
        onClose={() => setCmdOpen(false)}
        onNavigate={(id) => {
          setActiveTab(id);
          setCmdOpen(false);
        }}
      />

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onResetOnboarding={() => {
            setShowSettings(false);
            setShowOnboarding(true);
          }}
        />
      )}
      {showOnboarding && (
        <OnboardingModal
          onComplete={() => {
            setShowOnboarding(false);
            try {
              localStorage.setItem("rustine_onboarded", "1");
            } catch {}
          }}
        />
      )}

      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "var(--bg-elevated)",
            border: "1px solid var(--glass-border)",
            borderRadius: "8px",
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          },
        }}
      />
    </div>
  );
}

export default App;
