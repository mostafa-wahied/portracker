import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { PortTableRow } from "./PortTableRow";
import { generatePortKey } from "../../lib/utils/portUtils";

/**
 * Renders a sortable table displaying a list of ports with associated details and actions.
 *
 * Displays columns for status, port, service, source, host, creation time, and available actions. Allows sorting by port, service, or creation time. Each row represents a port and provides controls for copying, adding notes, or toggling ignore status.
 */
export function PortTable({
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
  sortConfig,
  onSort,
  deepLinkContainerId,
  onOpenContainerDetails,
  onCloseContainerDetails,
  selectionMode = false,
  selectedPorts,
  onToggleSelection,
  onSelectAllPorts,
}) {
  const getSortIcon = (column) => {
    if (sortConfig.key !== column) {
      return <ArrowUpDown className="h-3 w-3 ml-1" />;
    }
    return sortConfig.direction === "ascending" ? (
      <ArrowUp className="h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1" />
    );
  };

  const handleSort = (column) => {
    onSort(column);
  };

  const allSelected = ports.length > 0 && ports.every(port => 
    selectedPorts?.has(generatePortKey(serverId, port))
  );
  
  const someSelected = ports.some(port => 
    selectedPorts?.has(generatePortKey(serverId, port))
  );

  const handleSelectAll = () => {
    if (allSelected) {
      ports.forEach(port => {
        if (selectedPorts?.has(generatePortKey(serverId, port))) {
          onToggleSelection?.(port, serverId);
        }
      });
    } else {
      onSelectAllPorts?.(ports);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="bg-slate-50 dark:bg-slate-800/50">
          <tr>
            {selectionMode && (
              <th
                scope="col"
                className="px-4 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={input => {
                    if (input) input.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={handleSelectAll}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 rounded cursor-pointer"
                />
              </th>
            )}
            
            <th
              scope="col"
              className="px-4 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
            >
              Status
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
            >
              <button
                className="flex items-center hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                onClick={() => handleSort("host_port")}
              >
                Port
                {getSortIcon("host_port")}
              </button>
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
            >
              <button
                className="flex items-center hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                onClick={() => handleSort("owner")}
              >
                Service
                {getSortIcon("owner")}
              </button>
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
            >
              Source
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
            >
              Host
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
            >
              <button
                className="flex items-center hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                onClick={() => handleSort("created")}
              >
                Created
                {getSortIcon("created")}
              </button>
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
          {ports.map((port) => (
            <PortTableRow
              key={generatePortKey(serverId, port)}
              port={port}
              serverId={serverId}
              serverUrl={serverUrl}
              hostOverride={hostOverride}
              searchTerm={searchTerm}
              actionFeedback={actionFeedback}
              onCopy={onCopy}
              onNote={onNote}
              onToggleIgnore={onToggleIgnore}
              onRename={onRename}
              forceOpenDetails={deepLinkContainerId && port.container_id === deepLinkContainerId}
              notifyOpenDetails={(cid) => onOpenContainerDetails && onOpenContainerDetails(cid)}
              notifyCloseDetails={() => onCloseContainerDetails && onCloseContainerDetails()}
              selectionMode={selectionMode}
              isSelected={selectedPorts?.has(generatePortKey(serverId, port))}
              onToggleSelection={onToggleSelection}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
