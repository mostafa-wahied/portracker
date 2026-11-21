import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registryIconKind } from './registry-icon-fallback.mjs';

test('Hermes and VS Code variants get local generic glyphs without network URLs', () => {
  for (const name of ['Hermes', 'hermes_agent', 'hermes-dev']) {
    assert.equal(registryIconKind(name, 'system'), 'terminal');
  }
  for (const name of ['vscode', 'VS Code', 'code-server', 'openvscode-server',
    'visual-studio-code', 'vscode_web']) {
    assert.equal(registryIconKind(name, 'docker'), 'editor');
  }
  assert.equal(registryIconKind('supabase_studio_buildpro', 'docker'), 'container');
  assert.equal(registryIconKind('unknown daemon', 'system'), 'server');
});
