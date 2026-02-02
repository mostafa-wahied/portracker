import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, RefreshCw, Loader2, Key, AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ApiKeyModal({ isOpen, onClose }) {
  const [apiKey, setApiKey] = useState(null);
  const [keyInfo, setKeyInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      fetchKeyInfo();
    } else {
      setApiKey(null);
      setCopied(false);
      setError(null);
    }
  }, [isOpen]);

  const fetchKeyInfo = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/settings/servers/local/api-key", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setKeyInfo(data);
      } else {
        setError("Failed to fetch API key info");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const generateKey = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/settings/servers/local/api-key", {
        method: "POST",
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setApiKey(data.apiKey);
        setKeyInfo({ hasApiKey: true, createdAt: data.createdAt });
      } else {
        const data = await response.json();
        setError(data.error || "Failed to generate API key");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = () => {
    setShowRegenerateConfirm(true);
  };

  const confirmRegenerate = async () => {
    setShowRegenerateConfirm(false);
    await generateKey();
  };

  const handleCopy = () => {
    if (!apiKey || !inputRef.current) return;
    
    inputRef.current.select();
    inputRef.current.setSelectionRange(0, apiKey.length);
    
    try {
      const successful = document.execCommand("copy");
      if (successful) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch (err) {
      void 0;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Key
            </DialogTitle>
          </DialogHeader>

          <div className="py-2">
            {loading && !apiKey && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {!loading && !error && apiKey && (
              <div className="space-y-3">
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Copy this key now. It won't be shown again.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      readOnly
                      value={apiKey}
                      onClick={(e) => e.target.select()}
                      className="flex-1 text-xs font-mono bg-white dark:bg-slate-900 p-2 rounded border border-amber-200 dark:border-amber-800 outline-none focus:ring-2 focus:ring-amber-300"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 flex-shrink-0"
                          onClick={handleCopy}
                        >
                          {copied ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            )}

            {!loading && !error && !apiKey && keyInfo && (
              <div className="space-y-4">
                {keyInfo.hasApiKey ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        API key generated on
                      </p>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {formatDate(keyInfo.createdAt)}
                      </p>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      The key is hidden for security. Regenerate to create a new one.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRegenerate}
                      className="w-full"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Regenerate Key
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Generate an API key to allow other Portracker instances to scan this server.
                    </p>
                    <Button onClick={generateKey} className="w-full" disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Key className="h-4 w-4 mr-2" />
                      )}
                      Generate API Key
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will invalidate the current API key. Any external systems using the old key will no longer be able to access this server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRegenerate}>
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
