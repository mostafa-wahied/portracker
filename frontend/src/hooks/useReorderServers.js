import { useCallback } from "react";
import Logger from "@/lib/logger";

const logger = new Logger("useReorderServers");

export function useReorderServers({ servers, groups, setServers, setGroups }) {
  return useCallback(
    async (items) => {
      const itemMap = new Map(items.map((it) => [it.id, it.position]));
      const reorder = (list) =>
        [...list].sort((a, b) => {
          const ap = itemMap.has(a.id) ? itemMap.get(a.id) : Number.POSITIVE_INFINITY;
          const bp = itemMap.has(b.id) ? itemMap.get(b.id) : Number.POSITIVE_INFINITY;
          return ap - bp;
        });
      const prevServers = servers;
      const prevGroups = groups;
      setServers((cur) => reorder(cur));
      setGroups((cur) => reorder(cur));
      try {
        const r = await fetch("/api/servers/order", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `reorder failed: ${r.status}`);
        }
      } catch (err) {
        logger.error("Failed to persist reorder:", err);
        setServers(prevServers);
        setGroups(prevGroups);
      }
    },
    [servers, groups, setServers, setGroups]
  );
}
