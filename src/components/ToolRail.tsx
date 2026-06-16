import { useState } from "react";
import { Search, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePersistedState } from "../hooks/usePersistedState";
import { useT } from "../i18n/i18n";
import type { TabId } from "../types";

export interface RailTab {
  id: TabId;
  labelKey: string;
  icon: LucideIcon;
}

export interface RailSection {
  titleKey: string;
  tabs: RailTab[];
}

interface ToolRailProps {
  sections: RailSection[];
  activeTab: TabId;
  onSelect: (id: TabId) => void;
  onOpenCommand: () => void;
  appVersion?: string;
}

const COLLAPSED_W = 56;
const EXPANDED_W = 200;

export function ToolRail({ sections, activeTab, onSelect, onOpenCommand, appVersion }: ToolRailProps) {
  const { t } = useT();
  const [pinned, setPinned] = usePersistedState<boolean>("rail_pinned", false);
  const width = pinned ? EXPANDED_W : COLLAPSED_W;
  const [hoveredId, setHoveredId] = useState<TabId | null>(null);

  return (
    <aside
      className="flex shrink-0 flex-col"
      style={{
        width,
        background: "var(--flint-sidebar-bg)",
        borderRight: "1px solid var(--flint-sidebar-border)",
        transition: "width 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div style={{ padding: 8 }}>
        <button
          onClick={onOpenCommand}
          title={`${t("cmd.placeholder")} (Ctrl+K)`}
          className="flex items-center w-full cursor-pointer"
          style={{
            gap: 8,
            height: 34,
            padding: pinned ? "0 10px" : 0,
            justifyContent: pinned ? "flex-start" : "center",
            borderRadius: 8,
            background: "var(--bg-overlay)",
            border: "1px solid var(--flint-sidebar-border)",
            color: "var(--text-tertiary)",
          }}
        >
          <Search style={{ width: 14, height: 14, flexShrink: 0 }} strokeWidth={1.5} />
          {pinned && (
            <span style={{ flex: 1, textAlign: "left", fontSize: 11, fontFamily: "var(--font-sans)" }}>
              {t("cmd.placeholder")}
            </span>
          )}
          {pinned && (
            <kbd
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                padding: "2px 5px",
                borderRadius: 4,
                background: "var(--bg-base)",
                color: "var(--text-tertiary)",
              }}
            >
              ⌘K
            </kbd>
          )}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 mt-1 flex-1 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.titleKey} className="mb-1">
            {pinned ? (
              <div className="px-3 pt-4 pb-1.5">
                <span
                  className="font-semibold uppercase select-none"
                  style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}
                >
                  {t(section.titleKey)}
                </span>
              </div>
            ) : (
              <div style={{ height: 1, background: "var(--flint-sidebar-border)", margin: "8px 8px 6px" }} />
            )}
            {section.tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isHovered = hoveredId === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelect(tab.id)}
                  title={pinned ? undefined : t(tab.labelKey)}
                  className="relative flex items-center w-full cursor-pointer"
                  style={{
                    height: 34,
                    padding: pinned ? "0 12px" : 0,
                    justifyContent: pinned ? "flex-start" : "center",
                    borderRadius: 6,
                    gap: 8,
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    fontFamily: "var(--font-sans)",
                    transition: "background 150ms ease, color 150ms ease",
                    background: isActive
                      ? "linear-gradient(90deg, var(--flint-bg-elevated), transparent)"
                      : isHovered
                        ? "var(--bg-overlay)"
                        : "transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    border: "none",
                  }}
                  onMouseEnter={() => setHoveredId(tab.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2"
                    style={{
                      width: 2,
                      height: 16,
                      borderRadius: 1,
                      background: isActive ? "var(--indigo-core)" : "transparent",
                    }}
                  />
                  <Icon
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      color: isActive ? "var(--indigo-core)" : "var(--text-tertiary)",
                    }}
                    strokeWidth={1.5}
                  />
                  {pinned && t(tab.labelKey)}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        style={{
          borderTop: "1px solid var(--flint-sidebar-border)",
          padding: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: pinned ? "space-between" : "center",
          gap: 6,
        }}
      >
        {pinned && appVersion && (
          <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", paddingLeft: 6 }}>
            v{appVersion}
          </span>
        )}
        <button
          onClick={() => setPinned(!pinned)}
          title={pinned ? t("rail.collapse") : t("rail.expand")}
          className="btn-icon"
          style={{ flexShrink: 0 }}
        >
          {pinned ? (
            <PanelLeftClose style={{ width: 16, height: 16 }} strokeWidth={1.5} />
          ) : (
            <PanelLeftOpen style={{ width: 16, height: 16 }} strokeWidth={1.5} />
          )}
        </button>
      </div>
    </aside>
  );
}
