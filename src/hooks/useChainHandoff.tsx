import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { TabId } from "../types";

interface Handoff {
  tab: TabId;
  files: string[];
}

interface ChainContextValue {
  pending: Handoff | null;
  requestChain: (tab: TabId, files: string[]) => void;
  consumeChain: (tab: TabId) => string[] | null;
}

const ChainContext = createContext<ChainContextValue | null>(null);

export function ChainHandoffProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Handoff | null>(null);
  // Ref mirrors `pending` for synchronous reads in consumeChain (called from a
  // freshly-mounted tab's effect, where the latest value must be available).
  const ref = useRef<Handoff | null>(null);

  const requestChain = useCallback((tab: TabId, files: string[]) => {
    const h = { tab, files };
    ref.current = h;
    setPending(h);
  }, []);

  const consumeChain = useCallback((tab: TabId): string[] | null => {
    const p = ref.current;
    if (p && p.tab === tab) {
      ref.current = null;
      setPending(null);
      return p.files;
    }
    return null;
  }, []);

  return <ChainContext.Provider value={{ pending, requestChain, consumeChain }}>{children}</ChainContext.Provider>;
}

export function useChainHandoff(): ChainContextValue {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChainHandoff must be used within a ChainHandoffProvider");
  return ctx;
}
