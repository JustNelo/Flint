import { useEffect } from "react";

interface UseGlobalShortcutsOptions {
  acceptExtensions: string[];
}

export function useGlobalShortcuts(_options: UseGlobalShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      // Ctrl+Enter — click the active action button
      if (e.key === "Enter") {
        e.preventDefault();
        const btn = document.querySelector<HTMLButtonElement>("[data-action-button]");
        if (btn && !btn.disabled) btn.click();
        return;
      }

      // Ctrl+L — clear files
      if (e.key === "l") {
        e.preventDefault();
        const btn = document.querySelector<HTMLButtonElement>("[data-clear-button]");
        if (btn) btn.click();
        return;
      }

      // Escape — cancel ongoing processing
      if (e.key === "Escape") {
        e.preventDefault();
        const btn = document.querySelector<HTMLButtonElement>("[data-cancel-button]");
        if (btn) btn.click();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
