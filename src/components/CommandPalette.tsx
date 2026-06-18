import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { TabId } from "../types";
import { useT } from "../i18n/i18n";

export interface CommandTool {
  id: TabId;
  label: string;
  category: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

interface CommandPaletteProps {
  open: boolean;
  tools: CommandTool[];
  onClose: () => void;
  onNavigate: (id: TabId) => void;
}

export function CommandPalette({ open, tools, onClose, onNavigate }: CommandPaletteProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state whenever the palette is (re)opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((tool) => `${tool.label} ${tool.category}`.toLowerCase().includes(q));
  }, [tools, query]);

  // Keep the highlighted index in range as the result set shrinks.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Group the (already filtered) flat list by category, preserving order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byCategory = new Map<string, { tool: CommandTool; index: number }[]>();
    filtered.forEach((tool, index) => {
      if (!byCategory.has(tool.category)) {
        byCategory.set(tool.category, []);
        order.push(tool.category);
      }
      byCategory.get(tool.category)!.push({ tool, index });
    });
    return order.map((category) => ({ category, items: byCategory.get(category)! }));
  }, [filtered]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const commit = (index: number) => {
    const tool = filtered[index];
    if (tool) onNavigate(tool.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div className="cmd-container" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <span className="cmd-key-icon">
            <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            className="cmd-input"
            placeholder={t("cmd.placeholder")}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="cmd-esc-hint">Esc</span>
        </div>

        <div className="cmd-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmd-empty">{t("cmd.empty")}</div>
          ) : (
            groups.map((group) => (
              <div key={group.category}>
                <div className="cmd-group-heading">{group.category}</div>
                {group.items.map(({ tool, index }) => {
                  const Icon = tool.icon;
                  return (
                    <div
                      key={tool.id}
                      data-index={index}
                      data-active={index === activeIndex}
                      className="cmd-item"
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => commit(index)}
                    >
                      <span className="cmd-item-icon">
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </span>
                      <span className="cmd-item-label">{tool.label}</span>
                      <span className="cmd-item-category">{tool.category}</span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
