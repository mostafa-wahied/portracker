import React, { useState, useEffect } from "react";
import { t } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw } from "lucide-react";

/**
 * Modal component for renaming service names
 * Allows users to set custom names and reset to original names
 */
export function ServiceRenameModal({
  isOpen,
  onClose,
  port,
  serverId,
  serverUrl,
  onSave,
  loading = false,
}) {
  const [customName, setCustomName] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (isOpen && port) {
      setCustomName(port.customServiceName || port.owner || "");
      setIsDirty(false);
    }
  }, [isOpen, port]);

  useEffect(() => {
    if (port) {
      const currentName = port.customServiceName || port.owner || "";
      setIsDirty(customName !== currentName);
    }
  }, [customName, port]);

  const handleSave = () => {
    if (!port || !customName.trim()) return;
    
    onSave({
      serverId,
      hostIp: port.host_ip,
      hostPort: port.host_port,
      protocol: port.protocol,
      customName: customName.trim(),
      originalName: port.originalServiceName || port.owner,
      serverUrl,
      containerId: port.container_id,
      internal: port.internal || false,
    });
  };

  const handleReset = () => {
    if (!port) return;
    
    onSave({
      serverId,
      hostIp: port.host_ip,
      hostPort: port.host_port,
      protocol: port.protocol,
      customName: null,
      originalName: port.originalServiceName || port.owner,
      serverUrl,
      isReset: true,
      containerId: port.container_id,
      internal: port.internal || false,
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && isDirty && customName.trim()) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!port) return null;

  const displayedServiceName = port.customServiceName || port.owner || t('Unknown Service');
  const hasCustomName = !!port.customServiceName;
  const canReset = hasCustomName;
  const canSave = isDirty && customName.trim() && customName.trim() !== displayedServiceName;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Rename Service')}</DialogTitle>
          <DialogDescription>
            {t('Customize the display name for this service on port {port}.', { port: port.host_port })}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="service-name">{t('Service Name')}</Label>
            <Input
              id="service-name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('Enter custom service name...')}
              className="w-full"
              disabled={loading}
              autoFocus
            />
            {hasCustomName && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('Original: {name}', { name: port.originalServiceName || port.owner })}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 sm:order-1">
            <Button 
              variant="outline" 
              onClick={onClose}
              disabled={loading}
            >
              {t('Cancel')}
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!canSave || loading}
              className="min-w-16"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('Saving...')}
                </>
              ) : (
                t('Save')
              )}
            </Button>
          </div>
          
          {canReset && (
            <Button
              variant="ghost"
              onClick={handleReset}
              disabled={loading}
              className="sm:order-0 text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t('Reset to Original')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}