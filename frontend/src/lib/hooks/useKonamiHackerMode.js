import { useState, useEffect, useCallback, useRef } from "react";

const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

const KONAMI_HINTS = ["↑", "Course input detected…", "gg, keyboard pilot."];
const HACKER_MODE_KEY = "portracker_hacker_mode";

export function useKonamiHackerMode({ pushHealthToast }) {
  const [hackerMode, setHackerMode] = useState(() => {
    try {
      return localStorage.getItem(HACKER_MODE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [konamiHint, setKonamiHint] = useState(null);
  const progressRef = useRef(0);
  const hintStageRef = useRef(0);
  const hintTimeoutRef = useRef(null);

  const showHint = useCallback((stage) => {
    const index = Math.min(stage, KONAMI_HINTS.length - 1);
    setKonamiHint(KONAMI_HINTS[index]);
    if (hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current);
    }
    hintTimeoutRef.current = setTimeout(() => setKonamiHint(null), 1200);
  }, []);

  useEffect(() => () => {
    if (hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current);
    }
  }, []);

  const toggle = useCallback(() => {
    setHackerMode((prev) => {
      const next = !prev;
      pushHealthToast({
        type: "info",
        message: next
          ? "Hacker mode activated. Use Ctrl+Shift+H to toggle."
          : "Hacker mode disabled.",
      });
      return next;
    });
    hintStageRef.current = 0;
    progressRef.current = 0;
  }, [pushHealthToast]);

  const disable = useCallback(() => {
    setHackerMode((prev) => {
      if (!prev) return prev;
      pushHealthToast({ type: "info", message: "Hacker mode disabled." });
      return false;
    });
    hintStageRef.current = 0;
    progressRef.current = 0;
  }, [pushHealthToast]);

  useEffect(() => {
    try {
      localStorage.setItem(HACKER_MODE_KEY, hackerMode ? "true" : "false");
    } catch {
      void 0;
    }
    if (typeof document !== "undefined") {
      document.body.classList.toggle("hacker-mode", hackerMode);
    }
  }, [hackerMode]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        toggle();
        return;
      }
      if (event.key === "ArrowUp" && progressRef.current === 0) {
        const stage = hintStageRef.current;
        if (stage < KONAMI_HINTS.length) {
          showHint(stage);
          hintStageRef.current = stage + 1;
        }
      }
      const normalized = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const expected = KONAMI_SEQUENCE[progressRef.current];
      if (normalized === expected) {
        progressRef.current += 1;
        if (progressRef.current === KONAMI_SEQUENCE.length) {
          progressRef.current = 0;
          toggle();
        }
        return;
      }
      progressRef.current = normalized === KONAMI_SEQUENCE[0] ? 1 : 0;
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showHint, toggle]);

  return { hackerMode, konamiHint, toggleHackerMode: toggle, disableHackerMode: disable };
}
