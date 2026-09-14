const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");
const express = require("express");
const { describe, test, expect } = require("@jest/globals");
const { operationLimit } = require("../middleware/operation-limits");

describe("additional report boundaries", () => {
  test("limits repeated operations before the handler and supplies Retry-After", async () => {
    const app = express();
    let calls = 0;
    app.get("/operation", operationLimit(2), (_request, response) => { calls += 1; response.json({ ok: true }); });
    const server = app.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const url = `http://127.0.0.1:${server.address().port}/operation`;
      expect((await fetch(url)).status).toBe(200);
      expect((await fetch(url)).status).toBe(200);
      const blocked = await fetch(url, { headers: { "X-Forwarded-For": "192.0.2.1" } });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(calls).toBe(2);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });

  test("both external link sinks use HTTP-only URL validation", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../frontend/src/lib/external-url.js"), "utf8");
    const safe = vm.runInNewContext(source.replace("export function", "function") + "\nsafeExternalUrl", { URL });
    for (const value of ["javascript:alert(1)", "java\nscript:alert(1)", "data:text/html,fixture", "//other.invalid", "file:///tmp/fixture", "https://user:synthetic@host.invalid", "invalid"]) expect(safe(value)).toBeUndefined();
    for (const value of ["http://192.168.1.1:8080/", "https://peer.invalid/path?q=1#section"]) expect(safe(value)).toBe(value);
    for (const component of ["ExternalUrlChip", "GlobeIconBadge"]) {
      const content = fs.readFileSync(path.join(__dirname, `../../frontend/src/components/autoxpose/${component}.jsx`), "utf8");
      expect(content).toContain("const href = safeExternalUrl(url)");
      expect(content).toContain("if (!href) return null");
      expect(content).toContain("href={href}");
      expect(content).not.toContain("href={url}");
    }
  });
});