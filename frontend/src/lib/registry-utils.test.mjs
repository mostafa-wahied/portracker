import test from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_SIZE, parseRegistryPortFilter, parseRegistryPortPrefix, registryPageCount,
  registryStatusLabel, registryTimestamp,
} from "./registry-utils.mjs";

test("history page sizes and bounds are stable", () => {
  assert.equal(PAGE_SIZE, 24);
  assert.equal(registryPageCount(0), 1);
  assert.equal(registryPageCount(24), 1);
  assert.equal(registryPageCount(25), 2);
  assert.equal(registryPageCount(101), 5);
});

test("port search accepts only real TCP ports", () => {
  assert.equal(parseRegistryPortFilter("3000"), 3000);
  assert.equal(parseRegistryPortFilter(" 443 "), 443);
  assert.equal(parseRegistryPortFilter(""), null);
  for (const value of ["0", "65536", "999999", "3000 OR 1=1", "abc"]) {
    assert.equal(parseRegistryPortFilter(value), null);
  }
});

test("port prefix allows partial numeric input while retaining exact-port parser", () => {
  for (const prefix of ["4", "41", "417", "4177", "65", "65535"]) {
    assert.equal(parseRegistryPortPrefix(prefix), prefix);
  }
  assert.equal(parseRegistryPortPrefix(" 41 "), "41");
  assert.equal(parseRegistryPortPrefix(""), null);
  for (const bad of ["0", "041", "65536", "99999", "123456", "abc", "4%"]) {
    assert.equal(parseRegistryPortPrefix(bad), null);
  }
});

test("history statuses and timestamps never invent an offline state", () => {
  assert.equal(registryStatusLabel("listening"), "Listening");
  assert.equal(registryStatusLabel("offline"), "Offline");
  assert.equal(registryStatusLabel("unknown"), "Unknown");
  assert.equal(registryStatusLabel("unrecognized"), "Unknown");
  assert.equal(registryTimestamp(null), "Unknown");
  assert.equal(registryTimestamp("not-a-time"), "Unknown");
  assert.notEqual(registryTimestamp(1730000000000), "Unknown");
});
