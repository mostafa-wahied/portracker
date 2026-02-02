import React, { useState, useEffect, useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { RefreshCw, Loader2, Search, X, Sun, Moon, Menu, SlidersHorizontal, Sparkles, LogOut, User, Timer, Settings, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Logo from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshProgress } from "@/components/ui/RefreshProgress";
import { useLongPress } from "@/lib/hooks/useLongPress";
import { AutoxposeLogoBadge } from "@/components/autoxpose/AutoxposeLogoBadge";

export function AppHeader({
  loading,
  onRefresh,
  searchTerm,
  onSearchChange,
  searchScope,
  onSearchScopeChange,
  searchHighlighting,
  onSearchHighlightingChange,
  filters,
  onFilterChange,
  selectedServer: _selectedServer,
  isDarkMode,
  onThemeToggle,
  onGoHome,
  onToggleSidebar,
  onShowWhatsNew,
  hasNewFeatures = false,
  autoRefreshEnabled = false,
  onAutoRefreshToggle,
  onLogoLongPress,
  hackerMode = false,
  onDisableHackerMode,
  autoRefreshMessages = [],
  onOpenSettings,
  onOpenApiKey,
  refreshInterval = 30000,
  autoxposeStatus = null,
}) {
  const auth = useAuth();
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm);
  const [searching, setSearching] = useState(false);

  const filterButtons = useMemo(
    () => [
      {
        key: "docker",
        label: "Docker",
        isActive: filters.docker,
        activeClass:
          "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
        onClick: () => onFilterChange({ ...filters, docker: !filters.docker }),
        title: filters.docker ? "Disable Docker filter" : "Enable Docker filter",
      },
      {
        key: "system",
        label: "System",
        isActive: filters.system,
        activeClass:
          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
        onClick: () => onFilterChange({ ...filters, system: !filters.system }),
        title: filters.system ? "Disable System filter" : "Enable System filter",
      },
    ],
    [filters, onFilterChange]
  );

  const searchIcon = useMemo(
    () =>
      searching ? (
        <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" />
      ) : (
        <Search className="h-4 w-4 text-gray-400" />
      ),
    [searching]
  );

  const refreshIcon = useMemo(
    () =>
      loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <RefreshCw className="h-5 w-5" />
      ),
    [loading]
  );

  useEffect(() => {
    if (localSearchTerm !== searchTerm) {
      setSearching(true);
      const debounceTimer = setTimeout(() => {
        onSearchChange(localSearchTerm);
        setSearching(false);
      }, 300);

      return () => {
        clearTimeout(debounceTimer);
        setSearching(false);
      };
    }
  }, [localSearchTerm, searchTerm, onSearchChange]);

  useEffect(() => {
    setLocalSearchTerm(searchTerm);
  }, [searchTerm]);

  const getInputPadding = () => {
    const hasClear = !!localSearchTerm;
    if (hasClear) return "pr-12";
    return "pr-10";
  };

  const logoLongPressHandlers = useLongPress(
    () => {
      if (onLogoLongPress) {
        onLogoLongPress();
      }
    },
    { threshold: 800 }
  );

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 relative flex-shrink-0 isolate z-10">
      <div className="min-h-16 px-4 sm:px-6 py-2 flex flex-col md:flex-row items-center justify-between gap-4 relative z-10">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <button
            onClick={onToggleSidebar}
            className="p-2 -ml-2 rounded-md md:hidden text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Open sidebar"
          >
            <Menu className="h-6 w-6" />
          </button>
          <button
            onClick={onGoHome}
            {...logoLongPressHandlers}
            className="flex items-center gap-3 text-xl font-bold text-slate-800 dark:text-slate-200 group cursor-pointer"
          >
            <div className="relative">
              <Logo
                className={`h-10 w-10 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all duration-300 ease-in-out group-hover:rotate-[30deg] ${
                  loading ? "animate-spin" : ""
                }`}
              />
              <AutoxposeLogoBadge connected={autoxposeStatus?.connected} />
            </div>
            <span className="tracking-tighter">portracker</span>
          </button>
        </div>

        <div className="flex items-center flex-wrap justify-center md:justify-end gap-x-4 gap-y-2 w-full md:w-auto">
          <div className="relative w-full md:w-auto">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              {searchIcon}
            </div>
            <Input
              type="text"
              placeholder="Search ports, processes..."
              className={`pl-10 ${getInputPadding()} w-full max-w-[36rem] sm:max-w-[28rem] md:max-w-[32rem] lg:max-w-[40rem] border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent`}
              value={localSearchTerm}
              onChange={(e) => setLocalSearchTerm(e.target.value)}
            />

            <div className="absolute inset-y-0 right-0 flex items-center pr-3 space-x-2">
              {localSearchTerm && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        setLocalSearchTerm("");
                        onSearchChange("");
                      }}
                      className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Clear search</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-gray-100 dark:hover:bg-gray-800"
                    aria-label="Search options"
                  >
                    <SlidersHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Search options</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56" onOpenAutoFocus={e => e.preventDefault()}>
              <TooltipProvider delayDuration={500} skipDelayDuration={0}>
                <div className="px-2 pt-1 pb-2 text-xs text-slate-500">Scope</div>
                <DropdownMenuRadioGroup value={searchScope} onValueChange={onSearchScopeChange}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuRadioItem value="server">Server</DropdownMenuRadioItem>
                    </TooltipTrigger>
                    <TooltipContent>Search only the selected server</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuRadioItem value="all">Global</DropdownMenuRadioItem>
                    </TooltipTrigger>
                    <TooltipContent>Search across all servers</TooltipContent>
                  </Tooltip>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuCheckboxItem
                      checked={!!searchHighlighting}
                      onCheckedChange={(v) => onSearchHighlightingChange(!!v)}
                    >
                      Highlight
                    </DropdownMenuCheckboxItem>
                  </TooltipTrigger>
                  <TooltipContent>Highlight matching text in results</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex space-x-2 relative z-20">
            {filterButtons.map((filter) => (
              <Tooltip key={filter.key}>
                <TooltipTrigger asChild>
                  <button
                    onClick={filter.onClick}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors relative ${
                      filter.isActive
                        ? filter.activeClass
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    {filter.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{filter.title}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          <div className="h-6 border-l border-gray-200 dark:border-gray-700 hidden sm:block"></div>

          

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onRefresh}
                disabled={loading}
                className="hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {refreshIcon}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{loading ? "Refreshing..." : "Refresh all data"}</TooltipContent>
          </Tooltip>

          {onAutoRefreshToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onAutoRefreshToggle}
                  className={`hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    autoRefreshEnabled ? 'text-indigo-600 dark:text-indigo-400' : ''
                  }`}
                >
                  <Timer className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {autoRefreshEnabled 
                  ? `Auto-refresh enabled (${refreshInterval >= 60000 ? `${refreshInterval / 60000}min` : `${refreshInterval / 1000}s`})` 
                  : "Enable auto-refresh"}
              </TooltipContent>
            </Tooltip>
          )}

          <div className="h-6 border-l border-gray-200 dark:border-gray-700 hidden sm:block"></div>

          {onShowWhatsNew && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onShowWhatsNew}
                  className={`relative hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    hasNewFeatures ? 'text-indigo-600 dark:text-indigo-400 animate-pulse' : ''
                  }`}
                >
                  <Sparkles className="h-5 w-5" />
                  {hasNewFeatures && (
                    <span className="absolute " />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {hasNewFeatures ? "See what's new!" : "What's new"}
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onThemeToggle}
                className="hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {isDarkMode ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isDarkMode ? "Switch to light mode" : "Switch to dark mode"}</TooltipContent>
          </Tooltip>

          {hackerMode && onDisableHackerMode && (
            <Button
              variant="outline"
              size="sm"
              className="text-emerald-500 border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10"
              onClick={onDisableHackerMode}
            >
              Exit Hacker Mode
            </Button>
          )}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    <User className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{auth.authEnabled && auth.authenticated ? "Account" : "Menu"}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              {auth.authEnabled && auth.authenticated && (
                <>
                  <div className="px-2 py-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {auth.username}
                  </div>
                  <DropdownMenuSeparator />
                </>
              )}
              {onOpenSettings && (
                <DropdownMenuItem onClick={onOpenSettings}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
              )}
              {auth.authEnabled && auth.authenticated && onOpenApiKey && (
                <DropdownMenuItem onClick={onOpenApiKey}>
                  <Key className="mr-2 h-4 w-4" />
                  API Key
                </DropdownMenuItem>
              )}
              {auth.authEnabled && auth.authenticated && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={auth.logout} className="text-red-600 dark:text-red-400">
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <RefreshProgress
        active={autoRefreshEnabled && !loading}
        duration={refreshInterval}
        messages={autoRefreshMessages || []}
      />
    </header>
  );
}
