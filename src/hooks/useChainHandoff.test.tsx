import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ChainHandoffProvider, useChainHandoff } from "./useChainHandoff";

const wrapper = ({ children }: { children: ReactNode }) => <ChainHandoffProvider>{children}</ChainHandoffProvider>;

describe("useChainHandoff", () => {
  it("requests then consumes a handoff for the matching tab", () => {
    const { result } = renderHook(() => useChainHandoff(), { wrapper });

    act(() => result.current.requestChain("resize", ["/a.png", "/b.png"]));
    expect(result.current.pending).toEqual({ tab: "resize", files: ["/a.png", "/b.png"] });

    let taken: string[] | null = null;
    act(() => {
      taken = result.current.consumeChain("resize");
    });
    expect(taken).toEqual(["/a.png", "/b.png"]);
    expect(result.current.pending).toBeNull();
  });

  it("does not consume for a non-matching tab", () => {
    const { result } = renderHook(() => useChainHandoff(), { wrapper });

    act(() => result.current.requestChain("resize", ["/a.png"]));

    let taken: string[] | null = ["sentinel"];
    act(() => {
      taken = result.current.consumeChain("crop");
    });
    expect(taken).toBeNull();
    expect(result.current.pending).not.toBeNull();
  });
});
