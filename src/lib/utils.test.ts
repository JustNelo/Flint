import { describe, it, expect, vi } from "vitest";

// Tauri's asset-url helper has no runtime in jsdom — stub it so safeAssetUrl
// (reached via resolveThumb's null fallback) just echoes the path.
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));

import { formatSize, isImage, getFileName, resolveThumb } from "./utils";

describe("formatSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("isImage", () => {
  it("accepts known raster types incl. avif, case-insensitive", () => {
    expect(isImage("a.PNG")).toBe(true);
    expect(isImage("b.avif")).toBe(true);
    expect(isImage("c.txt")).toBe(false);
    expect(isImage("noext")).toBe(false);
  });
});

describe("getFileName", () => {
  it("handles windows and unix separators", () => {
    expect(getFileName("C:\\a\\b\\c.png")).toBe("c.png");
    expect(getFileName("/a/b/c.png")).toBe("c.png");
    expect(getFileName("bare.png")).toBe("bare.png");
  });
});

describe("resolveThumb", () => {
  it("returns the thumbnail when present", () => {
    expect(resolveThumb("data:img", "/x.png")).toBe("data:img");
  });
  it("returns undefined while pending", () => {
    expect(resolveThumb(undefined, "/x.png")).toBeUndefined();
  });
  it("falls back to the original asset url when null", () => {
    expect(resolveThumb(null, "/x.png")).toBeTruthy();
  });
});
