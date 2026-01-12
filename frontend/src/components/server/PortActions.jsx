import { Copy, Edit, EyeOff, Eye } from "lucide-react";
import { ActionButton } from "./ActionButton";
import { t } from '@/lib/i18n';

export function PortActions({
  port,
  itemKey,
  actionFeedback,
  onCopy,
  onEdit,
  onHide,
  size,
}) {
  return (
    <div className="flex items-center space-x-1">
      <ActionButton
        type="copy"
        itemKey={itemKey}
        actionFeedback={actionFeedback}
        onClick={onCopy}
        icon={Copy}
        title={t('Copy URL to clipboard')}
        size={size}
      />
      <ActionButton
        type="edit"
        itemKey={itemKey}
        actionFeedback={actionFeedback}
        onClick={onEdit}
        icon={Edit}
        title={t('Edit note')}
        size={size}
      />
      <ActionButton
        type={port.ignored ? "unhide" : "hide"}
        itemKey={itemKey}
        actionFeedback={actionFeedback}
        onClick={onHide}
        icon={port.ignored ? Eye : EyeOff}
        title={port.ignored ? t('Unhide this port') : t('Hide this port')}
        size={size}
      />
    </div>
  );
}
