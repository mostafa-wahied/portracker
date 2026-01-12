import React from "react";
import { t } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, EyeOff } from "lucide-react";

/**
 * Modal component for batch hiding/showing multiple ports
 * Allows users to hide or show all selected ports at once
 */
export function BatchHideModal({
  isOpen,
  onClose,
  selectedPorts,
  onConfirm,
  loading = false,
  action = "hide",
}) {
  const handleConfirm = () => {
    onConfirm({
      selectedPorts: Array.from(selectedPorts),
      action,
    });
  };

  const portCount = selectedPorts?.size || 0;
  const isHiding = action === "hide";
  const actionText = isHiding ? t('Hide') : t('Show');
  const actionDescription = isHiding
    ? t('Hidden ports will no longer appear in the main view but can be accessed through the hidden ports drawer.')
    : t('These ports will be restored to the main view.');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isHiding ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            {actionText} {t('Port')} {portCount}
          </DialogTitle>
          <DialogDescription>
            {actionDescription}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('Are you sure you want to {action} {count} selected ports?', { action: actionText, count: portCount })}
          </p>
        </div>

        <DialogFooter className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
            disabled={loading}
          >
            {t('Cancel')}
          </Button>
          <Button 
            onClick={handleConfirm}
            disabled={loading}
            variant={isHiding ? "destructive" : "default"}
            className="min-w-16"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isHiding ? t('Hiding...') : t('Showing...')}
              </>
            ) : (
              <>
                {isHiding ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                {actionText} {t('Port')} {portCount}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}