import React from "react";
import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";

const sslConfig = {
  active: {
    icon: ShieldCheck,
    color: "text-green-500",
    tooltip: "SSL Secured",
  },
  pending: {
    icon: ShieldAlert,
    color: "text-amber-500",
    tooltip: "SSL Pending",
  },
  error: {
    icon: ShieldOff,
    color: "text-red-500",
    tooltip: "SSL Error",
  },
  none: {
    icon: ShieldOff,
    color: "text-slate-400",
    tooltip: "HTTP Only",
  },
};

export function getSslTooltip(status) {
  return sslConfig[status]?.tooltip || sslConfig.none.tooltip;
}

export function SslIcon({ status = "none", className = "h-3 w-3" }) {
  const config = sslConfig[status] || sslConfig.none;
  const IconComponent = config.icon;
  return <IconComponent className={`${className} ${config.color}`} />;
}

export default SslIcon;
