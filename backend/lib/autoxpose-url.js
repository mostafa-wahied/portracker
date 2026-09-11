const dns = require("dns").promises;
const net = require("net");

const blockedAddresses = new net.BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::", 96],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
]) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function cleanAddress(address) {
  return String(address || "")
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
}

function isBlockedAddress(address) {
  const clean = cleanAddress(address);
  const family = net.isIP(clean);
  if (family === 4) {
    return blockedAddresses.check(clean, "ipv4");
  }
  if (family === 6) {
    if (clean.toLowerCase().startsWith("::ffff:")) {
      return true;
    }
    return blockedAddresses.check(clean, "ipv6");
  }
  return true;
}

function normalizeUrl(parsed) {
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

async function resolveAddresses(hostname, lookup) {
  const clean = cleanAddress(hostname);
  const family = net.isIP(clean);
  if (family) {
    return [{ address: clean, family }];
  }

  const records = await lookup(clean, { all: true, verbatim: true });
  const addresses = Array.isArray(records) ? records : [records];
  if (!addresses.length) {
    throw new Error("Autoxpose URL hostname did not resolve");
  }
  return addresses;
}

async function resolveAutoxposeUrl(value, options = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Autoxpose URL is required");
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Autoxpose URL is invalid");
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("Autoxpose URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Autoxpose URL cannot include credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Autoxpose URL cannot include a query or fragment");
  }

  const lookup = options.lookup || dns.lookup;
  const addresses = await resolveAddresses(parsed.hostname, lookup);
  const normalizedAddresses = addresses.map(({ address }) => {
    const clean = cleanAddress(address);
    const family = net.isIP(clean);
    if (!family) {
      throw new Error("Autoxpose URL hostname returned an invalid address");
    }
    return { address: clean, family };
  });
  if (normalizedAddresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("Autoxpose URL resolves to an address that is not allowed");
  }

  return {
    url: normalizeUrl(parsed),
    addresses: normalizedAddresses,
  };
}

async function validateAutoxposeUrl(value, options = {}) {
  const resolution = await resolveAutoxposeUrl(value, options);
  return resolution.url;
}

function buildAutoxposeEndpoint(baseUrl, endpoint) {
  const base = `${String(baseUrl).replace(/\/+$/, "")}/`;
  const relative = String(endpoint || "").replace(/^\/+/, "");
  return new URL(relative, base).toString();
}

module.exports = {
  buildAutoxposeEndpoint,
  isBlockedAddress,
  resolveAutoxposeUrl,
  validateAutoxposeUrl,
};