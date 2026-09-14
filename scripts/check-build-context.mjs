import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portracker-context-'));
const image = `portracker-context:${process.pid}`;
const excluded = ['node_modules/sentinel', 'backend/node_modules/sentinel', 'frontend/node_modules/sentinel', 'backend/.secrets-contract', 'backend/.env.local', 'backend/data/sentinel.db', 'data/sentinel', 'frontend/dist/sentinel'];
const included = ['package.json', 'backend/package.json', 'backend/index.js', 'frontend/package.json', 'CHANGELOG.md', 'README.md'];
const source = `const fs=require('fs');for(const name of ${JSON.stringify(excluded)})if(fs.existsSync('/context/'+name))throw Error('CONTEXT_LEAK');for(const name of ${JSON.stringify(included)})if(!fs.existsSync('/context/'+name))throw Error('SOURCE_MISSING');`;
const dockerfile = `FROM node:22-slim\nCOPY . /context\nRUN node -e ${JSON.stringify(source)}\n`;
const build = () => spawnSync('docker', ['build', '--no-cache', '-t', image, '-f', '-', directory], { input: dockerfile, encoding: 'utf8', timeout: 180000, maxBuffer: 5000000 });
try {
  fs.copyFileSync(new URL('.dockerignore', root), path.join(directory, '.dockerignore'));
  const ignored = spawnSync('git', ['check-ignore', '.dockerignore'], { cwd: root, encoding: 'utf8' });
  assert.equal(ignored.status, 1, '.dockerignore must be commit-eligible');
  for (const name of [...excluded, ...included]) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), 'synthetic-build-context');
  }
  const clean = build();
  assert.equal(clean.status, 0, `Build context check failed: ${clean.error?.code || clean.status}`);
  fs.unlinkSync(path.join(directory, '.dockerignore'));
  const contaminated = build();
  assert.notEqual(contaminated.status, 0, 'Missing .dockerignore must fail the check');
  assert((contaminated.stdout + contaminated.stderr).includes('CONTEXT_LEAK'), 'Negative control failed for an unrelated reason');
  process.stdout.write('Build context isolation passed; removing exclusions was correctly rejected\n');
} finally {
  const cleanup = spawnSync('docker', ['image', 'rm', '-f', image], { encoding: 'utf8', timeout: 30000 });
  fs.rmSync(directory, { recursive: true, force: true });
  assert.equal(cleanup.status, 0, 'Build context image cleanup failed');
}