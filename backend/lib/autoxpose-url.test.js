const { describe, expect, test } = require("@jest/globals");
const {
  buildAutoxposeEndpoint,
  isBlockedAddress,
  validateAutoxposeUrl,
} = require("./autoxpose-url");

const privateLookup = async () => [
  { address: "192.168.1.25", family: 4 },
];

describe("validateAutoxposeUrl", () => {
  test("accepts and normalizes private network destinations", async () => {
    await expect(
      validateAutoxposeUrl("http://autoxpose.local:3000/base///", {
        lookup: privateLookup,
      })
    ).resolves.toBe("http://autoxpose.local:3000/base");

    await expect(
      validateAutoxposeUrl("http://192.168.1.25:3000/")
    ).resolves.toBe("http://192.168.1.25:3000");
  });

  test.each([
    "file:///etc/hosts",
    "ftp://autoxpose.local",
    "http://user:password@autoxpose.local",
    "http://autoxpose.local/path?target=other",
    "http://autoxpose.local/path#fragment",
  ])("rejects unsafe URL forms: %s", async (url) => {
    await expect(
      validateAutoxposeUrl(url, { lookup: privateLookup })
    ).rejects.toThrow();
  });

  test("rejects destinations that resolve to blocked addresses", async () => {
    const loopbackLookup = async () => [
      { address: "127.0.0.1", family: 4 },
    ];

    await expect(
      validateAutoxposeUrl("http://internal.example", {
        lookup: loopbackLookup,
      })
    ).rejects.toThrow("not allowed");
    await expect(
      validateAutoxposeUrl("http://169.254.169.254/latest")
    ).rejects.toThrow("not allowed");
  });

  test("rejects a hostname when any resolved address is blocked", async () => {
    const mixedLookup = async () => [
      { address: "192.168.1.25", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];

    await expect(
      validateAutoxposeUrl("http://mixed.example", { lookup: mixedLookup })
    ).rejects.toThrow("not allowed");
  });
});

describe("isBlockedAddress", () => {
  test.each([
    "0.0.0.0",
    "127.0.0.1",
    "169.254.1.1",
    "192.88.99.1",
    "::",
    "::1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "fe80::1",
  ])(
    "blocks %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    }
  );

  test.each(["10.0.0.1", "172.16.0.1", "192.168.1.1", "100.64.0.1", "fd00::1"])(
    "allows homelab address %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );
});

describe("buildAutoxposeEndpoint", () => {
  test("appends endpoints beneath a configured base path", () => {
    expect(
      buildAutoxposeEndpoint("http://autoxpose.local:3000/base", "/health")
    ).toBe("http://autoxpose.local:3000/base/health");
  });
});