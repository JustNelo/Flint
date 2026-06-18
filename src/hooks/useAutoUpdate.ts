import { useState, useEffect, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus = "idle" | "available" | "downloading" | "error";

interface AutoUpdateState {
  status: UpdateStatus;
  version: string;
  checkNow: () => Promise<{ available: boolean; version: string }>;
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useAutoUpdate(): AutoUpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState("");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkForUpdate = async () => {
      try {
        const update = await check();
        if (cancelled) return;
        if (update) {
          setVersion(update.version);
          setPendingUpdate(update);
          setStatus("available");
        }
      } catch {
        // Silent fail — no update banner on network error
      }
    };

    checkForUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  const checkNow = useCallback(async (): Promise<{ available: boolean; version: string }> => {
    const update = await check();
    if (update) {
      setVersion(update.version);
      setPendingUpdate(update);
      setStatus("available");
      return { available: true, version: update.version };
    }
    return { available: false, version: "" };
  }, []);

  const install = useCallback(async () => {
    if (!pendingUpdate) return;
    setStatus("downloading");
    try {
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    } catch {
      setStatus("error");
    }
  }, [pendingUpdate]);

  const dismiss = useCallback(() => {
    setStatus("idle");
    setPendingUpdate(null);
  }, []);

  return { status, version, checkNow, install, dismiss };
}
