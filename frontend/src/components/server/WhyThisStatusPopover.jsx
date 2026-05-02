import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { RefreshCw, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useOverrides } from '@/hooks/useOverrides';
import { getDisplayHost } from './expanded-view-utils';
import { humanizeProbeError } from '@/lib/health-copy';

const COLOR_CLASSES = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  gray: 'bg-gray-400',
};

const SIMPLE_ROLE = {
  core_access: { label: 'main service', tone: 'blue' },
  core_runtime: { label: 'main service', tone: 'blue' },
  support: { label: 'helper', tone: 'slate' },
  job_expected_exit: { label: 'finished', tone: 'slate' },
  unknown: { label: 'role unset', tone: 'slate' },
};

const ROLE_OPTIONS = [
  { value: 'auto', label: 'Auto (detect)' },
  { value: 'core_runtime', label: 'Main service' },
  { value: 'support', label: 'Helper' },
  { value: 'job_expected_exit', label: 'Finished job' },
  { value: 'unknown', label: 'Unknown' },
];

const PORT_DOT_CLASS = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  gray: 'bg-gray-400',
};

function formatLatency(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-800/30 dark:text-green-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-800/30 dark:text-red-300',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function suppressedReasonLabel() {
  return 'host-only';
}

function suppressedReasonTooltip(reason) {
  switch (reason) {
    case 'host-network':
      return 'Container uses host networking; 127.0.0.1 stays local.';
    case 'no-bridge-ip':
      return 'No bridge IP available to route through.';
    default:
      return 'Bound to 127.0.0.1';
  }
}

function PortRow({ port, status, displayCtx }) {
  const proto = (port.protocol || 'tcp').toUpperCase();
  const ip = displayCtx
    ? getDisplayHost(port, displayCtx.serverId, displayCtx.serverUrl, displayCtx.hostOverride)
    : (port.host_ip || '0.0.0.0');
  const hp = port.host_port;
  const target = port.target_port && String(port.target_port) !== String(hp) ? ` \u2192 ${port.target_port}` : '';
  const color = status ? status.color : 'gray';
  const suppressed = !!(status && status.suppressed);
  const label = !status
    ? 'checking'
    : suppressed
      ? suppressedReasonLabel()
      : color === 'red'
        ? 'unreachable'
        : color === 'green'
          ? 'reachable'
          : color === 'yellow'
            ? 'partial'
            : 'unknown';
  const dotClass = PORT_DOT_CLASS[color] || PORT_DOT_CLASS.gray;
  const tooltip = suppressed
    ? suppressedReasonTooltip(status.suppressedReason)
    : (status && status.reason ? status.reason : undefined);
  return (
    <div className="flex items-center gap-2 py-1 pl-7 pr-3 text-xs" title={tooltip}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass} flex-shrink-0`} />
      <span className="font-mono text-slate-700 dark:text-slate-200">
        {ip}:{hp}
      </span>
      <span className="text-[10px] text-slate-400 dark:text-slate-500">{proto}{target}</span>
      {port.internal ? <span className="text-[10px] text-slate-400 dark:text-slate-500">internal</span> : null}
      <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}

function computePortStats(ports, containerId, portStatuses) {
  const myPorts = Array.isArray(ports) && containerId
    ? ports.filter((p) => p && p.container_id === containerId)
    : [];
  const failingPortCount = myPorts.filter((p) => {
    const st = portStatuses && portStatuses[`${p.host_ip}:${p.host_port}`];
    return st && st.color === 'red' && !st.suppressed;
  }).length;
  const suppressedPortCount = myPorts.filter((p) => {
    const st = portStatuses && portStatuses[`${p.host_ip}:${p.host_port}`];
    return st && st.suppressed;
  }).length;
  return { myPorts, portCount: myPorts.length, failingPortCount, suppressedPortCount };
}

function RoleOverrideSelect({ value, component, onChangeRole }) {
  return (
    <label className="flex items-center gap-1.5 flex-shrink-0">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Role</span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChangeRole(component._serviceId, component.containerId, v === 'auto' ? null : v);
        }}
        onClick={(e) => e.stopPropagation()}
        className="text-xs px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {ROLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

function ComponentRow({ component, onChangeRole, ports, portStatuses, displayCtx }) {
  const [expanded, setExpanded] = useState(false);
  const probe = component.probe || {};
  const ok = probe.ok === true;
  const err = probe.error;
  const latency = formatLatency(probe.latencyMs);
  const displayRole = component.effectiveRole || component.role;
  const roleInfo = SIMPLE_ROLE[displayRole] || SIMPLE_ROLE.unknown;
  const name = component._serviceName || 'component';
  const short = component.containerId ? component.containerId.slice(0, 12) : null;
  const explanation = component.reason || '';
  const overridden = !!component.overridden;
  const canOverride = !!(component.containerId && component._serviceId && onChangeRole);
  const selectValue = overridden ? component.effectiveRole : 'auto';
  const { myPorts, portCount, failingPortCount, suppressedPortCount } =
    computePortStats(ports, component.containerId, portStatuses);

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 first:border-t-0">
      <div className="py-3 px-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-slate-900 dark:text-slate-100 truncate">{name}</span>
            {short && (
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{short}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge tone={roleInfo.tone}>{roleInfo.label}</Badge>
            {overridden && <Badge tone="blue">overridden</Badge>}
            <Badge tone={ok ? 'green' : 'red'}>{ok ? 'reachable' : 'unreachable'}</Badge>
          </div>
        </div>
        {explanation && (
          <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">
            {explanation}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2 min-w-0">
            {latency && <span>{latency}</span>}
            {!ok && err && (
              <span className="truncate" title={err}>
                {latency ? '· ' : ''}{humanizeProbeError(err)}
              </span>
            )}
          </div>
          {canOverride && (
            <RoleOverrideSelect value={selectValue} component={component} onChangeRole={onChangeRole} />
          )}
        </div>
        {portCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span>
              {portCount} port{portCount === 1 ? '' : 's'}
              {failingPortCount > 0 ? ` · ${failingPortCount} unreachable` : ''}
              {suppressedPortCount > 0 ? ` · ${suppressedPortCount} host-only` : ''}
            </span>
          </button>
        )}
      </div>
      {expanded && portCount > 0 && (
        <div className="pb-2 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-700">
          {myPorts.map((p, i) => (
            <PortRow
              key={`${p.host_ip}:${p.host_port}:${p.protocol || 'tcp'}:${i}`}
              port={p}
              status={portStatuses && portStatuses[`${p.host_ip}:${p.host_port}`]}
              displayCtx={displayCtx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function summarize(components) {
  const list = Array.isArray(components) ? components : [];
  if (list.length === 0) return 'No component data available.';
  const roleOf = (c) => c.effectiveRole || c.role;
  const mains = list.filter((c) => roleOf(c) === 'core_access' || roleOf(c) === 'core_runtime');
  const mainsOk = mains.filter((c) => c.probe && c.probe.ok === true);
  if (mains.length === 0) {
    return `No main service identified (${list.length} component${list.length === 1 ? '' : 's'} found).`;
  }
  if (mainsOk.length === mains.length) {
    return `All ${mains.length} main service${mains.length === 1 ? '' : 's'} reachable.`;
  }
  return `${mains.length - mainsOk.length} of ${mains.length} main service${mains.length === 1 ? '' : 's'} unreachable.`;
}

const LEGEND_CHIP_CLASS = 'inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-[11px] leading-snug';
const LEGEND_TERM_CLASS = 'font-semibold text-slate-700 dark:text-slate-200';

const LEGEND_ITEMS = [
  { term: 'main service', desc: 'the app you connect to' },
  { term: 'helper', desc: 'supporting piece (db, cache, worker)' },
  { term: 'finished job', desc: 'one-shot setup task' },
];

function RoleLegend() {
  return (
    <div className="pt-2 space-y-2">
      <TooltipProvider delayDuration={150}>
        <div className="flex flex-wrap gap-1.5">
          {LEGEND_ITEMS.map(({ term, desc }) => (
            <Tooltip key={term}>
              <TooltipTrigger asChild>
                <span tabIndex={-1} className={LEGEND_CHIP_CLASS + ' cursor-help'}>
                  <span className={LEGEND_TERM_CLASS}>{term}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{desc}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        The dot reflects main services only. Hover a chip for its definition.
      </p>
    </div>
  );
}

function ResetServiceRolesChip({ count, busy, confirming, onAskConfirm, onCancel, onConfirm }) {
  if (confirming) {
    return (
      <div
        role="group"
        aria-label="Confirm reset roles"
        className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-medium text-slate-700 dark:text-slate-200"
      >
        <span className="px-0.5">Reset {count}?</span>
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          disabled={busy}
          className="px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          No
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={busy}
          className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? '\u2026' : 'Yes'}
        </button>
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onAskConfirm(); }}
          aria-label={`Reset ${count} customized role${count === 1 ? '' : 's'}`}
          className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/30 text-[10px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
        >
          <RotateCcw className="w-3 h-3" />
          <span className="tabular-nums">{count}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>Reset {count} customized role{count === 1 ? '' : 's'} for this service</TooltipContent>
    </Tooltip>
  );
}

function useServiceOverrideClear(components) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { setOverride, clearAllForService } = useOverrides();
  const serviceOverrideCount = Array.isArray(components)
    ? components.filter((c) => c && c.overridden).length
    : 0;
  const serviceIdForClear = Array.isArray(components) && components.length > 0
    ? (components.find((c) => c && c._serviceId) || {})._serviceId
    : null;
  const onConfirm = async () => {
    if (!serviceIdForClear) return;
    setBusy(true);
    try {
      await clearAllForService(serviceIdForClear);
      setConfirming(false);
    } finally { setBusy(false); }
  };
  return {
    setOverride, serviceOverrideCount, serviceIdForClear,
    confirming, busy,
    onAskConfirm: () => setConfirming(true),
    onCancel: () => setConfirming(false),
    onConfirm,
  };
}

export function WhyThisStatusPopover({
  open,
  onOpenChange,
  serviceName,
  color,
  components,
  ports,
  portStatuses,
  updatedAt,
  onRefresh,
  serverId,
  serverUrl,
  hostOverride,
}) {
  const [refreshing, setRefreshing] = useState(false);
  const ov = useServiceOverrideClear(components);
  const colorClass = COLOR_CLASSES[color] || COLOR_CLASSES.gray;
  const componentCount = Array.isArray(components) ? components.length : 0;
  const summary = summarize(components);
  const displayCtx = { serverId, serverUrl, hostOverride };
  const handleChangeRole = (serviceId, containerId, role) => {
    ov.setOverride(serviceId, containerId, role);
  };
  const handleRefresh = async (e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };
  const updatedLabel = updatedAt
    ? `Updated ${Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago`
    : 'Not yet updated';
  const stop = (e) => e.stopPropagation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onClick={stop}
        onMouseDown={stop}
        onMouseUp={stop}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`} />
            <DialogTitle className="text-base">Why this status?</DialogTitle>
            {ov.serviceOverrideCount > 0 && ov.serviceIdForClear && (
              <ResetServiceRolesChip
                count={ov.serviceOverrideCount}
                busy={ov.busy}
                confirming={ov.confirming}
                onAskConfirm={ov.onAskConfirm}
                onCancel={ov.onCancel}
                onConfirm={ov.onConfirm}
              />
            )}
          </div>
          <DialogDescription className="pt-1 text-slate-600 dark:text-slate-400">
            <span className="font-medium text-slate-800 dark:text-slate-200">{serviceName}</span>
            <span className="mx-1.5 text-slate-400">·</span>
            <span>{summary}</span>
          </DialogDescription>
          <RoleLegend />
        </DialogHeader>

        <div className="border border-slate-200 dark:border-slate-700 rounded-md max-h-96 overflow-y-auto">
          {componentCount === 0 ? (
            <div className="p-4 text-sm text-slate-500 dark:text-slate-400 text-center">
              No component data available.
            </div>
          ) : (
            components.map((c, i) => (
              <ComponentRow
                key={(c.containerId || c.componentId || 'c') + ':' + i}
                component={c}
                onChangeRole={handleChangeRole}
                ports={ports}
                portStatuses={portStatuses}
                displayCtx={displayCtx}
              />
            ))
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-xs text-slate-500 dark:text-slate-400">{updatedLabel}</span>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WhyThisStatusPopover;
