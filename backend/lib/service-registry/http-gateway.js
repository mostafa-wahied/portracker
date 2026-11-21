'use strict';

const fs = require('node:fs');
const net = require('node:net');

// Linux /proc/net/route encodes IPv4 gateways in little-endian hexadecimal.
// Use ONLY a live default route, never a guessed 172.17.0.1 or a DNS alias.
// A tied route metric with different gateways is ambiguous and must fail shut.
function parseDockerGateway(table) {
  if (typeof table !== 'string' || table.length > 32768) return null;
  const choices = [];
  for (const line of table.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 11 || cols[1] !== '00000000' || cols[7] !== '00000000' ||
        !/^[0-9a-fA-F]{8}$/.test(cols[2]) || !/^[0-9a-fA-F]+$/.test(cols[3]) ||
        !/^\d+$/.test(cols[6])) continue;
    const flags = parseInt(cols[3], 16);
    if ((flags & 3) !== 3) continue; // RT_UP and RT_GATEWAY
    const raw = cols[2];
    const ip = [6, 4, 2, 0].map(index => parseInt(raw.slice(index, index + 2), 16)).join('.');
    if (net.isIP(ip) !== 4 || ip === '0.0.0.0') continue;
    const metric = Number(cols[6]);
    if (!Number.isSafeInteger(metric)) continue;
    choices.push({ ip, metric });
  }
  choices.sort((a, b) => a.metric - b.metric);
  if (!choices.length) return null;
  if (choices.some(other => other.metric === choices[0].metric && other.ip !== choices[0].ip)) {
    return null;
  }
  return choices[0].ip;
}

function detectDockerGateway({ readFile = fs.readFileSync, path = '/proc/net/route' } = {}) {
  try { return parseDockerGateway(readFile(path, 'utf8')); }
  catch { return null; }
}

module.exports = { parseDockerGateway, detectDockerGateway };
