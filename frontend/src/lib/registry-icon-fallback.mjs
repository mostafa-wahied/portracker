export function registryIconKind(name, source = 'system') {
  const token = String(name || '').toLowerCase().replace(/[_\s]+/g, '-');
  if (/(^|-)(vscode|vs-code|code-server|openvscode-server|visual-studio-code)(-|$)/.test(token)) {
    return 'editor';
  }
  if (/(^|-)hermes(-|$)/.test(token)) return 'terminal';
  return source === 'docker' ? 'container' : 'server';
}
