import React from 'react';
import { Check, Copy } from 'lucide-react';
import { t } from '@/lib/i18n';

export function InfoTile({ label, value, displayValue, mono, onCopy, tooltip, isCopied }) {
  if (value == null) return null;
  const showValue = displayValue != null ? displayValue : value;
  return (
    <div className="relative p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 group">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-medium mb-1">
        {label}
      </div>
      <div title={tooltip || (displayValue ? value : undefined)} className={`${mono ? 'font-mono text-[11px] bg-white/70 dark:bg-slate-950/40 px-2 py-1 rounded border border-slate-200 dark:border-slate-700' : 'font-medium'} break-all`}>{showValue}</div>
      {onCopy && (
        <button
          type="button"
          onClick={() => onCopy(value)}
          aria-label={isCopied ? t('Copied {label}', { label }) : `${t('Copy')} ${label}`}
          className={`absolute top-2 right-2 transition-all p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${isCopied ? 'bg-green-100 dark:bg-green-900/30' : 'opacity-0 group-hover:opacity-100'}`}
        >
          {isCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
