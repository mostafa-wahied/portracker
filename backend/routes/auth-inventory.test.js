const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("@babel/parser");
const { describe, test, expect } = require("@jest/globals");

const backend = path.join(__dirname, "..");
const guards = new Set(["requireAuth", "requireAuthOrApiKey"]);
const publicRoutes = new Set([
  "GET /api/health", "GET /api/config", "GET /api/changelog", "GET /api/version",
  "GET /api/auth/status", "POST /api/auth/setup", "POST /api/auth/login", "POST /api/auth/logout",
]);
const mounts = { auth: "/api/auth", settings: "/api/settings", autoxpose: "/api/autoxpose" };

function calls(source) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee.type === "MemberExpression" &&
        ["app", "router"].includes(node.callee.object.name)) result.push(node);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  }
  visit(parse(source, { sourceType: "unambiguous" }));
  return result;
}

function inventory(indexSource) {
  const indexCalls = calls(indexSource);
  const protectedRouters = new Set();
  for (const item of indexCalls.filter(item => item.callee.property.name === "use")) {
    if (item.arguments.slice(1).some(argument => guards.has(argument.name))) protectedRouters.add(item.arguments[0]?.value);
  }
  const files = [["index", indexSource], ...fs.readdirSync(__dirname).filter(name => name.endsWith(".js") && !name.endsWith(".test.js")).map(name => [name.slice(0, -3), fs.readFileSync(path.join(__dirname, name), "utf8")])];
  const rows = [];
  for (const [file, source] of files) {
    for (const item of calls(source)) {
      const method = item.callee.property.name;
      if (!["get", "post", "put", "patch", "delete", "all", "head", "options"].includes(method)) continue;
      const route = item.arguments[0]?.value;
      if (route === "*") continue;
      if (typeof route !== "string") throw new Error("Nonliteral route requires an explicit inventory rule");
      const mount = item.callee.object.name === "router" ? mounts[file] : "";
      if (mount === undefined) throw new Error("Router mount missing from inventory");
      const full = mount + (route === "/" ? "" : route);
      if (!full.startsWith("/api/")) continue;
      const identity = method.toUpperCase() + " " + full;
      const protectedRoute = protectedRouters.has(mount) || item.arguments.slice(1).some(argument => guards.has(argument.name));
      if (!protectedRoute && !publicRoutes.has(identity)) throw new Error("Missing auth guard: " + identity);
      rows.push(identity);
    }
  }
  return rows;
}

describe("all API route authentication", () => {
  const source = fs.readFileSync(path.join(backend, "index.js"), "utf8");
  test("inventories every direct and mounted API route with explicit public exceptions", () => {
    const rows = inventory(source);
    expect(rows.length).toBeGreaterThan(40);
    expect(new Set(rows).size).toBe(rows.length);
    for (const route of publicRoutes) expect(rows).toContain(route);
    expect(rows).toContain("POST /api/servers/:id/generate-port");
    expect(rows).toContain("POST /api/auth/change-password");
  });

  test("fails if a route guard or a mounted-router guard is removed", () => {
    expect(() => inventory(source.replace('app.post("/api/servers/:id/generate-port", requireAuthOrApiKey,', 'app.post("/api/servers/:id/generate-port",'))).toThrow("Missing auth guard");
    expect(() => inventory(source.replace("app.use('/api/settings', requireAuth,", "app.use('/api/settings',"))).toThrow("Missing auth guard");
  });
});