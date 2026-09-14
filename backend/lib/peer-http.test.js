const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { describe, test, expect, jest: jestObject, afterEach } = require("@jest/globals");
const { requestPeer, validatePeerUrl } = require("./peer-http");

const originalLimit = process.env.PEER_MAX_RESPONSE_BYTES;
afterEach(() => {
  if (originalLimit === undefined) delete process.env.PEER_MAX_RESPONSE_BYTES;
  else process.env.PEER_MAX_RESPONSE_BYTES = originalLimit;
});

function fixtureResponse(status = 200, body = { ports: [], echo: "synthetic-error-key" }) {
  const calls = [];
  const request = (url, options, callback) => {
    calls.push({ url, options });
    const outgoing = new EventEmitter();
    outgoing.destroy = () => {};
    outgoing.end = () => {
      const response = Readable.from([JSON.stringify(body)]);
      response.statusCode = status;
      callback(response);
    };
    return outgoing;
  };
  return { request, calls, lookup: async () => [{ address: "192.168.1.20", family: 4 }], openKey: () => "synthetic-peer-key" };
}

describe("peer request boundary", () => {
  test.each(["0", "-1", "invalid", "1.5", "Infinity"])("rejects an invalid peer budget %s before sending requests", async value => {
    process.env.PEER_MAX_RESPONSE_BYTES = value;
    const request = jestObject.fn();
    await expect(requestPeer({ url: "http://peer.invalid" }, "/api/version", { request })).rejects.toThrow("PEER_MAX_RESPONSE_BYTES must be");
    expect(request).not.toHaveBeenCalled();
  });

  test("accepts a valid peer inventory larger than the autoxpose budget", async () => {
    delete process.env.PEER_MAX_RESPONSE_BYTES;
    const body = { ports: Array.from({ length: 9600 }, (_, index) => ({
      source: "docker", host_ip: "0.0.0.0", host_port: 20000 + index % 80, protocol: "tcp", internal: true,
      container_id: `fixture-${Math.floor(index / 80)}-${"c".repeat(64)}`, owner: `fixture-service-${Math.floor(index / 80)}`,
      compose_project: "fixture-project", compose_service: "fixture-service", target: "fixture-container:20000(internal)", note: "ordinary saved note",
    })), applications: [] };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(2 * 1024 * 1024);
    const response = await requestPeer({ url: "http://peer.invalid" }, "/api/servers/local/scan", fixtureResponse(200, body));
    expect(response.ok).toBe(true);
    expect((await response.json()).ports).toHaveLength(9600);
  });

  test("enforces the configured byte boundary with an actionable safe error", async () => {
    const body = { message: "synthetic-private-value" };
    const size = Buffer.byteLength(JSON.stringify(body));
    process.env.PEER_MAX_RESPONSE_BYTES = String(size);
    expect((await requestPeer({ url: "http://peer.invalid" }, "/api/version", fixtureResponse(200, body))).ok).toBe(true);
    process.env.PEER_MAX_RESPONSE_BYTES = String(size - 1);
    await expect(requestPeer({ url: "http://peer.invalid" }, "/api/version", fixtureResponse(200, body))).rejects.toMatchObject({
      code: "PEER_RESPONSE_TOO_LARGE", message: expect.stringContaining("PEER_MAX_RESPONSE_BYTES"),
    });
  });

  test.each(["http", "https"])("preserves private %s peers with pinned DNS and credentials", async scheme => {
    const fixture = fixtureResponse();
    const response = await requestPeer({ url: `${scheme}://peer.invalid/base`, remote_api_key: "encrypted" }, "/api/servers/local/generate-port", { ...fixture, method: "POST" });
    expect(response.status).toBe(200);
    expect(fixture.calls[0].url.pathname).toBe("/api/servers/local/generate-port");
    expect(fixture.calls[0].options.method).toBe("POST");
    expect(fixture.calls[0].options.headers["X-API-Key"]).toBe("synthetic-peer-key");
    expect(fixture.calls[0].options.rejectUnauthorized).not.toBe(false);
    const addresses = await new Promise(resolve => fixture.calls[0].options.lookup("peer.invalid", { all: true }, (_error, answer) => resolve(answer)));
    expect(addresses).toEqual([{ address: "192.168.1.20", family: 4 }]);
  });

  test.each(["127.0.0.1", "169.254.169.254", "::1", "::ffff:169.254.169.254"])("refuses resolved %s before sending a credential", async address => {
    const request = jestObject.fn();
    await expect(requestPeer({ url: "http://peer.invalid", remote_api_key: "encrypted" }, "/api/version", {
      request, openKey: () => "synthetic-peer-key", lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
    })).rejects.toThrow("Peer request failed");
    expect(request).not.toHaveBeenCalled();
  });

  test.each([301, 302, 307, 308, 401, 500])("does not follow or reflect status %i", async status => {
    const fixture = fixtureResponse(status);
    const response = await requestPeer({ url: "http://peer.invalid" }, "/api/version", fixture);
    expect(response.ok).toBe(false);
    expect(await response.text()).not.toContain("synthetic-error-key");
    expect(await response.json()).toBeNull();
    expect(fixture.calls).toHaveLength(1);
  });

  test.each(["ftp://peer.invalid", "http://user:synthetic@peer.invalid", "http://peer.invalid/?x=1", "http://peer.invalid/#x", "http://peer.invalid\\other", "http://peer.invalid\n"])("rejects unsafe configuration %s", url => {
    expect(() => validatePeerUrl(url)).toThrow();
  });
});