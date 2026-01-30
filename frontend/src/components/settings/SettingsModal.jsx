import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sun, Moon, Monitor, Eye, EyeOff, ExternalLink, Github } from "lucide-react";

const VERSION = "1.3.0";

export function SettingsModal({
  isOpen,
  onClose,
  theme,
  onThemeChange,
  showIcons,
  onShowIconsChange,
}) {
  const [localTheme, setLocalTheme] = useState(theme);
  const [localShowIcons, setLocalShowIcons] = useState(showIcons);

  useEffect(() => {
    if (isOpen) {
      setLocalTheme(theme);
      setLocalShowIcons(showIcons);
    }
  }, [isOpen, theme, showIcons]);

  const handleThemeSelect = (newTheme) => {
    setLocalTheme(newTheme);
    onThemeChange(newTheme);
  };

  const handleIconsToggle = () => {
    const newValue = !localShowIcons;
    setLocalShowIcons(newValue);
    onShowIconsChange(newValue);
  };

  const themeOptions = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Customize your Portracker experience
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Theme</Label>
            <div className="flex gap-2">
              {themeOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = localTheme === option.value;
                return (
                  <Button
                    key={option.value}
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleThemeSelect(option.value)}
                    className={`flex-1 ${isSelected ? "" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Display</Label>
            <Button
              variant="outline"
              onClick={handleIconsToggle}
              className="w-full justify-start hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {localShowIcons ? (
                <Eye className="h-4 w-4 mr-2" />
              ) : (
                <EyeOff className="h-4 w-4 mr-2" />
              )}
              Service Icons
              <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                {localShowIcons ? "Visible" : "Hidden"}
              </span>
            </Button>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <Label className="text-sm font-medium">About</Label>
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Version</span>
                <span className="font-mono text-slate-900 dark:text-slate-100">{VERSION}</span>
              </div>
              <div className="flex gap-2 pt-2">
                <a
                  href="https://github.com/mostafa-wahied/portracker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                >
                  <Github className="h-4 w-4" />
                  GitHub
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
