import React from "react";

export function RegistryDetailSection({ title, label = title, children }) {
  return (
    <section aria-label={label}
      className="min-w-0 space-y-2 border-t border-slate-200/70 pt-4 dark:border-slate-700/70">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {children}
    </section>
  );
}
