const { afterEach, beforeEach, describe, expect, jest: jestObject, test } = require("@jest/globals");

jestObject.mock("./tn-ws", () => {
  const { jest: mockApi } = require("@jest/globals");
  return { connectWs: mockApi.fn() };
});
jestObject.mock("./logger", () => {
  const { jest: mockApi } = require("@jest/globals");
  return { Logger: mockApi.fn(() => ({ debug: mockApi.fn(), info: mockApi.fn(), warn: mockApi.fn(), error: mockApi.fn() })) };
});

const { connectWs } = require("./tn-ws");
const { TrueNASClient } = require("./truenas-rpc");
const originalKey = process.env.TRUENAS_API_KEY;

beforeEach(() => {
  delete process.env.TRUENAS_API_KEY;
  jestObject.useFakeTimers();
  jestObject.clearAllMocks();
});

afterEach(() => {
  jestObject.useRealTimers();
  if (originalKey === undefined) delete process.env.TRUENAS_API_KEY;
  else process.env.TRUENAS_API_KEY = originalKey;
});

describe("TrueNAS RPC availability", () => {
  test("does not report a failed connection as successful empty data", async () => {
    connectWs.mockRejectedValue(new Error("connection timed out"));
    const client = new TrueNASClient({ apiKey: "test-only" });

    await expect(client.call("app.query")).rejects.toThrow("connection timed out");
    expect(client.connected).toBe(false);
    expect(client.clientType).toBe("unavailable");
    await expect(client.call("app.query")).rejects.toThrow("connection timed out");
    expect(connectWs).toHaveBeenCalledTimes(1);
  });

  test("recovers from a connection failure after the cooldown", async () => {
    connectWs.mockRejectedValueOnce(new Error("connection timed out"));
    connectWs.mockResolvedValue({ requestFn: async () => ["app"], closeFn: jestObject.fn(), isConnected: () => true });
    const client = new TrueNASClient({ apiKey: "test-only" });
    await expect(client.connect()).rejects.toThrow("connection timed out");
    await jestObject.advanceTimersByTimeAsync(60001);

    await expect(client.call("app.query")).resolves.toEqual(["app"]);
    expect(client.connected).toBe(true);
    expect(connectWs).toHaveBeenCalledTimes(2);
  });

  test("does not automatically retry a rejected API key", async () => {
    connectWs.mockRejectedValue(Object.assign(new Error("authentication rejected"), { code: "TRUENAS_AUTH_FAILED" }));
    const client = new TrueNASClient({ apiKey: "test-only" });
    await expect(client.connect()).rejects.toThrow("authentication rejected");
    await jestObject.advanceTimersByTimeAsync(3600000);
    client.close();

    await expect(client.connect()).rejects.toThrow("authentication rejected");
    expect(connectWs).toHaveBeenCalledTimes(1);
  });

  test("shares one in-flight connection and closes a late success after cancellation", async () => {
    let finish;
    connectWs.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const client = new TrueNASClient({ apiKey: "test-only" });
    const first = client.connect();
    const second = client.connect();
    const failures = Promise.all([
      expect(first).rejects.toThrow("cancelled"),
      expect(second).rejects.toThrow("cancelled"),
    ]);
    const closeFn = jestObject.fn();
    client.close();
    finish({ requestFn: jestObject.fn(), closeFn, isConnected: () => true });
    await failures;
    expect(connectWs).toHaveBeenCalledTimes(1);
    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(client.connected).toBe(false);
  });
});