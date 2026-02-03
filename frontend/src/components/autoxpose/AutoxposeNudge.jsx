import React, { useState, useEffect, useCallback } from 'react';
import { Globe, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { shouldShowNudge, markNudgeDismissed, findEligibleService } from '@/lib/autoxpose-nudge';

const AUTOXPOSE_REPO = 'https://github.com/mostafa-wahied/autoxpose';
const SHOW_DELAY_MS = 2500;
const AUTO_DISMISS_MS = 30000;

export function AutoxposeNudge({ 
  servers, 
  autoxposeConnected, 
  onOpenSettings 
}) {
  const [visible, setVisible] = useState(false);
  const [service, setService] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    markNudgeDismissed();
    setTimeout(() => setVisible(false), 200);
  }, []);

  const handleConnect = useCallback(() => {
    handleDismiss();
    onOpenSettings?.();
  }, [handleDismiss, onOpenSettings]);

  useEffect(() => {
    if (autoxposeConnected || dismissed) return;
    if (!shouldShowNudge()) return;

    const eligible = findEligibleService(servers);
    if (!eligible) return;

    const showTimer = setTimeout(() => {
      setService(eligible);
      setVisible(true);
    }, SHOW_DELAY_MS);

    return () => clearTimeout(showTimer);
  }, [servers, autoxposeConnected, dismissed]);

  useEffect(() => {
    if (!visible) return;

    const dismissTimer = setTimeout(handleDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(dismissTimer);
  }, [visible, handleDismiss]);

  if (!visible || !service) return null;

  return (
    <div 
      className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-lg shadow-lg border backdrop-blur-sm
        bg-white/95 dark:bg-slate-800/95 border-slate-200 dark:border-slate-700
        animate-in fade-in-0 slide-in-from-bottom-4 duration-300
        ${dismissed ? 'animate-out fade-out-0 slide-out-to-bottom-4' : ''}`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-2 rounded-full bg-indigo-100 dark:bg-indigo-900/50">
            <Globe className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Running {service.displayName}?
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              See if it&apos;s publicly exposed with{' '}
              <a 
                href={AUTOXPOSE_REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                autoxpose
              </a>
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button 
                size="sm" 
                variant="default"
                onClick={handleConnect}
                className="h-7 px-3 text-xs"
              >
                Connect
              </Button>
              <Button 
                size="sm" 
                variant="ghost"
                onClick={handleDismiss}
                className="h-7 px-2 text-xs text-slate-500"
              >
                Maybe later
              </Button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default AutoxposeNudge;
