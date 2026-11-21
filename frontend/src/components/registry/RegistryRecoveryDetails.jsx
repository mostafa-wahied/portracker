import React, { useState } from "react";
import { Copy, Save } from "lucide-react";
import { saveRegistryRecoveryNotes } from "../../lib/api/serviceRegistry";

export function RegistryRecoveryDetails({ serviceId, recovery }) {
  const [saved, setSaved] = useState(recovery.notes || { text: "", version: 0 });
  const [draft, setDraft] = useState(recovery.notes?.text || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await saveRegistryRecoveryNotes(serviceId, draft, saved.version);
      setSaved(result.notes);
      setMessage("Recovery notes saved.");
    } catch (error) {
      setMessage(error.message || "Could not save notes; refresh service details.");
    } finally {
      setSaving(false);
    }
  }

  async function copy(command) {
    try {
      await navigator.clipboard.writeText(command);
      setMessage("Command copied. Review it before running on the correct host.");
    } catch {
      setMessage("Copy failed; select and copy the displayed command manually.");
    }
  }

  return (
    <section aria-label="Recovery information" className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <h3 className="font-medium text-sm">Recovery instructions</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Commands below are historical suggestions to copy and review.
        Portracker does not execute, start, or stop services.
      </p>
      {saved.text && (
        <div className="rounded-md border border-indigo-200 dark:border-indigo-800 p-3">
          <p className="text-xs font-medium">My saved instructions (preferred)</p>
          <pre className="text-sm whitespace-pre-wrap break-all font-sans">{saved.text}</pre>
        </div>
      )}
      {!recovery.recipes?.length && (
        <p className="text-sm text-slate-500">
          No safe automatic startup command can be inferred from the available evidence.
          Save your own instructions below.
        </p>
      )}
      {(recovery.recipes || []).map(item => (
        <div key={item.type} className="space-y-1 rounded-md bg-slate-50 dark:bg-slate-800 p-3">
          <p className="text-sm font-medium">{item.title}</p>
          <p className="text-xs text-slate-500">{item.confidence} · {item.hostScope}</p>
          <code className="block text-sm whitespace-pre-wrap break-all select-text">{item.command}</code>
          <button type="button" onClick={() => copy(item.command)}
            className="inline-flex gap-2 items-center rounded border px-2 py-1 text-sm">
            <Copy className="w-3.5 h-3.5" /> Copy command
          </button>
          {item.caveats?.map(caveat => (
            <p key={caveat} className="text-xs text-amber-700 dark:text-amber-400">{caveat}</p>
          ))}
        </div>
      ))}
      <label className="block space-y-1 text-sm">
        <span className="font-medium">My recovery notes (plain text, not executed)</span>
        <textarea aria-label="My recovery notes" value={draft} maxLength={4000} rows={4}
          onChange={event => { setDraft(event.target.value); setMessage(""); }}
          className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-sm"
          placeholder="e.g. Start in /my/project with pnpm dev; requires nix develop" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving || draft === saved.text}
          className="inline-flex gap-2 items-center rounded-md bg-indigo-600 text-white px-3 py-2 text-sm disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save notes"}
        </button>
        <span role="status" className="text-xs text-slate-600 dark:text-slate-300">{message}</span>
      </div>
    </section>
  );
}
