import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, exists } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { TabId } from "../types";

const STORAGE_KEY = "rustine_workspace";

const SUB_FOLDERS: Partial<Record<TabId, string>> = {
  compress: "compressed",
  convert: "converted",
  resize: "resized",
  watermark: "watermarked",
  strip: "stripped",
  optimize: "optimized",
  crop: "cropped",
  "pdf-toolkit": "pdf-toolkit",
  palette: "palettes",
  favicon: "favicons",
  animation: "animations",
  spritesheet: "spritesheets",
  base64: "base64",
  qrcode: "qrcodes",
  "bulk-rename": "renamed",
  "svg-rasterize": "svg-rasterized",
};

interface WorkspaceContextValue {
  workspace: string;
  selectWorkspace: () => Promise<void>;
  getOutputDir: (tabId: TabId) => Promise<string>;
  openInExplorer: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });

  const selectWorkspace = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setWorkspace(selected);
        try {
          localStorage.setItem(STORAGE_KEY, selected);
        } catch {
          // localStorage may be unavailable
        }
      }
    } catch {
      // Dialog cancelled or errored — no user notification needed for cancel
    }
  }, []);

  const subPathFor = useCallback(
    (tabId: TabId): string => {
      const subFolder = SUB_FOLDERS[tabId];
      if (!subFolder) throw new Error(`No output sub-folder configured for tab "${tabId}"`);
      const sep = workspace.includes("/") ? "/" : "\\";
      return `${workspace}${sep}${subFolder}`;
    },
    [workspace],
  );

  const getOutputDir = useCallback(
    async (tabId: TabId): Promise<string> => {
      if (!workspace) return "";
      const outputDir = subPathFor(tabId);

      try {
        const dirExists = await exists(outputDir);
        if (!dirExists) {
          await mkdir(outputDir, { recursive: true });
        }
      } catch (err) {
        console.error("Cannot create output dir:", err);
      }

      return outputDir;
    },
    [workspace, subPathFor],
  );

  const openInExplorer = useCallback(async () => {
    if (!workspace) return;
    try {
      await revealItemInDir(workspace);
    } catch (err) {
      console.error("Cannot open explorer:", err);
    }
  }, [workspace]);

  const value = useMemo(
    () => ({ workspace, selectWorkspace, getOutputDir, openInExplorer }),
    [workspace, selectWorkspace, getOutputDir, openInExplorer],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
