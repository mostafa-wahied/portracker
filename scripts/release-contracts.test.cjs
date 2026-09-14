const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/docker-publish.yml'), 'utf8'));
const tagger = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/auto-tag.yml'), 'utf8'));
const steps = workflow.jobs['build-and-push'].steps;
const find = name => steps.find(step => step.name === name);
const sourceSha = '1'.repeat(40);
const otherSha = '2'.repeat(40);
const defaults = { WORKFLOW_REF: 'refs/heads/main', RELEASE_TAG: 'v1.3.11', EXPECTED_SHA: sourceSha, EVENT_NAME: 'workflow_dispatch', REF_NAME: 'v1.3.11', REF_TYPE: 'tag', GITHUB_OUTPUT: 'outputs', SOURCE_SHA: sourceSha };

function execute(name, env = {}, values = {}) {
  const code = find(name).run.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)[1];
  const outputs = {};
  const exited = {};
  const git = (executable, args) => {
    assert.equal(executable, 'git');
    if (args.join(' ') === 'rev-parse HEAD') return `${sourceSha}\n`;
    if (args[0] === 'rev-parse') return `${values.tagSha || sourceSha}\n`;
    assert.equal(args[0], 'ls-remote');
    return values.refs === undefined ? `${sourceSha}\trefs/tags/v1.3.10\n${sourceSha}\trefs/tags/v1.3.11\n` : values.refs;
  };
  const requireFixture = name => {
    if (name === 'node:assert/strict') return assert;
    if (name === 'node:child_process') return { execFileSync: git };
    if (name === 'node:fs') return {
      readFileSync: file => { assert.equal(file, 'package.json'); return JSON.stringify({ version: values.version || '1.3.11' }); },
      appendFileSync: (file, text) => { assert.equal(file, 'outputs'); Object.assign(outputs, Object.fromEntries(text.trim().split('\n').map(line => line.split('=')))); },
    };
    throw new Error('Unexpected module');
  };
  try {
    vm.runInNewContext(code, { require: requireFixture, process: { env: { ...defaults, ...env }, exit: code => { assert.equal(code, 0); throw exited; } } }, { timeout: 1000 });
  } catch (error) { if (error !== exited) throw error; }
  return outputs;
}

test('automatic tagging cannot accidentally push with the default workflow credential', () => {
  const checkout = tagger.jobs['auto-tag'].steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with.token, '${{ github.token }}');
});
test('recovery rejects unreviewed refs and malformed tag or SHA inputs', () => {
  execute('Validate recovery request');
  for (const change of [{ WORKFLOW_REF: 'refs/heads/unreviewed' }, { WORKFLOW_REF: 'refs/tags/v1.3.11' }, { RELEASE_TAG: 'main' }, { RELEASE_TAG: 'v1.3.11\nother' }, { RELEASE_TAG: 'v1.3.11;echo test' }, { EXPECTED_SHA: 'HEAD' }, { EXPECTED_SHA: '' }]) assert.throws(() => execute('Validate recovery request', change));
});
test('release source must match tag, approved SHA, and package version', () => {
  assert.equal(execute('Verify release source').sha, sourceSha);
  assert.throws(() => execute('Verify release source', {}, { tagSha: otherSha }));
  assert.throws(() => execute('Verify release source', { EXPECTED_SHA: otherSha }));
  assert.throws(() => execute('Verify release source', {}, { version: '1.3.10' }));
  assert.equal(execute('Verify release source', { EVENT_NAME: 'push', EXPECTED_SHA: '' }).sha, sourceSha);
});
test('PR and main source checks record their actual checkout without becoming releases', () => {
  for (const EVENT_NAME of ['push', 'pull_request']) {
    assert.equal(execute('Verify release source', { EVENT_NAME, REF_TYPE: 'branch', REF_NAME: 'main', EXPECTED_SHA: '' }).sha, sourceSha);
    assert.deepEqual(execute('Determine release metadata', { EVENT_NAME, REF_TYPE: 'branch', REF_NAME: 'main' }), { is_release: 'false', is_latest: 'false' });
  }
});
test('older releases cannot take latest aliases', () => {
  assert.deepEqual(execute('Determine release metadata'), { is_release: 'true', is_latest: 'true', tag: 'v1.3.11', version: '1.3.11', previous_version: '1.3.10' });
  assert.equal(execute('Determine release metadata', {}, { refs: `${sourceSha}\trefs/tags/v1.3.11\n${otherSha}\trefs/tags/v1.3.12\n` }).is_latest, 'false');
});
test('publication rejects deleted and moved annotated or lightweight tags', () => {
  execute('Publish verified Docker tags', {}, { refs: `${otherSha}\trefs/tags/v1.3.11\n${sourceSha}\trefs/tags/v1.3.11^{}\n` });
  execute('Publish verified Docker tags', {}, { refs: `${sourceSha}\trefs/tags/v1.3.11\n` });
  for (const refs of ['', `${otherSha}\trefs/tags/v1.3.11\n`, `${otherSha}\trefs/tags/v1.3.11\n${otherSha}\trefs/tags/v1.3.11^{}\n`]) assert.throws(() => execute('Publish verified Docker tags', {}, { refs }));
});
test('source, tag and dispatch identity remain consistent throughout publication', () => {
  assert.equal(find('Checkout repository').with.ref, '${{ inputs.release_tag || github.ref }}');
  assert(find('Extract metadata (tags, labels) for Docker').with.labels.includes('org.opencontainers.image.revision=${{ steps.source.outputs.sha }}'));
  assert.equal(find('Create GitHub Release').with.tag_name, '${{ steps.release.outputs.tag }}');
  assert(workflow.concurrency.group.includes('inputs.release_tag || github.ref_name'));
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});
test('both PR architectures build and both exact candidate platforms run before promotion', () => {
  assert.equal(find('Build pull request image').with.platforms, 'linux/amd64');
  assert.equal(find('Build ARM64 pull request image').with.platforms, 'linux/arm64');
  for (const name of ['Build pull request image', 'Build ARM64 pull request image']) assert.equal(find(name).with.push, false);
  assert.equal(find('Build and push Docker candidate').with.platforms, 'linux/amd64,linux/arm64');
  const command = find('Test Docker image').run;
  assert(command.includes('set -euo pipefail'));
  assert(command.includes('for architecture in amd64 arm64'));
  assert(command.includes('${REGISTRY_IMAGE}@${IMAGE_DIGEST}'));
  assert(command.includes('npm run test:image -- "$TEST_IMAGE" "linux/$architecture"'));
  assert.equal(find('Test Docker image').if, undefined);
  assert.equal(find('Test Docker image')['continue-on-error'], undefined);
  assert(steps.indexOf(find('Test Docker image')) < steps.indexOf(find('Publish verified Docker tags')));
  assert(steps.indexOf(find('Generate release notes')) < steps.indexOf(find('Publish verified Docker tags')));
  assert(steps.indexOf(find('Publish verified Docker tags')) < steps.indexOf(find('Create GitHub Release')));
});
test('validation and failure evidence cannot silently disappear', () => {
  for (const command of ['npm ci', 'npm ci --prefix backend', 'npm run lint', 'npm test -- --runInBand', 'npm run test:release', 'npx playwright install --with-deps chromium']) assert(find('Validate source').run.includes(command));
  assert.equal(find('Verify build context isolation').run.trim(), 'npm run test:context');
  assert.equal(find('Retain regression evidence').if, 'always()');
  assert.equal(find('Retain regression evidence').with['if-no-files-found'], 'error');
  assert.equal(find('Publish verified Docker tags').if, "github.event_name != 'pull_request'");
  assert.equal(find('Create GitHub Release').if, "steps.release.outputs.is_release == 'true'");
});
test('every workflow shell block parses without executing network operations', () => {
  for (const document of [workflow, tagger]) for (const job of Object.values(document.jobs)) for (const step of job.steps.filter(step => step.run)) execFileSync('bash', ['-n'], { input: step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'placeholder') });
});