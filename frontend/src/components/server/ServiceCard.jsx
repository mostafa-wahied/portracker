import { ServiceCardList } from "./ServiceCardList";
import { ServiceCardGrid } from "./ServiceCardGrid";
import { ServiceCardTableRow } from "./ServiceCardTable";

export function ServiceCard({
  serviceName,
  ports,
  serverId,
  serverUrl,
  hostOverride,
  searchTerm,
  actionFeedback,
  onCopy,
  onNote,
  onToggleIgnore,
  onRename,
  onOpenContainerDetails,
  onCloseContainerDetails,
  selectionMode,
  selectedPorts,
  onToggleSelection,
  generatePortKey: _generatePortKey,
  isDocker = true,
  compact = false,
  tableMode = false,
  deepLinkContainerId,
  showIcons = true,
}) {
  const commonProps = {
    serviceName,
    ports,
    serverId,
    serverUrl,
    hostOverride,
    searchTerm,
    actionFeedback,
    onCopy,
    onNote,
    onToggleIgnore,
    onRename,
    onOpenContainerDetails,
    onCloseContainerDetails,
    selectionMode,
    selectedPorts,
    onToggleSelection,
    isDocker,
    deepLinkContainerId,
    showIcons,
  };

  if (tableMode) {
    return <ServiceCardTableRow {...commonProps} />;
  }

  if (compact) {
    return <ServiceCardGrid {...commonProps} />;
  }

  return <ServiceCardList {...commonProps} />;
}

export default ServiceCard;
