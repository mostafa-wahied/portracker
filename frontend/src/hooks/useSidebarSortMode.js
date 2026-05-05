import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "portracker.sidebarSortMode.v1";
const VALID_MODES = new Set(["custom", "asc", "desc"]);
const UNDO_VISIBLE_MS = 5000;
const UNDO_FADE_MS = 200;

function readStoredMode() {
  if (typeof window === "undefined") return "custom";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID_MODES.has(v) ? v : "custom";
  } catch {
    return "custom";
  }
}

function persistMode(mode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    return;
  }
}

export function useSidebarSortMode() {
  const [sortMode, setSortModeState] = useState(readStoredMode);
  const [undoState, setUndoState] = useState({
    visible: false,
    closing: false,
    previousMode: "custom",
  });
  const fadeTimerRef = useRef(null);
  const hideTimerRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const setSortMode = useCallback(
    (next) => {
      if (!VALID_MODES.has(next) || next === sortMode) return;
      const previous = sortMode;
      setSortModeState(next);
      persistMode(next);
      clearTimers();
      if (next !== "custom") {
        setUndoState({ visible: true, closing: false, previousMode: previous });
        fadeTimerRef.current = setTimeout(() => {
          setUndoState((s) => ({ ...s, closing: true }));
          fadeTimerRef.current = null;
        }, UNDO_VISIBLE_MS);
        hideTimerRef.current = setTimeout(() => {
          setUndoState((s) => ({ ...s, visible: false, closing: false }));
          hideTimerRef.current = null;
        }, UNDO_VISIBLE_MS + UNDO_FADE_MS);
      } else {
        setUndoState({ visible: false, closing: false, previousMode: "custom" });
      }
    },
    [sortMode, clearTimers]
  );

  const undoToPrevious = useCallback(() => {
    clearTimers();
    setSortModeState(undoState.previousMode);
    persistMode(undoState.previousMode);
    setUndoState({ visible: false, closing: false, previousMode: "custom" });
  }, [undoState.previousMode, clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { sortMode, setSortMode, undoState, undoToPrevious };
}
