const { describe, expect, test } = require("@jest/globals");
const {
  DEFAULT_SETTINGS,
  validateUserSettings,
} = require("./settings-schema");

describe("validateUserSettings", () => {
  test("accepts the existing user preference schema", () => {
    expect(validateUserSettings(DEFAULT_SETTINGS)).toEqual({ valid: true });
  });

  test("accepts existing autoxpose display preferences", () => {
    expect(
      validateUserSettings({
        autoxposeDisplayMode: "badge",
        autoxposeUrlStyle: "full",
      })
    ).toEqual({ valid: true });
  });

  test.each([
    { autoxposeUrl: "http://127.0.0.1:9099" },
    { autoxposeEnabled: true },
    { arbitraryKey: "value" },
  ])("rejects unsupported settings: %j", (settings) => {
    expect(validateUserSettings(settings)).toEqual({
      valid: false,
      error: expect.stringContaining("Unsupported setting"),
    });
  });

  test.each([
    { theme: false },
    { theme: "unknown" },
    { showServiceIcons: "true" },
    { defaultView: 1 },
    { defaultView: "unknown" },
    { defaultLayout: null },
    { defaultLayout: "unknown" },
    { autoxposeDisplayMode: "unknown" },
    { autoxposeUrlStyle: "unknown" },
  ])("rejects incorrect setting types: %j", (settings) => {
    expect(validateUserSettings(settings)).toEqual({
      valid: false,
      error: expect.stringContaining("Invalid value"),
    });
  });
});