const { describe, test, expect, jest: jestObject, afterEach } = require("@jest/globals");
jestObject.mock("./api-key-manager", () => ({ validateAnyApiKey: async () => ({ valid: false }) }));
const { redactDiagnosticData } = require("./diagnostic-data");
const { requireDiagnosticSession } = require("../middleware/auth");
const originalAuth = process.env.ENABLE_AUTH;
afterEach(() => { if (originalAuth === undefined) delete process.env.ENABLE_AUTH; else process.env.ENABLE_AUTH = originalAuth; });

describe("diagnostic confidentiality", () => {
  test("removes command, labels, health logs and raw application configuration without mutation", () => {
    const data = { ports: [{ host_port: 8080, command: "synthetic-secret" }], raw: {
      Args: ["synthetic-secret"], Config: { Env: ["synthetic-secret"], Cmd: ["synthetic-secret"], Entrypoint: ["synthetic-secret"], Labels: { "custom": "synthetic-secret", "com.docker.compose.project": "fixture" }, Healthcheck: { Test: ["synthetic-secret"] } },
      State: { Health: { Status: "healthy", Log: [{ Output: "synthetic-secret" }] } },
    }, applications: [{ platform_data: { orig_data: { id: "fixture", config: { custom: "synthetic-secret" }, memory: 4096 } } }], password: "synthetic-secret" };
    const before = JSON.stringify(data);
    const safe = redactDiagnosticData(data);
    expect(JSON.stringify(safe)).not.toContain("synthetic-secret");
    expect(safe.ports[0].host_port).toBe(8080);
    expect(safe.raw.Config.Labels).toEqual({ "com.docker.compose.project": "fixture" });
    expect(safe.applications[0].platform_data.orig_data.memory).toBe(4096);
    expect(JSON.stringify(data)).toBe(before);
    expect(redactDiagnosticData(safe)).toEqual(safe);
  });

  test.each([["true", false, "true", 403], ["true", true, "true", 200], ["false", false, "true", 200], ["true", false, undefined, 200]])(
    "restricts raw diagnostics auth=%s session=%s raw=%s", (auth, session, raw, expected) => {
      process.env.ENABLE_AUTH = auth;
      const response = { status: jestObject.fn().mockReturnThis(), json: jestObject.fn() };
      const next = jestObject.fn();
      requireDiagnosticSession({ query: { raw }, session: session ? { userId: "fixture" } : null }, response, next);
      if (expected === 403) { expect(response.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled(); }
      else expect(next).toHaveBeenCalledTimes(1);
    }
  );
});