export function inferComposeProjectFor(port, knownComposeProjects) {
  if (port.compose_project || port.source !== "docker") return port.compose_project || null;
  const owner = port.owner || "";
  if (!/-\d+$/.test(owner)) return null;
  return knownComposeProjects.find((project) => owner.startsWith(`${project}-`)) || null;
}

export function collectKnownComposeProjects(ports) {
  return Array.from(new Set(ports.map((port) => port.compose_project).filter(Boolean)))
    .sort((a, b) => b.length - a.length);
}
