const DEFAULT_SETTINGS = Object.freeze({
  theme: "system",
  showServiceIcons: true,
  defaultView: "service",
  defaultLayout: "grid",
  autoxposeDisplayMode: "url",
  autoxposeUrlStyle: "compact",
});

const SETTING_VALUES = Object.freeze({
  theme: new Set(["system", "light", "dark"]),
  showServiceIcons: new Set([true, false]),
  defaultView: new Set(["service", "services", "ports"]),
  defaultLayout: new Set(["grid", "list", "table"]),
  autoxposeDisplayMode: new Set(["url", "badge"]),
  autoxposeUrlStyle: new Set(["full", "compact"]),
});

function isUserSettingKey(key) {
  return Object.prototype.hasOwnProperty.call(SETTING_VALUES, key);
}

function isValidUserSetting(key, value) {
  return isUserSettingKey(key) && SETTING_VALUES[key].has(value);
}

function validateUserSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { valid: false, error: "Settings must be an object" };
  }

  for (const [key, value] of Object.entries(settings)) {
    if (!isUserSettingKey(key)) {
      return { valid: false, error: `Unsupported setting: ${key}` };
    }
    if (!isValidUserSetting(key, value)) {
      return { valid: false, error: `Invalid value for setting: ${key}` };
    }
  }

  return { valid: true };
}

module.exports = {
  DEFAULT_SETTINGS,
  isUserSettingKey,
  isValidUserSetting,
  validateUserSettings,
};