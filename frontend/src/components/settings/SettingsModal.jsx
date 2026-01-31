import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Sun,
  Moon,
  Monitor,
  Eye,
  EyeOff,
  Github,
  ChevronDown,
  ChevronUp,
  Info,
  FileText,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const VERSION = "1.3.0";

const REFRESH_INTERVALS = [
  { value: 15000, label: "15s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "1m" },
  { value: 120000, label: "2m" },
];

export function SettingsModal({
  isOpen,
  onClose,
  theme,
  onThemeChange,
  showIcons,
  onShowIconsChange,
  refreshInterval,
  onRefreshIntervalChange,
  includeUdp,
  onIncludeUdpChange,
  disableCache,
  onDisableCacheChange,
}) {
  const [localTheme, setLocalTheme] = useState(theme);
  const [localShowIcons, setLocalShowIcons] = useState(showIcons);
  const [localRefreshInterval, setLocalRefreshInterval] = useState(refreshInterval || 30000);
  const [localIncludeUdp, setLocalIncludeUdp] = useState(includeUdp || false);
  const [localDisableCache, setLocalDisableCache] = useState(disableCache || false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalTheme(theme);
      setLocalShowIcons(showIcons);
      setLocalRefreshInterval(refreshInterval || 30000);
      setLocalIncludeUdp(includeUdp || false);
      setLocalDisableCache(disableCache || false);
    }
  }, [isOpen, theme, showIcons, refreshInterval, includeUdp, disableCache]);

  const handleThemeSelect = (newTheme) => {
    setLocalTheme(newTheme);
    onThemeChange(newTheme);
  };

  const handleIconsToggle = () => {
    const newValue = !localShowIcons;
    setLocalShowIcons(newValue);
    onShowIconsChange(newValue);
  };

  const handleRefreshIntervalChange = (value) => {
    setLocalRefreshInterval(value);
    if (onRefreshIntervalChange) {
      onRefreshIntervalChange(value);
    }
  };

  const handleUdpToggle = () => {
    const newValue = !localIncludeUdp;
    setLocalIncludeUdp(newValue);
    if (onIncludeUdpChange) {
      onIncludeUdpChange(newValue);
    }
  };

  const handleCacheToggle = () => {
    const newValue = !localDisableCache;
    setLocalDisableCache(newValue);
    if (onDisableCacheChange) {
      onDisableCacheChange(newValue);
    }
  };

  const themeOptions = [
    { value: "system", icon: Monitor },
    { value: "light", icon: Sun },
    { value: "dark", icon: Moon },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Theme</span>
              <div className="flex gap-1">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isSelected = localTheme === option.value;
                  return (
                    <Tooltip key={option.value}>
                      <TooltipTrigger asChild>
                        <Button
                          variant={isSelected ? "default" : "ghost"}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleThemeSelect(option.value)}
                        >
                          <Icon className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="capitalize">
                        {option.value}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {localShowIcons ? (
                  <Eye className="h-4 w-4 text-slate-400" />
                ) : (
                  <EyeOff className="h-4 w-4 text-slate-400" />
                )}
                <span className="text-sm">Service Icons</span>
              </div>
              <Switch
                checked={localShowIcons}
                onCheckedChange={handleIconsToggle}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">Auto-Refresh</span>
              <div className="flex gap-1">
                {REFRESH_INTERVALS.map((option) => {
                  const isSelected = localRefreshInterval === option.value;
                  return (
                    <Button
                      key={option.value}
                      variant={isSelected ? "default" : "ghost"}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleRefreshIntervalChange(option.value)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
              <span>Advanced Options</span>
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Include UDP</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-slate-400 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px]">
                        Show UDP ports like DNS, DHCP, NTP
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    checked={localIncludeUdp}
                    onCheckedChange={handleUdpToggle}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Disable Cache</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-slate-400 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px]">
                        Force fresh data (slower)
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    checked={localDisableCache}
                    onCheckedChange={handleCacheToggle}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row justify-between items-center sm:justify-between border-t border-slate-200 dark:border-slate-800 pt-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">v{VERSION}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://github.com/mostafa-wahied/portracker/blob/main/CHANGELOG.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                >
                  <FileText className="h-4 w-4" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="top">Changelog</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://github.com/mostafa-wahied/portracker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                >
                  <Github className="h-4 w-4" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="top">GitHub</TooltipContent>
            </Tooltip>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
