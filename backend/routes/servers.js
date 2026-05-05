function listHandler({ db, logger }) {
  return (req, res) => {
    logger.debug("GET /api/servers");
    try {
      const stmt = db.prepare(
        "SELECT id, label, url, parentId, type, unreachable, platform_type, position, (remote_api_key IS NOT NULL) as hasApiKey FROM servers ORDER BY (position IS NULL) ASC, position ASC, label COLLATE NOCASE ASC"
      );
      const servers = stmt.all();
      logger.debug(`Returning ${servers.length} servers`);
      res.json(servers);
    } catch (error) {
      logger.error("Failed to get servers:", error.message);
      logger.debug("Stack trace:", error.stack || "");
      res
        .status(500)
        .json({ error: "Failed to retrieve servers", details: error.message });
    }
  };
}

function updateExistingServer(db, payload) {
  const { id, label, url, parentId, type, dbUnreachable, platform_type, apiKey } = payload;
  if (apiKey !== undefined) {
    db.prepare(
      "UPDATE servers SET label = ?, url = ?, parentId = ?, type = ?, unreachable = ?, platform_type = ?, remote_api_key = ? WHERE id = ?"
    ).run(
      label,
      url,
      parentId || null,
      type,
      dbUnreachable,
      platform_type,
      apiKey || null,
      id
    );
    return;
  }
  db.prepare(
    "UPDATE servers SET label = ?, url = ?, parentId = ?, type = ?, unreachable = ?, platform_type = ? WHERE id = ?"
  ).run(label, url, parentId || null, type, dbUnreachable, platform_type, id);
}

function insertNewServer(db, payload) {
  const { id, label, url, parentId, type, dbUnreachable, platform_type, apiKey } = payload;
  const nextPositionRow = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM servers WHERE (parentId IS ? OR parentId = ?)"
    )
    .get(parentId || null, parentId || null);
  const nextPosition = nextPositionRow ? nextPositionRow.next : 0;
  db.prepare(
    "INSERT INTO servers (id, label, url, parentId, type, unreachable, platform_type, remote_api_key, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    label,
    url,
    parentId || null,
    type,
    dbUnreachable,
    platform_type,
    apiKey || null,
    nextPosition
  );
}

function handleUpsertError(error, id, body, logger, res) {
  logger.error(`Database error in POST /api/servers (ID: ${id}): ${error.message}`);
  logger.debug("Stack trace:", error.stack || "");
  if (error.message.includes("UNIQUE constraint failed")) {
    return res.status(409).json({ error: `Server with ID '${id}' already exists.` });
  }
  const lower = error.message.toLowerCase();
  if (lower.includes("can only bind") || lower.includes("datatype mismatch")) {
    logger.error(
      `Possible data binding/type issue for server ID ${id}. Payload received: ${JSON.stringify(body)}`
    );
    return res
      .status(500)
      .json({ error: "Failed to save server due to data type issue.", details: error.message });
  }
  return res.status(500).json({ error: "Failed to save server", details: error.message });
}

function upsertHandler({ db, logger }) {
  return (req, res) => {
    const { id, label, url, parentId, type, unreachable, platform_type, apiKey } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Field 'id' is required" });
    }
    if (type === "peer" && !unreachable && (!url || url.trim().length === 0)) {
      return res.status(400).json({
        error: "Validation failed",
        details: "Field 'url' is required for reachable peer servers",
        field: "url",
      });
    }
    const dbUnreachable = unreachable ? 1 : 0;
    const payload = { id, label, url, parentId, type, dbUnreachable, platform_type, apiKey };
    try {
      const existing = db.prepare("SELECT id FROM servers WHERE id = ?").get(id);
      if (existing) {
        updateExistingServer(db, payload);
        logger.info(`Server updated successfully. ID: ${id}, Label: "${label}"`);
        return res.status(200).json({ message: "Server updated successfully", id });
      }
      insertNewServer(db, payload);
      logger.info(`Server added successfully. ID: ${id}, Label: "${label}"`);
      return res.status(201).json({ message: "Server added successfully", id });
    } catch (error) {
      return handleUpsertError(error, id, req.body, logger, res);
    }
  };
}

function normalizeReorderItems(rawItems) {
  const out = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw.id !== "string" || raw.id.length === 0) {
      return { error: "Every item must include a string 'id'" };
    }
    const position = Number(raw.position);
    if (!Number.isFinite(position) || position < 0) {
      return { error: `Invalid position for id '${raw.id}'` };
    }
    const parentId =
      raw.parentId === undefined || raw.parentId === null || raw.parentId === ""
        ? null
        : String(raw.parentId);
    out.push({ id: raw.id, parentId, position: Math.floor(position) });
  }
  return { items: out };
}

function validateReorderItems(items, known) {
  for (const item of items) {
    if (!known.has(item.id)) return { error: `Server '${item.id}' not found`, status: 404 };
    if (item.parentId !== null && !known.has(item.parentId)) {
      return { error: `parentId '${item.parentId}' does not exist`, status: 400 };
    }
    if (item.parentId === item.id) {
      return { error: `Server '${item.id}' cannot be its own parent`, status: 400 };
    }
  }
  return { ok: true };
}

function detectReorderCycles(items, known) {
  const pending = new Map(known);
  for (const item of items) pending.set(item.id, item.parentId);
  for (const item of items) {
    let cursor = item.parentId;
    const seen = new Set([item.id]);
    while (cursor) {
      if (seen.has(cursor)) return { error: `Move of '${item.id}' would create a cycle` };
      seen.add(cursor);
      cursor = pending.get(cursor) || null;
    }
  }
  return { ok: true };
}

function reorderHandler({ db, logger }) {
  return (req, res) => {
    logger.debug("PUT /api/servers/order");
    const { items: rawItems } = req.body || {};
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ error: "Body must include non-empty 'items' array" });
    }
    const normalized = normalizeReorderItems(rawItems);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    try {
      const known = new Map(
        db
          .prepare("SELECT id, parentId FROM servers")
          .all()
          .map((row) => [row.id, row.parentId || null])
      );
      const validation = validateReorderItems(normalized.items, known);
      if (validation.error) return res.status(validation.status).json({ error: validation.error });
      const cycles = detectReorderCycles(normalized.items, known);
      if (cycles.error) return res.status(400).json({ error: cycles.error });
      const update = db.prepare("UPDATE servers SET parentId = ?, position = ? WHERE id = ?");
      const tx = db.transaction((rows) => {
        for (const row of rows) update.run(row.parentId, row.position, row.id);
      });
      tx(normalized.items);
      logger.info(`Reordered ${normalized.items.length} servers`);
      return res.json({ ok: true, count: normalized.items.length });
    } catch (error) {
      logger.error(`Error in PUT /api/servers/order: ${error.message}`);
      return res
        .status(500)
        .json({ error: "Failed to reorder servers", details: error.message });
    }
  };
}

function registerServerRoutes(app, deps) {
  const { requireAuth, validateServerInput } = deps;
  app.get("/api/servers", requireAuth, listHandler(deps));
  app.post("/api/servers", requireAuth, validateServerInput, upsertHandler(deps));
  app.put("/api/servers/order", requireAuth, reorderHandler(deps));
}

module.exports = { registerServerRoutes };
