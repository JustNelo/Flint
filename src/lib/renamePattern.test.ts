import { describe, it, expect } from "vitest";
import { applyRenamePattern } from "./renamePattern";

describe("applyRenamePattern", () => {
  it("substitutes name, zero-padded index and ext", () => {
    expect(applyRenamePattern("photo.png", "{name}_{index}", 1, "2026-06-18")).toBe("photo_001.png");
  });
  it("uses {date}", () => {
    expect(applyRenamePattern("a.jpg", "{date}-{index}", 12, "2026-06-18")).toBe("2026-06-18-012.jpg");
  });
  it("respects an explicit {ext} token without doubling the extension", () => {
    expect(applyRenamePattern("a.jpg", "{name}.{ext}", 1, "2026-06-18")).toBe("a.jpg");
  });
  it("handles names without extension", () => {
    expect(applyRenamePattern("README", "{name}_{index}", 5, "2026-06-18")).toBe("README_005");
  });
});
