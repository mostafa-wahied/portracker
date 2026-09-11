const { describe, expect, test } = require("@jest/globals");
const { AutoxposeClient } = require("./autoxpose-client");
const { validateAutoxposeUrl } = require("./autoxpose-url");

const privateLookup = async () => [
  { address: "192.168.1.25", family: 4 },
];

function jsonResponse(body, status = 200, url = "http://192.168.1.25:3000") {
  return {
    ok: status >= 200 && status < 300,
    status,
    data: body,
    url,
  };
}

test("uses a positive retry interval when configured TTL is invalid", () => {
  const client = new AutoxposeClient(null, { restoreRetryMs: 0 });

  expect(client.restoreRetryMs).toBeGreaterThan(0);
});

describe("AutoxposeClient connection safety", () => {
  test("commits a normalized URL only after a successful probe", async () => {
    const requests = [];
    const client = new AutoxposeClient("http://192.168.1.10:3000", {
      lookup: privateLookup,
      requestJson: async (baseUrl, endpoint, options) => {
        requests.push({ baseUrl, endpoint, options });
        return jsonResponse(
          { status: "ok", version: "1.2.3" },
          200,
          "http://autoxpose.local:3000"
        );
      },
    });

    const result = await client.connect("http://autoxpose.local:3000///");

    expect(result).toEqual({ success: true });
    expect(client.getStatus()).toEqual(
      expect.objectContaining({
        configured: true,
        connected: true,
        url: "http://autoxpose.local:3000",
      })
    );
    expect(requests).toEqual([
      expect.objectContaining({
        baseUrl: "http://autoxpose.local:3000///",
        endpoint: "/health",
      }),
    ]);
  });

  test("preserves the active URL when a candidate probe fails", async () => {
    const client = new AutoxposeClient("http://192.168.1.10:3000", {
      requestJson: async () => jsonResponse({ status: "error" }, 503),
    });

    const result = await client.connect("http://192.168.1.11:3000");

    expect(result).toEqual({ success: false, error: "HTTP 503" });
    expect(client.getStatus().url).toBe("http://192.168.1.10:3000");
  });

  test("clears target-specific domain state after a successful switch", async () => {
    const client = new AutoxposeClient("http://192.168.1.10:3000", {
      requestJson: async () => jsonResponse({ status: "ok" }),
    });
    client.domain = "old.example";

    await client.connect("http://192.168.1.25:3000");

    expect(client.domain).toBeNull();
  });

  test("does not follow redirects from a candidate destination", async () => {
    const requests = [];
    const client = new AutoxposeClient(null, {
      requestJson: async (baseUrl, endpoint) => {
        requests.push({ baseUrl, endpoint });
        return jsonResponse({}, 302);
      },
    });

    const result = await client.connect("http://192.168.1.25:3000");

    expect(result).toEqual({ success: false, error: "HTTP 302" });
    expect(client.getStatus().configured).toBe(false);
    expect(requests).toHaveLength(1);
  });
});

describe("AutoxposeClient restoration safety", () => {
  test("rejects an unsafe persisted URL without fetching it", async () => {
    let fetchCount = 0;
    const client = new AutoxposeClient(null, {
      requestJson: async (baseUrl) => {
        await validateAutoxposeUrl(baseUrl);
        fetchCount += 1;
        return jsonResponse({ status: "ok" });
      },
      settingsManager: {
        getAutoxposeConnection: () => ({ url: "http://127.0.0.1:9099" }),
      },
    });

    await client.initialize();

    expect(fetchCount).toBe(0);
    expect(client.getStatus().configured).toBe(false);
  });

  test("restores a validated trusted connection", async () => {
    let fetchCount = 0;
    const client = new AutoxposeClient(null, {
      requestJson: async () => {
        fetchCount += 1;
        return jsonResponse({ status: "ok", version: "1.2.3" });
      },
      settingsManager: {
        getAutoxposeConnection: () => ({ url: "http://192.168.1.25:3000" }),
      },
    });

    await client.initialize();

    expect(fetchCount).toBe(1);
    expect(client.getStatus()).toEqual(
      expect.objectContaining({ configured: true, connected: true })
    );
  });

  test("retries a transient restore failure", async () => {
    let requestCount = 0;
    let now = 1000;
    const client = new AutoxposeClient(null, {
      now: () => now,
      requestJson: async () => {
        requestCount += 1;
        if (requestCount === 1) {
          throw new Error("temporary failure");
        }
        return jsonResponse({ status: "ok" });
      },
      settingsManager: {
        getAutoxposeConnection: () => ({ url: "http://192.168.1.25:3000" }),
      },
    });

    await client.initialize();
    expect(client.getStatus()).toEqual(
      expect.objectContaining({ connected: false, error: "temporary failure" })
    );

    await client.initialize();
    expect(requestCount).toBe(1);

    now += 30000;
    await client.initialize();
    expect(requestCount).toBe(2);
    expect(client.getStatus()).toEqual(
      expect.objectContaining({ connected: true, error: null })
    );
  });
});