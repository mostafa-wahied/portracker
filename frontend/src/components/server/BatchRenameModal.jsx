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
 * Modal component for batch renaming multiple services
 * Allows users to set the same custom name for all selected ports
 */
export function BatchRenameModal({
  isOpen,
  onClose,
  selectedPorts,
  onSave,
  loading = false,
}) {
  const [customName, setCustomName] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCustomName("");
      setIsDirty(false);
    }
  }, [isOpen]);

  useEffect(() => {
    setIsDirty(customName.trim().length > 0);
  }, [customName]);

  const handleSave = () => {
    if (!customName.trim()) return;
    
    onSave({
      customName: customName.trim(),
      selectedPorts: Array.from(selectedPorts),
    });
  };

  const handleReset = () => {
    onSave({
      customName: null,
      selectedPorts: Array.from(selectedPorts),
      isReset: true,
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && isDirty && customName.trim()) {
      e.preventDefault();
      handleSave();
    }
  };

  const portCount = selectedPorts?.size || 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Batch Rename Services')}</DialogTitle>
          <DialogDescription>
            {t('Set a custom service name for {count} selected services.', { count: portCount })}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="batch-service-name">{t('Service Name')}</Label>
            <Input
              id="batch-service-name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('Enter custom service name...')}
              className="w-full"
              disabled={loading}
              autoFocus
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('This name will be applied to all {count} selected services.', { count: portCount })}
            </p>
          </div>
        </div>

        <DialogFooter>
          <div className="flex flex-col gap-2 w-full">
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={onClose}
                disabled={loading}
                className="flex-1"
              >
                {t('Cancel')}
              </Button>
              <Button 
                onClick={handleSave}
                disabled={!isDirty || loading}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('Saving...')}
                  </>
                ) : (
                  t('Rename {count}', { count: portCount })
                )}
              </Button>
            </div>
            
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={loading}
              className="w-full"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t('Reset All to Original')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}