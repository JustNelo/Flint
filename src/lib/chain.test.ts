import { describe, it, expect } from "vitest";
import { compatibleChainTargets } from "./chain";

describe("compatibleChainTargets", () => {
  it("excludes the source tool", () => {
    const ids = compatibleChainTargets("compress", ["png"]).map((t) => t.id);
    expect(ids).not.toContain("compress");
  });

  it("offers optimize for png but not for webp", () => {
    expect(compatibleChainTargets("convert", ["png"]).map((t) => t.id)).toContain("optimize");
    expect(compatibleChainTargets("convert", ["webp"]).map((t) => t.id)).not.toContain("optimize");
  });

  it("returns nothing for empty extensions", () => {
    expect(compatibleChainTargets("compress", [])).toEqual([]);
  });

  it("requires every produced extension to be accepted", () => {
    // mixed png + webp: optimize (png/jpg only) must drop out
    expect(compatibleChainTargets("convert", ["png", "webp"]).map((t) => t.id)).not.toContain("optimize");
  });
});
