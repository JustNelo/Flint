import { useState, useMemo, useEffect, lazy, Suspense } from "react";
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
const CompressTab = lazy(() => import("./components/CompressTab").then((m) => ({ default: m.CompressTab })));
const ConvertTab = lazy(() => import("./components/ConvertTab").then((m) => ({ default: m.ConvertTab })));
const ResizeTab = lazy(() => import("./components/ResizeTab").then((m) => ({ default: m.ResizeTab })));
const WatermarkTab = lazy(() => import("./components/WatermarkTab").then((m) => ({ default: m.WatermarkTab })));
const ExifStripTab = lazy(() => import("./components/ExifStripTab").then((m) => ({ default: m.ExifStripTab })));
const OptimizeTab = lazy(() => import("./components/OptimizeTab").then((m) => ({ default: m.OptimizeTab })));
const CropTab = lazy(() => import("./components/CropTab").then((m) => ({ default: m.CropTab })));
const PdfWorkbenchTab = lazy(() =>
  import("./components/PdfWorkbenchTab").then((m) => ({ default: m.PdfWorkbenchTab })),
);
const PaletteTab = lazy(() => import("./components/PaletteTab").then((m) => ({ default: m.PaletteTab })));
const FaviconTab = lazy(() => import("./components/FaviconTab").then((m) => ({ default: m.FaviconTab })));
const AnimationTab = lazy(() => import("./components/AnimationTab").then((m) => ({ default: m.AnimationTab })));
const SpriteSheetTab = lazy(() => import("./components/SpriteSheetTab").then((m) => ({ default: m.SpriteSheetTab })));
const Base64Tab = lazy(() => import("./components/Base64Tab").then((m) => ({ default: m.Base64Tab })));
const QrCodeTab = lazy(() => import("./components/QrCodeTab").then((m) => ({ default: m.QrCodeTab })));
const BulkRenameTab = lazy(() => import("./components/BulkRenameTab").then((m) => ({ default: m.BulkRenameTab })));
const SvgRasterizeTab = lazy(() => import("./components/SvgRasterizeTab").then((m) => ({ default: m.SvgRasterizeTab })));
import { GlobalProgressBar } from "./components/GlobalProgressBar";
import { SplashScreen } from "./components/SplashScreen";
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));
const OnboardingModal = lazy(() => import("./components/OnboardingModal").then((m) => ({ default: m.OnboardingModal })));
import { UpdateBanner } from "./components/UpdateBanner";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { useT } from "./i18n/i18n";
import type { TabId } from "./types";
import "./App.css";

// Shown while a lazily-loaded tool chunk resolves. Chunks load from local disk
// in ~ms, so this is intentionally minimal and rarely visible.
function TabFallback() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 240 }}>
      <div
        className="animate-pulse"
        style={{ width: 28, height: 28, borderRadius: 8, background: "var(--bg-elevated)" }}
      />
    </div>
  );
}

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
  "strip",
  "bulk-rename",
  "crop",
  "animation",
  "pdf-toolkit",
]);

const TAB_LABEL_KEYS = Object.fromEntries(
  SIDEBAR_SECTIONS.flatMap((s) => s.tabs.map((t) => [t.id, t.labelKey])),
) as Record<TabId, string>;
const labelKeyFor = (id: TabId) => TAB_LABEL_KEYS[id];
const descKeyFor = (id: TabId) => `${TAB_LABEL_KEYS[id]}.desc`;

function ToolHeader({ title, description }: { title: string; description: string }) {
  return (
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
        {title}
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
        {description}
      </p>
    </div>
  );
}

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

  useGlobalShortcuts({
    acceptExtensions: activeExtensions,
  });

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <TitleBar onShowSettings={() => setShowSettings(true)} />
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
        <Suspense fallback={<TabFallback />}>
          {ETABLI_TOOLS.has(activeTab) ? (
            <div>
              <ToolHeader title={t(labelKeyFor(activeTab))} description={t(descKeyFor(activeTab))} />
              {activeTab === "compress" && <CompressTab />}
              {activeTab === "convert" && <ConvertTab />}
              {activeTab === "optimize" && <OptimizeTab />}
              {activeTab === "resize" && <ResizeTab />}
              {activeTab === "watermark" && <WatermarkTab />}
              {activeTab === "svg-rasterize" && <SvgRasterizeTab />}
              {activeTab === "favicon" && <FaviconTab />}
              {activeTab === "spritesheet" && <SpriteSheetTab />}
              {activeTab === "strip" && <ExifStripTab />}
              {activeTab === "bulk-rename" && <BulkRenameTab />}
              {activeTab === "crop" && <CropTab />}
              {activeTab === "animation" && <AnimationTab />}
              {activeTab === "pdf-toolkit" && <PdfWorkbenchTab />}
            </div>
          ) : (
            <div className="mx-auto" style={{ maxWidth: 860 }}>
              <ToolHeader title={t(labelKeyFor(activeTab))} description={t(descKeyFor(activeTab))} />

              {activeTab === "palette" && <PaletteTab />}
              {activeTab === "base64" && <Base64Tab />}
              {activeTab === "qrcode" && <QrCodeTab />}
            </div>
          )}
        </Suspense>
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

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            onResetOnboarding={() => {
              setShowSettings(false);
              setShowOnboarding(true);
            }}
          />
        </Suspense>
      )}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingModal
            onComplete={() => {
              setShowOnboarding(false);
              try {
                localStorage.setItem("rustine_onboarded", "1");
              } catch {}
            }}
          />
        </Suspense>
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
