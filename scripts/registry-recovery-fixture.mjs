export function registryRecoveryFixture(id, notes) {
  const item = notes.get(id) || { text: '', version: 0, updatedAt: null };
  const type = id === 'history-fixture-79' ? 'systemd-start' :
    id === 'history-fixture-78' ? 'compose-up' : null;
  const command = type === 'systemd-start'
    ? "'systemctl' '--user' 'start' 'dev.service'"
    : "'docker' 'compose' '-f' '/home/dev/demo/compose.yml' '-p' 'demo' 'up' '-d' 'web'";
  return { notes: item, recipes: type ? [{
    type, title: type === 'systemd-start' ? 'Start the observed systemd unit'
      : 'Suggested Docker Compose recovery',
    confidence: 'unverified', hostScope: type === 'compose-up' ? 'docker-host' : 'linux-host',
    caveats: ['Review before running'], command,
  }] : [] };
}

export function applyRegistryFixtureNote(req, suffix, notes) {
  const id = suffix.split('/')[1];
  const body = req.postDataJSON();
  const current = notes.get(id) || { text: '', version: 0 };
  if (body.version !== current.version) {
    return { status: 409, body: { error: 'Notes conflict' } };
  }
  const saved = { text: body.notes, version: current.version + 1, updatedAt: 1730000000000 };
  notes.set(id, saved);
  return { status: 200, body: { notes: saved } };
}

