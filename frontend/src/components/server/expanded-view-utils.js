export const getDisplayHost = (port, serverId, serverUrl, hostOverride) => {
  if (port.host_ip === "0.0.0.0" || port.host_ip === "127.0.0.1") {
    if (serverId === "local") {
      return hostOverride || window.location.hostname;
    } else if (serverUrl) {
      try {
        return new URL(serverUrl).hostname;
      } catch {
        return "localhost";
      }
    }
    return "localhost";
  }
  return port.host_ip;
};
