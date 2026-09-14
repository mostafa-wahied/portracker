const fs = require('node:fs');
const assert = require('node:assert/strict');

try {
  const bytes = fs.readFileSync('/app/backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node');
  assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46');
  assert.equal(process.arch, process.env.EXPECTED_ARCH);
  assert.equal(bytes.readUInt16LE(18), process.arch === 'arm64' ? 183 : 62);
  const database = new (require('better-sqlite3'))(':memory:');
  database.exec('CREATE TABLE contract(value TEXT)');
  database.prepare('INSERT INTO contract VALUES (?)').run('ok');
  assert.equal(database.prepare('SELECT value FROM contract').get().value, 'ok');
  database.close();
  assert(!fs.existsSync('/app/backend/node_modules/.host-dependency-sentinel'));
  assert(!fs.existsSync('/app/backend/.secrets-contract'));
  process.stdout.write(JSON.stringify({ arch: process.arch, version: require('/app/package.json').version }));
} catch {
  process.stderr.write('Native contract failed\n');
  process.exitCode = 1;
}