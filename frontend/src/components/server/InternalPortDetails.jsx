import React, { useEffect, useRef, useState, useCallback, startTransition } from "react";
import { createPortal } from 'react-dom';
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
  DrawerOverlay,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Copy, ChevronDown, ChevronUp, Check, Box, Activity, Globe2, Network, Terminal, Settings2, Tag, HardDrive, Info, Gauge, Cpu, FileJson, Download, RefreshCw } from "lucide-react";
import StatsSkeleton from './parts/StatsSkeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from '@/lib/i18n';
import { InfoTile } from './parts/InfoTile';
import { DetailsPanel } from './parts/DetailsPanel';
import { useClipboard } from '@/lib/hooks/useClipboard';
import { formatBytes, formatDuration } from '@/lib/utils';
import { RESTART_POLICY_STYLES, isEphemeralContainer } from '@/lib/constants';

export function InternalPortDetails({ open, onOpenChange, containerId, serverId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [shell, setShell] = useState("/bin/sh");
  const { copiedKey, copy } = useClipboard();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [, forceTick] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const cmdRef = useRef(null);
  const drawerRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const [labelFilter, setLabelFilter] = useState("");
  const liveRegionRef = useRef(null);
  const announceRef = useRef(null);
  const [rawState, setRawState] = useState({ loading: false, error: null, data: null });
  const statsAbortRef = useRef(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(null);
  const [statsAttempted, setStatsAttempted] = useState(false);
  const [statsUnavailableReason, setStatsUnavailableReason] = useState(null);
  const [contentMounted] = useState(true);

  const guessShell = (image) => {
    const img = (image || "").toLowerCase();
    if (img.includes("alpine")) return "/bin/ash";
    if (
      img.includes("ubuntu") ||
      img.includes("debian") ||
      img.includes("fedora") ||
      img.includes("centos") ||
      img.includes("rocky") ||
      img.includes("rhel")
    )
      return "/bin/bash";
    return "/bin/sh";
  };

  
  useEffect(() => {
    if (!open || !containerId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const qs = serverId ? `?server_id=${encodeURIComponent(serverId)}` : "";
    fetch(`/api/containers/${encodeURIComponent(containerId)}/details${qs}`, { signal: controller.signal, priority: 'high' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((json) => {
        startTransition(() => {
          setData(json);
          try { setShell((prev) => prev || guessShell(json.image)); } catch { setShell('/bin/sh'); }
        });
      })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    drawerRef.current && (drawerRef.current._detailsAbort = controller);
    return () => { controller.abort(); };
  }, [open, containerId, serverId]);

  const execTarget = data?.name || data?.id || containerId;
  const execCmd = `docker exec -it ${execTarget} ${shell}`;

  const handleCopyGeneric = useCallback(async (key, text) => { 
    await copy(key, text); 
  }, [copy]);

  const loadRaw = () => {
    if (rawState.loading || rawState.data) return;
    setRawState(prev => ({ ...prev, loading: true, error: null }));
    const qsParts = [];
    if (serverId) qsParts.push(`server_id=${encodeURIComponent(serverId)}`);
    qsParts.push('raw=true');
    const qs = qsParts.length ? `?${qsParts.join('&')}` : '';
    fetch(`/api/containers/${encodeURIComponent(containerId)}/details${qs}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => setRawState({ loading: false, error: null, data: json.raw || json }))
      .catch(e => setRawState({ loading: false, error: e.message, data: null }));
  };

  

  useEffect(() => {
    if (open) {
      document.body.style.overflowY = 'hidden';
      setIsVisible(true);
      previouslyFocusedRef.current = document.activeElement;
      announceRef.current && (announceRef.current.textContent = t('Container details panel opened'));
      queueMicrotask(() => drawerRef.current?.querySelector('[data-autofocus]')?.focus());
    } else if (!open && previouslyFocusedRef.current) {
  setTimeout(() => {
        setIsVisible(false);
        document.body.style.overflowY = '';
  try { previouslyFocusedRef.current.focus(); } catch { void 0; }
        announceRef.current && (announceRef.current.textContent = t('Container details panel closed'));
      }, 250);
    }
  }, [open]);

  const refreshStats = useCallback((initial=false) => {
    if (!open || !containerId) return;
    
    if (statsAbortRef.current) statsAbortRef.current.abort();
    const controller = new AbortController();
    statsAbortRef.current = controller;
    setStatsLoading(true);
    setStatsError(null);
    if (!initial) setStatsAttempted(true);
    const qsParts = [];
    if (serverId) qsParts.push(`server_id=${encodeURIComponent(serverId)}`);
    qsParts.push('stats=true');
    const qs = `?${qsParts.join('&')}`;
    fetch(`/api/containers/${encodeURIComponent(containerId)}/details${qs}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => {
        setData(prev => {
          if (!prev) return prev;
          if (j.stats) {
            if (liveRegionRef.current) liveRegionRef.current.textContent = t('Stats updated');
            return { ...prev, stats: j.stats, statsSampledAt: j.statsSampledAt };
          }
          return prev;
        });
    setStatsUnavailableReason(j.statsUnavailableReason || (!j.stats ? 'unknown' : null));
      })
      .catch(e => { if (e.name !== 'AbortError') setStatsError(e.message || 'Failed to load stats'); })
      .finally(() => setStatsLoading(false));
  }, [open, containerId, serverId]);

  useEffect(() => {
    if (open && containerId && data && !data.stats && !statsAttempted && !statsLoading && !statsError) {
      refreshStats(true);
    }
  }, [open, containerId, data, statsAttempted, statsLoading, statsError, refreshStats]);

  
  useEffect(() => {
    if (!open) return;
    let intervalId = setInterval(() => {
      if (!document.hidden) startTransition(() => forceTick(t => t + 1));
    }, 1000);
    drawerRef.current && (drawerRef.current._tickInterval = intervalId);
    return () => { clearInterval(intervalId); };
  }, [open]);

  useEffect(() => {
    if (copiedKey && liveRegionRef.current) {
      liveRegionRef.current.textContent = `Copied ${copiedKey}`;
    }
  }, [copiedKey]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    } else if (e.key === 'Tab' && drawerRef.current) {
      const focusable = drawerRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const list = Array.from(focusable).filter(el => !el.hasAttribute('disabled'));
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
      if (document.activeElement === cmdRef.current) {
        handleCopyGeneric('exec', cmdRef.current.textContent || '');
      }
    }
  }, [onOpenChange, handleCopyGeneric]);

  if (!isVisible) return null;

  return createPortal(
    <>
      <DrawerOverlay
        onClick={() => onOpenChange(false)}
        data-state={open ? "open" : "closed"}
      />
      <DrawerContent
        role="dialog"
        aria-modal="true"
        aria-labelledby="container-details-title"
        onKeyDown={handleKeyDown}
        ref={drawerRef}
        data-state={open ? "open" : "closed"}
        className="flex flex-col h-full outline-none sm:max-w-lg md:max-w-xl lg:max-w-2xl w-full"
      >
        <DrawerClose onClick={() => onOpenChange(false)} data-autofocus />
  <DrawerHeader className="pb-3 pr-10 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Box className="w-5 h-5 text-slate-500" />
            <DrawerTitle id="container-details-title" className="text-base font-semibold tracking-wide">{t('Container Details')}</DrawerTitle>
            <div className="ml-auto flex items-center gap-2" />
          </div>
          <DrawerDescription className="text-slate-500 dark:text-slate-400">
            {t('Inspect runtime, networking, and metadata.')}
          </DrawerDescription>
        </DrawerHeader>

  <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-8 py-4" aria-describedby="container-details-help">
          {!contentMounted && (
            <div className="animate-pulse text-xs text-slate-500 px-1">{t('Preparing details...')}</div>
          )}
          {contentMounted && (
            <>
              <div ref={liveRegionRef} aria-live="polite" className="sr-only" />
              <div ref={announceRef} aria-live="polite" className="sr-only" />
              <p id="container-details-help" className="sr-only">Use Tab to move, Escape to close. Copy buttons announce success. Sections are collapsible.</p>
            </>
          )}
          
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 px-1">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"></div>
              {t('Loading container details...')}
            </div>
          )}
          
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 px-1">
              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}
          
          {contentMounted && data && (
            <div className="space-y-8 px-1">
              <section className="space-y-6">
                    <div role="group" aria-labelledby="identity-section-heading">
                      <h4 id="identity-section-heading" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1"><Box className="w-4 h-4" /> {t('Identity')}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <InfoTile label={t('Name')} value={data.name} copyKey="name" isCopied={copiedKey==='name'} onCopy={(v)=>handleCopyGeneric('name',v)} />
                        <InfoTile label={t('ID')} value={data.id} displayValue={data.id?.slice(0,12)} copyKey="id" isCopied={copiedKey==='id'} onCopy={(v)=>handleCopyGeneric('id',v)} tooltip={data.id} />
                        <InfoTile label={t('Image')} value={data.image} copyKey="image" isCopied={copiedKey==='image'} mono onCopy={(v)=>handleCopyGeneric('image',v)} />
                        {data.imageDigest && (<InfoTile label={t('Digest')} value={data.imageDigest} displayValue={data.imageDigest} copyKey="digest" isCopied={copiedKey==='digest'} mono onCopy={(v)=>handleCopyGeneric('digest',v)} />)}
                      </div>
                    </div>
                    <div role="group" aria-labelledby="runtime-section-heading">
                      <h4 id="runtime-section-heading" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1"><Activity className="w-4 h-4" /> {t('Runtime')}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-medium mb-1">
                            <Activity className="w-4 h-4" /> {t('State')}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap text-sm">
                            <span className={`w-2 h-2 rounded-full ${data.state === 'running' ? 'bg-green-500' : data.state === 'exited' ? 'bg-red-500' : 'bg-slate-400'}`}></span>
                            <span className="font-medium capitalize">{data.state || t('unknown')}</span>
                            {data.health && data.health !== 'none' ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium">
                                {data.health}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 text-[10px] font-medium">
                                {t('no healthcheck')}
                              </span>
                            )}
                          </div>
                        </div>
                        {data.uptimeSeconds != null && (
                          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-1 text-xs">
                            <div className="font-medium flex items-center gap-1 text-slate-600 dark:text-slate-300"><ClockIcon /> {t('Uptime')}</div>
                            <div className="font-mono text-[11px]">{formatDuration(data.uptimeSeconds)}</div>
                          </div>
                        )}
                        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-2 text-xs">
                          <div className="flex items-center justify-between">
                            <div className="font-medium flex items-center gap-1 text-slate-600 dark:text-slate-300"><Settings2 className="w-3.5 h-3.5" /> {t('Restart Policy')}</div>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-3.5 h-3.5 text-slate-400" />
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs text-xs leading-relaxed">
                                  {t('Value reflects the container\'s configured Docker restart policy. "none" means no policy set. on-failure includes an optional max retry count. unless-stopped and always continue regardless of manual restarts.')}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {(() => { const policy = data.restartPolicy || 'none'; const cls = RESTART_POLICY_STYLES[policy] || RESTART_POLICY_STYLES.none; return (<span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide uppercase ${cls}`}>{policy}</span>); })()}
                            {isEphemeralContainer(data) && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300 text-[10px] font-medium">
                                <Gauge className="w-3 h-3" /> {t('ephemeral')}
                              </span>
                            )}
                            {data.restartPolicy === 'on-failure' && data.restartRetries != null && (
                              <span className="text-[10px] text-slate-500">{t('max {n} retries', { n: data.restartRetries })}</span>
                            )}
                            {data.restartPolicy === 'none' && data.restartPolicyRaw && data.restartPolicyRaw !== '' && (
                              <span className="text-[10px] text-slate-500">{t('raw: {val}', { val: data.restartPolicyRaw })}</span>
                            )}
                            {data.restartPolicy === 'none' && (!data.restartPolicyRaw || data.restartPolicyRaw === '') && (
                              <span className="text-[10px] text-slate-400">({t('no restart policy configured')})</span>
                            )}
                          </div>
                        </div>
                        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-1 text-xs">
                          <div className="font-medium flex items-center gap-1 text-slate-600 dark:text-slate-300"><Activity className="w-3.5 h-3.5" /> {t('Restart Count')}</div>
                          <div className="flex items-center gap-2">
                            <span className={`font-mono text-[11px] ${data.restartCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>{data.restartCount ?? 0}</span>
                            {data.restartCount > 0 && (
                              <span className="inline-flex px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-[10px] font-medium">{t('restarted')}</span>
                            )}
                          </div>
                        </div>
                        {(data.sizeRwBytes != null || data.sizeRootFsBytes != null) && (
                          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-1 text-xs">
                            <div className="font-medium flex items-center gap-1 text-slate-600 dark:text-slate-300"><HardDrive className="w-3.5 h-3.5" /> Size</div>
                            <div className="flex flex-col font-mono text-[11px] gap-0.5">
                              {data.sizeRwBytes != null && <span>RW: {formatBytes(data.sizeRwBytes)}</span>}
                              {data.sizeRootFsBytes != null && <span>RootFS: {formatBytes(data.sizeRootFsBytes)}</span>}
                            </div>
                          </div>
                        )}
                        {data.stats && (
                          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-1 text-xs relative sm:col-span-2">
                            <div className="flex items-center justify-between">
                              <div className="font-medium flex items-center gap-1 text-slate-600 dark:text-slate-300"><Cpu className="w-3.5 h-3.5" /> Stats</div>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => refreshStats(false)}
                                      disabled={statsLoading}
                                      aria-label={t('Refresh stats')}
                                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors disabled:opacity-50"
                                    >
                                      <RefreshCw className={`w-4 h-4 ${statsLoading ? 'animate-spin' : ''}`} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="text-[10px]">
                                    {statsLoading ? t('Refreshing…') : (() => {
                                      if (statsError) return statsError;
                                      const ts = data?.statsSampledAt || null;
                                      if (!ts) return t('No stats yet');
                                      const sampled = Date.parse(ts);
                                      if (Number.isNaN(sampled)) return t('Last updated: unknown');
                                      const diffSec = Math.max(0, Math.floor((Date.now() - sampled) / 1000));
                                      if (diffSec < 60) return t('Updated {sec}s ago', { sec: diffSec });
                                      const mins = Math.floor(diffSec / 60);
                                      const secs = diffSec % 60;
                                      return t('Updated {mins}m {secs}s ago', { mins, secs });
                                    })()}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                            <div className="grid grid-cols-2 gap-2 font-mono text-[11px] min-h-[28px]">
                              {data.stats ? (
                                <>
                                  {data.stats.cpuPercent != null && <span>CPU: {data.stats.cpuPercent.toFixed(1)}%</span>}
                                  {data.stats.memUsagePercent != null && <span>Mem: {data.stats.memUsagePercent.toFixed(1)}%</span>}
                                  {data.stats.memBytes != null && <span>MemUse: {formatBytes(data.stats.memBytes)}</span>}
                                  {data.stats.memLimitBytes != null && <span>MemLim: {formatBytes(data.stats.memLimitBytes)}</span>}
                                </>
                              ) : (
                                <StatsSkeleton />
                              )}
                            </div>
                            {data.statsSampledAt && (
                              <div className="text-[10px] text-slate-500">{(() => {
                                const sampled = Date.parse(data.statsSampledAt);
                                if (Number.isNaN(sampled)) return null;
                                const diffSec = Math.max(0, Math.floor((Date.now() - sampled) / 1000));
                                if (diffSec < 60) return t('Updated {sec}s ago', { sec: diffSec });
                                const mins = Math.floor(diffSec / 60);
                                const secs = diffSec % 60;
                                return t('Updated {mins}m {secs}s ago', { mins, secs });
                              })()}</div>
                            )}
                            {statsError && <div className="text-[10px] text-red-600">{statsError}</div>}
                          </div>
                        )}
                        {!data.stats && !statsLoading && !statsError && !statsAttempted && (
                          <div className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/20 text-xs text-slate-500 sm:col-span-2">
                            <div className="mb-2 font-medium text-[10px] uppercase tracking-wide text-slate-500">Stats</div>
                            <StatsSkeleton />
                            <div className="mt-2 text-[10px] text-slate-500">{t('Use the refresh icon to load live container usage.')}</div>
                          </div>
                        )}
                        {!data.stats && !statsLoading && !statsError && statsAttempted && statsUnavailableReason && (
                          <div className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-amber-50 dark:bg-amber-900/10 text-xs text-amber-700 dark:text-amber-300 flex flex-col gap-2 sm:col-span-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{t('Stats unavailable')}</span>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={statsLoading}
                                className="h-6 px-2 text-[11px]"
                                onClick={refreshStats}
                                aria-label={t('Retry fetching stats')}
                              >
                                {statsLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {t('Retry')}
                              </Button>
                            </div>
                            <span className="text-[11px] leading-snug text-amber-700/90 dark:text-amber-300/80">
                              {(() => {
                                if (statsUnavailableReason) {
                                  if (statsUnavailableReason.startsWith('container_not_running:')) {
                                    const s = statsUnavailableReason.split(':')[1];
                                    return t('Container state is "{state}". Docker only reports live usage for running containers.', { state: s });
                                  }
                                  if (statsUnavailableReason.startsWith('stats_error:')) {
                                    return t('Docker API error while retrieving stats (recorded). Try again or check daemon logs.');
                                  }
                                  if (statsUnavailableReason === 'docker_returned_null') {
                                    return t('Docker returned no metrics. Platform/engine may not expose stats for this container.');
                                  }
                                }
                                if (data.uptimeSeconds != null && data.uptimeSeconds < 5) return t('Container just started; metrics may not be ready yet.');
                                return t('Metrics unavailable.');
                              })()}
                              {statsUnavailableReason && statsUnavailableReason.startsWith('stats_error:') && (
                                <span className="block mt-1 opacity-70">{t('Reason code: {code}', { code: statsUnavailableReason })}</span>
                              )}
                            </span>
                          </div>
                        )}
                        {!data.stats && statsLoading && (
                          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 text-xs text-slate-500 flex items-center gap-4 sm:col-span-2">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <div className="flex-1"><StatsSkeleton /></div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div role="group" aria-labelledby="network-section-heading">
                      <h4 id="network-section-heading" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1"><Globe2 className="w-4 h-4" /> Network</h4>
                      <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 flex items-center gap-3 text-sm flex-wrap">
                        <span className="font-medium">{data.networkMode}</span>
                        {data.networks?.length ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[10px] font-medium">{data.networks.length} net</span>
                        ) : null}
                      </div>
                    </div>
                  </section>

                  
          <section aria-labelledby="ports-section-heading">
                    <div className="flex items-center justify-between mb-2">
            <h4 id="ports-section-heading" className="flex items-center gap-1.5 text-sm font-semibold"><Network className="w-4 h-4 text-slate-500" /> {t('Ports')}</h4>
                      <span className="text-xs text-slate-500">{data.ports.length} {data.ports.length === 1 ? t('mapping') : t('mappings')}</span>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 max-h-56 overflow-y-auto">
                      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                        {data.ports.map((p, idx) => (
                          <li key={idx} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                            <div className="font-mono break-all flex-1">
                              {p.internal ? (
                                <span className="inline-flex items-center gap-2 flex-wrap">
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-[10px] font-medium">{t('internal')}</span>
                                  <span className="text-slate-500">→</span>
                                  <span>{p.container_port}/{p.protocol}</span>
                                </span>
                              ) : (
                                <span>
                                  {p.host_ip}:{p.host_port} <span className="text-slate-500">→</span> {p.container_port}/{p.protocol}
                                </span>
                              )}
                            </div>
                            {!p.internal && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-medium">{t('host')}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </section>

                  

                  
                  <section className="border-t border-slate-200 dark:border-slate-800 pt-4">
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex items-center justify-between w-full text-left p-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      aria-expanded={showAdvanced}
                      aria-controls="advanced-details-region"
                    >
                      <div className="flex items-center gap-2">
                        <Settings2 className="w-4 h-4 text-slate-500" />
                        <h4 className="text-sm font-semibold">{t('More Details')}</h4>
                        <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{t('Optional')}</span>
                      </div>
                      {showAdvanced ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </button>
                    {showAdvanced && (
                      <div id="advanced-details-region" className="mt-3 space-y-5 pl-1" role="region" aria-label={t('Additional container details')}>
                        
                        <DetailsPanel title={t('Access')} icon={<Terminal className="w-4 h-4" />}>
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">{t('Shell')}</span>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button type="button" variant="outline" size="sm" className="h-7 px-2">
                                    {shell}
                                    <ChevronDown className="w-3.5 h-3.5 ml-1" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-28">
                                  {["/bin/ash", "/bin/bash", "/bin/dash", "/bin/sh"].map((s) => (
                                    <DropdownMenuItem key={s} onSelect={() => setShell(s)}>{s}</DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            <div className="flex items-center gap-2">
                              <pre ref={cmdRef} className="flex-1 text-xs bg-slate-950/95 dark:bg-slate-950 text-slate-100 rounded-md p-3 overflow-x-auto border border-slate-800 break-all">{execCmd}</pre>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button type="button" variant="outline" size="icon" aria-label={copiedKey==='exec' ? t('Copied') : t('Copy command')} onClick={() => handleCopyGeneric('exec', execCmd)} className="shrink-0">
                                      {copiedKey==='exec' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{copiedKey==='exec' ? t('Copied') : t('Copy')}</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </div>
                        </DetailsPanel>
                        
                        {data.createdISO && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 space-y-1 text-xs">
                              <div className="font-medium flex items-center gap-1 text-slate-600 dark:text-slate-300"><ClockIcon /> Created</div>
                              <div className="font-mono text-[11px]">{new Date(data.createdISO).toLocaleString()}</div>
                            </div>
                          </div>
                        )}
                        
                        <div className="space-y-4">
                          {data.networks && data.networks.length > 0 && (
                            <DetailsPanel title={`${t('Networks')} (${data.networks.length})`} icon={<Globe2 className="w-4 h-4" />}>
                              <div className="grid gap-2 max-h-48 overflow-y-auto pr-1">
                                {data.networks.map((network, idx) => (
                                  <div key={idx} className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="font-medium text-xs">{network.name}</span>
                                      <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[10px] font-medium">net</span>
                                    </div>
                                    <div className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                                      {network.ip && <div>IP: {network.ip}</div>}
                                      {network.gateway && <div>Gateway: {network.gateway}</div>}
                                      {network.mac && <div>MAC: {network.mac}</div>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </DetailsPanel>
                          )}
                          {data.labels && Object.keys(data.labels).length > 0 && (
                            <DetailsPanel title={`${t('Labels')} (${Object.keys(data.labels).length})`} icon={<Tag className="w-4 h-4" />}>
                              {(() => {
                                const allEntries = Object.entries(data.labels);
                                const entries = labelFilter ? allEntries.filter(([k,v]) => k.toLowerCase().includes(labelFilter.toLowerCase()) || (v||'').toLowerCase().includes(labelFilter.toLowerCase())) : allEntries;
                                const scroll = entries.length > 14;
                                return (
                                  <div className="space-y-2">
                                    {allEntries.length > 10 && (
                                      <input
                                        type="text"
                                        placeholder={t('Filter labels…')}
                                        value={labelFilter}
                                        onChange={(e)=>setLabelFilter(e.target.value)}
                                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                      />
                                    )}
                                    <div className={`grid gap-1 pr-1 ${scroll ? 'max-h-40 overflow-y-auto overscroll-contain' : ''}`}>
                                      {entries.map(([key, value]) => {
                                        const isUrl = typeof value === 'string' && /^https?:\/\//i.test(value);
                                        const copyId = `label:${key}`;
                                        const copied = copiedKey === copyId;
                                        return (
                                          <div key={key} className="p-2 rounded border relative border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                                            <div className="font-mono text-[11px] break-all leading-relaxed pr-6">
                                              <span className="font-semibold text-slate-800 dark:text-slate-100 mr-1 after:content-[':'] after:ml-0.5 px-1 rounded bg-slate-200/60 dark:bg-slate-800/60">
                                                {key}
                                              </span>
                                              {value ? (
                                                isUrl ? (
                                                  <a
                                                    href={value}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="underline text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 break-all"
                                                  >
                                                    {value}
                                                  </a>
                                                ) : (
                                                  <span className="text-slate-700 dark:text-slate-300">{value}</span>
                                                )
                                              ) : (
                                                <span className='italic opacity-60'>(empty)</span>
                                              )}
                                            </div>
                                            <button
                                              type="button"
                                              onClick={()=>handleCopyGeneric(copyId, value || '')}
                                              aria-label={copied ? t('Copied') : t('Copy')}
                                              className={`absolute top-1.5 right-1.5 p-1 rounded transition-colors ${copied ? 'bg-green-100 dark:bg-green-900/30' : 'hover:bg-slate-200 dark:hover:bg-slate-700/40'}`}
                                            >
                                              {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                                            </button>
                                          </div>
                                        );
                                      })}
                                      {entries.length === 0 && (
                                        <div className="text-[11px] italic text-slate-500 dark:text-slate-400">No labels match filter.</div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </DetailsPanel>
                          )}
                          {data.mounts && data.mounts.length > 0 && (
                            <DetailsPanel title={`Mounts (${data.mounts.length})`} icon={<HardDrive className="w-4 h-4" />}>
                              {(() => {
                                const scroll = data.mounts.length > 10;
                                return (
                                  <div className={`grid gap-1 pr-1 ${scroll ? 'max-h-40 overflow-y-auto overscroll-contain' : ''}`}>
                                    {data.mounts.map((mount, idx) => {
                                      const type = (mount.type || '').toLowerCase();
                                      const chipClasses = {
                                        bind: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
                                        volume: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                                        tmpfs: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
                                        npipe: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
                                        overlay: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300',
                                      }[type] || 'bg-slate-200 dark:bg-slate-700/40 text-slate-800 dark:text-slate-200';
                                      return (
                                        <div key={idx} className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 flex flex-col gap-1">
                                          <div className="flex items-center gap-2 text-[10px]">
                                            <span className={`inline-flex px-1.5 py-0.5 rounded-full font-medium tracking-wide uppercase ${chipClasses}`}>{mount.type || 'UNKNOWN'}</span>
                                            <span className="font-mono text-[10px] text-slate-500">{idx + 1}</span>
                                          </div>
                                          <div className="font-mono text-[11px] break-all">
                                            {mount.source}
                                            <span className="text-slate-500 mx-1">→</span>
                                            {mount.destination}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </DetailsPanel>
                          )}
                          <DetailsPanel title={t('JSON (raw inspect)')} icon={<FileJson className="w-4 h-4" />} defaultOpen={false}>
                            <div className="space-y-2">
                              {!rawState.data && !rawState.loading && !rawState.error && (
                                <Button type="button" variant="outline" size="sm" onClick={loadRaw} className="h-7 px-2 inline-flex items-center gap-1">
                                  <FileJson className="w-3.5 h-3.5" /> {t('Load Raw')}
                                </Button>
                              )}
                              {rawState.loading && <div className="text-xs text-slate-500">{t('Loading raw inspect…')}</div>}
                              {rawState.error && <div className="text-xs text-red-600">{rawState.error}</div>}
                              {rawState.data && (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2"
                                      onClick={() => handleCopyGeneric('raw', JSON.stringify(rawState.data))}
                                      aria-label={copiedKey==='raw' ? t('Copied') : t('Copy raw JSON')}
                                    >
                                      {copiedKey==='raw' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />} Copy JSON
                                    </Button>
                                    <a
                                      href={`/api/containers/${encodeURIComponent(containerId)}/details?${['export=true','raw=true', serverId ? `server_id=${encodeURIComponent(serverId)}` : null].filter(Boolean).join('&')}`}
                                      className="inline-flex items-center gap-1 h-7 px-2 rounded border border-slate-300 dark:border-slate-700 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                                      download
                                      aria-label={t('Export container details JSON')}
                                    >
                                      <Download className="w-3.5 h-3.5" /> Export
                                    </a>
                                  </div>
                                  <pre className="text-[10px] leading-snug max-h-64 overflow-auto p-2 bg-slate-950/95 dark:bg-slate-950 text-slate-100 rounded border border-slate-800" aria-label={t('Raw JSON inspection')} tabIndex={0}>
{JSON.stringify(rawState.data, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </DetailsPanel>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
      </DrawerContent>
    </>,
    document.body
  );
}


/**
 * Clock icon component
 */
function ClockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

