export function buildSidebarTree(servers) {
  const serverMap = new Map(servers.map((s) => [s.id, s]));
  const topLevelServers = [];
  const childrenMap = new Map();
  servers.forEach((server) => {
    if (server.parentId && serverMap.has(server.parentId)) {
      const children = childrenMap.get(server.parentId) || [];
      children.push(server);
      childrenMap.set(server.parentId, children);
    } else {
      topLevelServers.push(server);
    }
  });
  return { serverMap, topLevelServers, childrenMap };
}

export function sortByLabel(list, mode) {
  if (mode !== "asc" && mode !== "desc") return list;
  const sorted = [...list].sort((a, b) =>
    String(a.label || a.id || "").localeCompare(String(b.label || b.id || ""), undefined, {
      sensitivity: "base",
    })
  );
  return mode === "desc" ? sorted.reverse() : sorted;
}

export function computeReorderItems(active, over, tree) {
  if (!active || !over || active.id === over.id) return null;
  const { serverMap, topLevelServers, childrenMap } = tree;
  const activeServer = serverMap.get(active.id);
  const overServer = serverMap.get(over.id);
  if (!activeServer || !overServer) return null;
  const activeParent = activeServer.parentId || null;
  const overParent = overServer.parentId || null;
  if (activeParent !== overParent) return null;
  const siblings = activeParent ? childrenMap.get(activeParent) || [] : topLevelServers;
  const oldIndex = siblings.findIndex((s) => s.id === active.id);
  const newIndex = siblings.findIndex((s) => s.id === over.id);
  if (oldIndex < 0 || newIndex < 0) return null;
  const reordered = [...siblings];
  const [moved] = reordered.splice(oldIndex, 1);
  reordered.splice(newIndex, 0, moved);
  return reordered.map((s, idx) => ({ id: s.id, parentId: activeParent, position: idx }));
}
