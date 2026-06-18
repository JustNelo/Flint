import type { ReactNode } from "react";

interface WorkbenchShellProps {
  /** The tool rail rendered on the left. */
  rail: ReactNode;
  /** Main content (the active tool). */
  children: ReactNode;
}

/**
 * Établi layout frame: a left rail slot + a full-height scrolling content area.
 * Phase 1a keeps content as a single column; the material/controls split is added
 * in Phase 1b.
 */
export function WorkbenchShell({ rail, children }: WorkbenchShellProps) {
  return (
    <div className="relative z-10 flex flex-1 overflow-hidden">
      {rail}
      <main className="flex-1 overflow-y-auto" style={{ padding: "28px 36px" }}>
        {children}
      </main>
    </div>
  );
}
