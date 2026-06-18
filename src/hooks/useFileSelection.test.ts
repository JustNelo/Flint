import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileSelection } from "./useFileSelection";

describe("useFileSelection", () => {
  it("adds files and dedupes by path", () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => result.current.addFiles(["/a.png", "/b.png"]));
    act(() => result.current.addFiles(["/b.png", "/c.png"]));
    expect(result.current.files).toEqual(["/a.png", "/b.png", "/c.png"]);
  });

  it("removes by index, reorders and clears", () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => result.current.addFiles(["/a.png", "/b.png", "/c.png"]));
    act(() => result.current.removeFile(1));
    expect(result.current.files).toEqual(["/a.png", "/c.png"]);
    act(() => result.current.reorderFiles(0, 1));
    expect(result.current.files).toEqual(["/c.png", "/a.png"]);
    act(() => result.current.clearFiles());
    expect(result.current.files).toEqual([]);
  });
});
