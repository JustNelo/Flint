import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useFileSelection } from "./useFileSelection";
import { useWorkspace } from "./useWorkspace";
import { useChainHandoff } from "./useChainHandoff";
import { useT } from "../i18n/i18n";
import { logError } from "../lib/utils";
import type { TabId, BatchProgress, ProcessingResult } from "../types";

interface UseTabProcessorOptions {
  tabId: TabId;
  command: string;
}

interface ProcessCallOptions {
  extraParams?: Record<string, unknown>;
  successMessage: string;
}

export function useTabProcessor({ tabId, command }: UseTabProcessorOptions) {
  const { t } = useT();
  const fileSelection = useFileSelection();
  const { getOutputDir } = useWorkspace();
  const { consumeChain } = useChainHandoff();
  // Load files handed off from a chained tool on mount.
  useEffect(() => {
    const chained = consumeChain(tabId);
    if (chained && chained.length > 0) fileSelection.addFiles(chained);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProcessingResult[]>([]);
  const [lastOutputDir, setLastOutputDir] = useState<string>("");

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      fileSelection.addFiles(paths);
      setResults([]);
    },
    [fileSelection.addFiles],
  );

  const handleClearFiles = useCallback(() => {
    fileSelection.clearFiles();
    setResults([]);
  }, [fileSelection.clearFiles]);

  const process = useCallback(
    async ({ extraParams, successMessage }: ProcessCallOptions) => {
      if (fileSelection.files.length === 0) {
        toast.error(t("toast.select_images"));
        return;
      }
      const outputDir = await getOutputDir(tabId);
      if (!outputDir) {
        toast.error(t("toast.workspace_missing"));
        return;
      }

      setLoading(true);
      setResults([]);
      setLastOutputDir(outputDir);

      try {
        const result = await invoke<BatchProgress>(command, {
          inputPaths: fileSelection.files,
          outputDir,
          ...extraParams,
        });

        setResults(result.results);

        if (result.completed === result.total) {
          toast.success(successMessage);
        } else if (result.completed > 0) {
          toast.warning(
            t("toast.partial", {
              completed: result.completed,
              total: result.total,
            }),
          );
        } else {
          toast.error(t("toast.all_failed"));
        }
      } catch (err) {
        logError(`tab:${tabId}:${command}`, err);
        toast.error(t("toast.operation_failed"));
      } finally {
        setLoading(false);
      }
    },
    [fileSelection.files, command, tabId, getOutputDir, t],
  );

  return {
    files: fileSelection.files,
    addFiles: fileSelection.addFiles,
    removeFile: fileSelection.removeFile,
    clearFiles: fileSelection.clearFiles,
    reorderFiles: fileSelection.reorderFiles,
    handleFilesSelected,
    handleClearFiles,
    loading,
    results,
    setResults,
    lastOutputDir,
    process,
  };
}
