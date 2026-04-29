import { useEffect, useCallback } from "react";

export function useKeyboardShortcuts({
  onFocusSearch,
  onClearSearch,
  onToggleSidebar,
  onSelectServerByIndex,
  onRefresh,
}) {
  const handleKeyDown = useCallback((event) => {
    const isMod = event.metaKey || event.ctrlKey;
    const tag = event.target.tagName;
    const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target.isContentEditable;

    if (isMod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      onFocusSearch?.();
      return;
    }

    if (isMod && event.key.toLowerCase() === "b") {
      event.preventDefault();
      onToggleSidebar?.();
      return;
    }

    if (isMod && event.key.toLowerCase() === "r" && !event.shiftKey) {
      event.preventDefault();
      onRefresh?.();
      return;
    }

    if (event.key === "Escape" && isInput) {
      onClearSearch?.();
      event.target.blur();
      return;
    }

    if (isInput) return;

    if (event.key >= "1" && event.key <= "9" && !isMod && !event.shiftKey && !event.altKey) {
      const index = parseInt(event.key, 10) - 1;
      onSelectServerByIndex?.(index);
      return;
    }
  }, [onFocusSearch, onClearSearch, onToggleSidebar, onSelectServerByIndex, onRefresh]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
