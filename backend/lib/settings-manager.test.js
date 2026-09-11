const {
  afterAll,
  beforeEach,
  describe,
  expect,
  test,
} = require("@jest/globals");

const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = ":memory:";

const db = require("../db");
const settingsManager = require("./settings-manager");

beforeEach(() => {
  settingsManager.initializeSettingsStorage();
  db.prepare("DELETE FROM user_settings").run();
  db.prepare("DELETE FROM autoxpose_connection").run();
  db.prepare("DELETE FROM settings_migrations").run();
});

afterAll(() => {
  db.close();
  if (originalDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = originalDatabasePath;
  }
});

describe("trusted Autoxpose connection settings", () => {
  test("invalidates legacy connection keys without migrating them", () => {
    const insert = db.prepare(
      "INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)"
    );
    insert.run(null, "autoxposeUrl", "http://127.0.0.1:9099");
    insert.run(null, "autoxposeEnabled", "true");
    insert.run("test-user", "autoxposeUrl", "http://10.0.0.5:3000");

    expect(settingsManager.initializeSettingsStorage()).toBe(true);

    expect(settingsManager.getAutoxposeConnection()).toBeNull();
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM user_settings WHERE setting_key IN ('autoxposeUrl', 'autoxposeEnabled')"
      ).get().count
    ).toBe(0);
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM settings_migrations WHERE id = 'autoxpose-connection-trust-v1'"
      ).get().count
    ).toBe(1);
  });

  test("runs legacy cleanup only once", () => {
    expect(settingsManager.initializeSettingsStorage()).toBe(true);
    db.prepare(
      "INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)"
    ).run(null, "autoxposeUrl", "http://192.168.1.25:3000");

    expect(settingsManager.initializeSettingsStorage()).toBe(true);
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM user_settings WHERE setting_key = 'autoxposeUrl'"
      ).get().count
    ).toBe(1);
    expect(settingsManager.getUserSettings(null)).not.toHaveProperty("autoxposeUrl");
  });

  test("stores and clears only authenticated connection state", () => {
    expect(
      settingsManager.setAutoxposeConnection("http://192.168.1.25:3000")
    ).toBe(true);
    expect(settingsManager.getAutoxposeConnection()).toEqual({
      url: "http://192.168.1.25:3000",
    });

    expect(settingsManager.clearAutoxposeConnection()).toBe(true);
    expect(settingsManager.getAutoxposeConnection()).toBeNull();
  });

  test("filters unsupported legacy rows and rejects unsupported writes", () => {
    db.prepare(
      "INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)"
    ).run("test-user", "arbitraryKey", "value");

    expect(settingsManager.getUserSettings("test-user")).not.toHaveProperty(
      "arbitraryKey"
    );
    expect(settingsManager.updateUserSetting("test-user", "arbitraryKey", "value"))
      .toBe(false);
  });
});