import React, { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SidebarDiscoveryNudge({
  isVisible,
  sidebarWidth,
  shortcutLabel,
  searchShortcutLabel,
  onTry,
  onDismiss,
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="hidden md:block fixed top-24 z-50 w-80 animate-in fade-in-0 slide-in-from-left-2 duration-300"
      style={{ left: `${sidebarWidth + 24}px` }}
    >
      <div className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-300">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Heads up — sidebar has knobs.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Drag the edge to resize. <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[11px] text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">{shortcutLabel}</kbd> folds it away. <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[11px] text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">{searchShortcutLabel}</kbd> jumps into search.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(dontShowAgain)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                aria-label="Close sidebar tip"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(event) => setDontShowAgain(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
              />
              Stop reminding me
            </label>

            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={onTry} className="h-8 px-3">
                Got it
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDismiss(dontShowAgain)}
                className="h-8 px-2 text-slate-500 dark:text-slate-400"
              >
                Not now
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SidebarDiscoveryNudge;