import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { convertFileSrc } from "@tauri-apps/api/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "bmp", "ico", "tiff", "tif", "webp", "gif", "svg"]);

export function isImage(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Convert a local file path to a URL usable by the webview.
 * Normalizes backslashes to forward slashes so the asset protocol
 * works correctly on Windows (Tauri issue #7970).
 */
export function safeAssetUrl(filePath: string, bustCache = false): string {
  const normalized = filePath.replace(/\\/g, "/");
  const base = convertFileSrc(normalized);
  return bustCache ? `${base}?v=${encodeURIComponent(filePath)}` : base;
}

/**
 * Log an error from a Tauri invoke / async boundary in a consistent shape.
 * The user-facing toast remains driven by i18n; this just makes the original
 * Rust error reachable via devtools so bug reports stop saying "it failed".
 */
export function logError(context: string, err: unknown): void {
  // Rust commands always reject with String, but other layers (Tauri plugins,
  // network) may reject with an Error or any other shape — normalize all of them.
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${context}]`, message, err);
}
