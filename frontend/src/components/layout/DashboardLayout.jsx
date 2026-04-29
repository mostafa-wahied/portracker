import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeft, GripVertical } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarDiscoveryNudge } from "./SidebarDiscoveryNudge";

const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 480;
const COLLAPSED_SIDEBAR_WIDTH = 84;
const DEFAULT_SIDEBAR_WIDTH = 360;
const MAX_HIT_TRIGGER = 3;

export function DashboardLayout({
  sidebar,
  collapsedSidebar,
  children,
  isSidebarOpen,
  onCloseSidebar,
  isSidebarCollapsed,
  onToggleSidebarCollapsed,
  sidebarWidth = 360,
  onSidebarWidthChange,
  sidebarShortcutLabel = "Cmd/Ctrl+B",
  searchShortcutLabel = "Cmd/Ctrl+K",
  showSidebarDiscovery = false,
  onDismissSidebarDiscovery,
  onTrySidebarDiscovery,
  onSidebarMaxedOut,
}) {
  const [isResizing, setIsResizing] = useState(false);
  const maxHitCountRef = useRef(0);
  const latestWidthRef = useRef(sidebarWidth);
  const reachedMaxDuringDragRef = useRef(false);

  const clampedSidebarWidth = useMemo(
    () => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, sidebarWidth || 360)),
    [sidebarWidth]
  );

  useEffect(() => {
    latestWidthRef.current = clampedSidebarWidth;
  }, [clampedSidebarWidth]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    reachedMaxDuringDragRef.current = false;

    const handlePointerMove = (event) => {
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, event.clientX)
      );
      if (nextWidth >= MAX_SIDEBAR_WIDTH) {
        reachedMaxDuringDragRef.current = true;
      }
      latestWidthRef.current = nextWidth;
      onSidebarWidthChange?.(nextWidth);
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      if (reachedMaxDuringDragRef.current) {
        maxHitCountRef.current += 1;
        if (maxHitCountRef.current >= MAX_HIT_TRIGGER) {
          maxHitCountRef.current = 0;
          onSidebarMaxedOut?.();
        }
      }
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [isResizing, onSidebarWidthChange, onSidebarMaxedOut]);

  const handleResetWidth = () => {
    onSidebarWidthChange?.(DEFAULT_SIDEBAR_WIDTH);
    maxHitCountRef.current = 0;
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={onCloseSidebar}
          aria-hidden="true"
        ></div>
      )}

      <aside
        style={{
          "--sidebar-width": `${clampedSidebarWidth}px`,
          "--sidebar-rail-width": `${COLLAPSED_SIDEBAR_WIDTH}px`,
        }}
        className={`fixed inset-y-0 left-0 z-40 w-full max-w-sm transform transition-all duration-300 ease-in-out bg-white dark:bg-slate-900 
                   md:relative md:translate-x-0 md:border-r md:border-slate-200 md:dark:border-slate-800
                   ${isSidebarCollapsed ? "md:w-[var(--sidebar-rail-width)] md:min-w-[var(--sidebar-rail-width)] md:max-w-[var(--sidebar-rail-width)]" : "md:w-[var(--sidebar-width)] md:min-w-[var(--sidebar-width)] md:max-w-[var(--sidebar-width)]"}
                   ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`h-full ${isSidebarCollapsed ? "hidden md:hidden" : ""}`}>
          {sidebar}
        </div>
        <div className={`h-full ${isSidebarCollapsed ? "hidden md:flex md:flex-col" : "hidden"}`}>
          {collapsedSidebar}
        </div>
        <SidebarDiscoveryNudge
          isVisible={showSidebarDiscovery && !isSidebarCollapsed}
          sidebarWidth={clampedSidebarWidth}
          shortcutLabel={sidebarShortcutLabel}
          searchShortcutLabel={searchShortcutLabel}
          onTry={onTrySidebarDiscovery}
          onDismiss={onDismissSidebarDiscovery}
        />
        <div className="hidden md:flex absolute inset-y-0 -right-3 w-6 items-start justify-center">
          {!isSidebarCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Resize sidebar"
                  onMouseDown={() => setIsResizing(true)}
                  onDoubleClick={handleResetWidth}
                  className="group absolute inset-y-0 left-[9px] flex w-[6px] cursor-col-resize items-center justify-center"
                >
                  <div
                    className={`absolute inset-y-0 left-[2px] w-[2px] rounded-full transition-colors ${
                      isResizing
                        ? "bg-indigo-500 dark:bg-indigo-400"
                        : "bg-slate-200/80 group-hover:bg-indigo-400 dark:bg-slate-700/80 dark:group-hover:bg-indigo-400"
                    }`}
                  />
                  <div
                    className={`pointer-events-none relative z-10 flex h-5 w-4 items-center justify-center rounded-sm bg-white text-indigo-500 shadow-sm transition-opacity dark:bg-slate-900 ${
                      isResizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Drag to resize • double-click to reset</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleSidebarCollapsed}
                className="hidden md:flex absolute -right-2 top-6 z-50 h-7 w-7 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shadow-sm transition-colors"
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isSidebarCollapsed ? (
                  <PanelLeft className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isSidebarCollapsed
                ? `Expand sidebar • ${sidebarShortcutLabel}`
                : `Collapse sidebar • ${sidebarShortcutLabel}`}
            </TooltipContent>
          </Tooltip>
        </div>
        {isResizing && !isSidebarCollapsed && (
          <div
            className="pointer-events-none fixed top-4 z-[100] rounded-md bg-slate-900/90 px-2 py-1 font-mono text-xs text-white shadow-lg dark:bg-slate-100/95 dark:text-slate-900"
            style={{ left: `${clampedSidebarWidth + 14}px` }}
          >
            {clampedSidebarWidth}px
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
