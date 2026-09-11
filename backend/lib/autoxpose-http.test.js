const { EventEmitter } = require("events");
const { Readable } = require("stream");
const { describe, expect, test } = require("@jest/globals");
const { requestAutoxposeJson } = require("./autoxpose-http");

const publicLookup = async () => [
  { address: "2001:4860:4860::8888", family: 6 },
  { address: "8.8.8.8", family: 4 },
];

function makeResponse(statusCode, chunks) {
  const response = Readable.from(chunks);
  response.statusCode = statusCode;
  return response;
}

function makeRequest(responseFactory, capture) {
  return (target, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => {
      capture.target = target.toString();
      capture.options = options;
      callback(responseFactory());
    };
    return request;
  };
}

describe("requestAutoxposeJson", () => {
  test("pins the validated DNS address to the socket lookup", async () => {
    const capture = {};
    const request = makeRequest(
      () => makeResponse(200, [JSON.stringify({ status: "ok" })]),
      capture
    );

    await expect(
      requestAutoxposeJson("http://autoxpose.example:3000", "/health", {
        lookup: publicLookup,
        request,
      })
    ).resolves.toEqual({
      ok: true,
      status: 200,
      data: { status: "ok" },
      url: "http://autoxpose.example:3000",
    });

    const pinned = await new Promise((resolve, reject) => {
      capture.options.lookup("autoxpose.example", { all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    });
    expect(pinned).toEqual([
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ]);
    expect(capture.options.agent).toBe(false);
  });

  test("includes DNS resolution in the request deadline", async () => {
    const lookup = async () => new Promise(() => {});

    await expect(
      requestAutoxposeJson("http://autoxpose.example", "/health", {
        lookup,
        timeoutMs: 10,
      })
    ).rejects.toThrow("timed out");
  });

  test("rejects a JSON body above the configured byte limit", async () => {
    const request = makeRequest(
      () => makeResponse(200, [JSON.stringify({ value: "1234567890" })]),
      {}
    );

    await expect(
      requestAutoxposeJson("http://8.8.8.8", "/health", {
        maxResponseBytes: 8,
        request,
      })
    ).rejects.toThrow("exceeds");
  });

  test("times out when the response does not complete", async () => {
    const request = () => {
      const pending = new EventEmitter();
      pending.destroy = () => {};
      pending.end = () => {};
      return pending;
    };

    await expect(
      requestAutoxposeJson("http://8.8.8.8", "/health", {
        request,
        timeoutMs: 10,
      })
    ).rejects.toThrow("timed out");
  });

  test("returns redirects without following them", async () => {
    const request = makeRequest(() => makeResponse(302, []), {});

    await expect(
      requestAutoxposeJson("http://8.8.8.8", "/health", { request })
    ).resolves.toEqual({
      ok: false,
      status: 302,
      data: null,
      url: "http://8.8.8.8",
    });
  });
});