import React from "react";
import { Code2, Container, Server, TerminalSquare } from "lucide-react";
import { registryIconKind } from "../../lib/registry-icon-fallback.mjs";

const GLYPHS = {
  editor: { Icon: Code2, label: "Generic code editor icon, not a verified favicon" },
  terminal: { Icon: TerminalSquare, label: "Generic terminal icon, not a verified favicon" },
  container: { Icon: Container, label: "Generic Docker service icon, not a verified favicon" },
  server: { Icon: Server, label: "Generic native service icon, not a verified favicon" },
};

export function RegistryServiceIcon({ iconHash, name, source = "system", size = 24 }) {
  const { Icon, label } = GLYPHS[registryIconKind(name, source)];
  if (iconHash && /^[a-f0-9]{64}$/.test(iconHash)) {
    return <img alt="" title="Verified cached site favicon" loading="lazy"
      width={size} height={size} className="shrink-0 object-contain"
      src={"/api/service-registry/icons/" + iconHash} />;
  }
  return <Icon aria-hidden="true" title={label} size={size}
    className={"shrink-0 " + (source === "docker" ? "text-blue-500" : "text-slate-500")} />;
}
