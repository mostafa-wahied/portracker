function addPlatformColumns(db, logger, columnNames) {
  if (!columnNames.includes("platform")) {
    logger.info("Migrating database: Adding platform column to servers table");
    db.prepare(
      "ALTER TABLE servers ADD COLUMN platform TEXT DEFAULT 'standard'"
    ).run();
  }
  if (!columnNames.includes("platform_config")) {
    logger.info("Migrating database: Adding platform_config column to servers table");
    db.prepare("ALTER TABLE servers ADD COLUMN platform_config TEXT").run();
  }
  if (!columnNames.includes("platform_type")) {
    logger.info("Migrating database: Adding platform_type column to servers table");
    db.prepare(
      "ALTER TABLE servers ADD COLUMN platform_type TEXT DEFAULT 'auto'"
    ).run();
  }
}

function addPositionColumn(db, logger, columnNames) {
  if (columnNames.includes("position")) return;
  logger.info(
    "Migrating database: Adding position column to servers table and backfilling sibling order"
  );
  db.prepare("ALTER TABLE servers ADD COLUMN position INTEGER").run();
  const rows = db
    .prepare("SELECT id, parentId FROM servers ORDER BY rowid ASC")
    .all();
  const counters = new Map();
  const update = db.prepare("UPDATE servers SET position = ? WHERE id = ?");
  const tx = db.transaction((batch) => {
    for (const row of batch) {
      const key = row.parentId || "__root__";
      const next = counters.get(key) || 0;
      update.run(next, row.id);
      counters.set(key, next + 1);
    }
  });
  tx(rows);
}

function migrateServersInPlace(db, logger, columnNames) {
  addPlatformColumns(db, logger, columnNames);
  addPositionColumn(db, logger, columnNames);
}

module.exports = { migrateServersInPlace };
