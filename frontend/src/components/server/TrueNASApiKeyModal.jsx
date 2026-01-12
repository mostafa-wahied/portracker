import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Key, Check } from "lucide-react";
import Logger from '../../lib/logger';
import { t } from '@/lib/i18n';

const logger = new Logger('TrueNASApiKeyModal');

/**
 * Modal component that provides step-by-step instructions
 * for setting up TrueNAS API key to unlock enhanced features
 */
export function TrueNASApiKeyModal({ isOpen, onClose }) {
  const [copiedEnvVar, setCopiedEnvVar] = useState(false);

  const handleCopyEnvVar = () => {
    const text = "TRUENAS_API_KEY";
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          setCopiedEnvVar(true);
          setTimeout(() => setCopiedEnvVar(false), 2000);
        })
        .catch((err) => {
          logger.warn("Clipboard API failed, trying fallback", err);
          fallbackCopy(text);
        });
    } else {
      fallbackCopy(text);
    }
  };
  
  const fallbackCopy = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      
      if (successful) {
        setCopiedEnvVar(true);
        setTimeout(() => setCopiedEnvVar(false), 2000);
      }
    } catch (err) {
      logger.error("All copy methods failed", err);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <Key className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <DialogTitle>{t('Setup TrueNAS API Key')}</DialogTitle>
          </div>
          <DialogDescription>
            {t('Enable VMs, LXC containers, and enhanced system information.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          
          <div className="space-y-2.5">
            <div className="flex items-center space-x-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-semibold text-xs">
                1
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                {t('Generate API Key in TrueNAS')}
              </h3>
            </div>
            <div className="ml-8 text-sm text-slate-600 dark:text-slate-400 space-y-1.5">
              <div>{t('Navigate to:')} <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">System Settings → API Keys</span></div>
              <div>{t('Click Add, give it a name, then copy the generated key')}</div>
            </div>
          </div>

          
          <div className="space-y-2.5">
            <div className="flex items-center space-x-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-semibold text-xs">
                2
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                {t('Add to portracker')}
              </h3>
            </div>
            <div className="ml-8 space-y-2.5">
              <div className="text-sm text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Apps</span> → <span className="font-semibold">portracker</span> → <span className="font-semibold">Edit</span> → <span className="font-semibold">Environment Variables</span> → <span className="font-semibold">Add</span>
              </div>
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">{t('Name:')}</span>
                    <div
                      onClick={handleCopyEnvVar}
                      className="inline-flex items-center space-x-1.5 px-2 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors cursor-pointer"
                    >
                      <code className="font-mono text-xs text-slate-800 dark:text-slate-200 select-all">
                        TRUENAS_API_KEY
                      </code>
                      {copiedEnvVar && (
                        <Check className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">{t('Value:')}</span>
                    <span className="text-slate-500 dark:text-slate-400 italic">[paste your key]</span>
                  </div>
                </div>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-500 italic">
                {t('Click Update and wait for restart')}
              </div>
            </div>
          </div>

          
          <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-xs text-blue-800 dark:text-blue-400">
              <span className="font-semibold">🔒 Secure:</span> API key is read-only. Refresh portracker UI to see VMs.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={onClose}
            className="bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
