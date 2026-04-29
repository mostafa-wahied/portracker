import React from "react";
import { DashboardLayout } from "./DashboardLayout";
import { Sidebar } from "./Sidebar";
import { CollapsedSidebar } from "./CollapsedSidebar";

const SIDEBAR_SHORTCUT_LABEL = "⌘B / Ctrl+B";
const SEARCH_SHORTCUT_LABEL = "⌘K / Ctrl+K";

export function AppSidebarLayout({
  isSidebarOpen,
  onCloseSidebar,
  servers,
  selectedId,
  onSelect,
  addServer,
  deleteServer,
  loading,
  hostOverride,
  sidebarLayout,
  onOpenAddServer,
  children,
}) {
  return (
    <DashboardLayout
      isSidebarOpen={isSidebarOpen}
      onCloseSidebar={onCloseSidebar}
      isSidebarCollapsed={sidebarLayout.isCollapsed}
      onToggleSidebarCollapsed={sidebarLayout.onCollapseToggle}
      sidebarWidth={sidebarLayout.width}
      onSidebarWidthChange={sidebarLayout.onWidthChange}
      sidebarShortcutLabel={SIDEBAR_SHORTCUT_LABEL}
      searchShortcutLabel={SEARCH_SHORTCUT_LABEL}
      showSidebarDiscovery={sidebarLayout.discoveryVisible}
      onDismissSidebarDiscovery={sidebarLayout.onDiscoveryDismiss}
      onTrySidebarDiscovery={sidebarLayout.onDiscoveryTry}
      onSidebarMaxedOut={sidebarLayout.onSidebarMaxedOut}
      sidebar={
        <Sidebar
          servers={servers}
          selectedId={selectedId}
          onSelect={onSelect}
          onAdd={addServer}
          onDelete={deleteServer}
          loading={loading}
          hostOverride={hostOverride}
          lastRefreshedAt={sidebarLayout.lastRefreshedAt}
          requestedMode={sidebarLayout.requestedMode}
          onRequestedModeHandled={sidebarLayout.onRequestedModeHandled}
        />
      }
      collapsedSidebar={
        <CollapsedSidebar
          servers={servers}
          selectedId={selectedId}
          onSelect={onSelect}
          onAdd={onOpenAddServer}
        />
      }
    >
      {children}
    </DashboardLayout>
  );
}
