import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ServerCard } from "./ServerCard";

export function SortableServerCard({
  server,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  hostOverride,
  lastRefreshedTs,
  draggable,
  children,
}) {
  const sortable = useSortable({ id: server.id, disabled: !draggable });
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = sortable;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragHandleProps = draggable ? { ...attributes, ...listeners } : null;

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      {dragHandleProps && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="absolute -left-5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing transition-opacity z-10"
          aria-label="Drag to reorder"
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <ServerCard
        server={server}
        isSelected={isSelected}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
        hostOverride={hostOverride}
        lastRefreshedTs={lastRefreshedTs}
      >
        {children}
      </ServerCard>
    </div>
  );
}
