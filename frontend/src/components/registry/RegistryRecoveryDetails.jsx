import React, { useEffect, useRef, useState } from "react";
import { Copy, Pencil, Save, X } from "lucide-react";
import { saveRegistryRecoveryNotes, saveRegistryPreferredStart } from "../../lib/api/serviceRegistry";
import { RegistryDetailSection } from "./RegistryDetailSection";

export function RegistryRecoveryDetails({ serviceId, recovery }) {
  const [saved, setSaved] = useState(recovery.notes || { text: "", version: 0 });
  const [draft, setDraft] = useState(recovery.notes?.text || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preferred, setPreferred] = useState(recovery.preferred || {
    command: "", cwd: "", version: 0, line: "",
  });
  const [editingStart, setEditingStart] = useState(false);
  const [draftLine, setDraftLine] = useState("");
  const [savingStart, setSavingStart] = useState(false);
  const lineInput = useRef(null);
  const automaticStart = (recovery.recipes || []).find(item =>
    item.type === "systemd-start" || item.type === "compose-up"
  );
  const preferredLine = preferred.line || automaticStart?.command || "";

  useEffect(() => {
    if (editingStart) {
      lineInput.current?.focus();
      lineInput.current?.select();
    }
  }, [editingStart]);

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

  async function savePreferredStart() {
    if (savingStart) return;
    setSavingStart(true);
    setMessage("");
    try {
      const result = await saveRegistryPreferredStart(serviceId,
        draftLine.trim(), "", preferred.version);
      setPreferred(result.preferred);
      setDraftLine(result.preferred.line || "");
      setEditingStart(false);
      setMessage("Preferred startup command saved.");
    } catch (error) {
      setMessage(error.message || "Could not save startup command; refresh service details.");
    } finally {
      setSavingStart(false);
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
    <RegistryDetailSection label="Recovery information" title="Recovery instructions">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Commands are suggestions to copy and review. Portracker never executes, starts or stops services.
      </p>
      <div data-recovery-command-group className="min-w-0 space-y-2">
        <h4 className="font-medium text-sm">One-line startup command</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {preferred.command ? "User supplied · unverified" : preferredLine
            ? automaticStart?.confidence + " · " + automaticStart?.hostScope + " (auto suggested)"
            : "Startup command unknown · enter a command explicitly"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {editingStart ? (
            <input ref={lineInput} aria-label="One-line startup command"
              value={draftLine} maxLength={2000}
              onChange={event => setDraftLine(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setEditingStart(false);
                  setMessage("");
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  savePreferredStart();
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 font-mono text-sm text-slate-900 dark:text-slate-100"
            />
          ) : preferredLine ? (
            <code data-testid="registry-start-command-text"
              className="block min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-sm text-slate-900 dark:text-slate-100 select-text">
              {preferredLine}
            </code>
          ) : (
            <span data-testid="registry-start-command-empty"
              className="min-w-0 flex-1 text-sm italic text-slate-500 dark:text-slate-400">
              No startup command saved. Select Edit command to add one.
            </span>
          )}
          <button type="button" disabled={!preferredLine || editingStart}
            onClick={() => copy(preferredLine)} aria-label="Copy start command"
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50">
            <Copy className="w-4 h-4" /> Copy
          </button>
          <button type="button" disabled={savingStart}
            onClick={() => {
              if (editingStart) savePreferredStart();
              else { setDraftLine(preferredLine); setEditingStart(true); setMessage(""); }
            }}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">
            {editingStart ? <Save className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            {savingStart ? "Saving…" : editingStart ? "Save command" : "Edit command"}
          </button>
          {editingStart && (
            <button type="button" disabled={savingStart}
              onClick={() => { setEditingStart(false); setMessage(""); }}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm">
              <X className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-400">
          The displayed read-only line is exactly what Copy copies. Review target host,
          permissions and environment before pasting. Do not store secrets or tokens.
        </p>
      </div>
      {saved.text && (
        <div data-recovery-saved-notes className="min-w-0 space-y-1 border-t border-slate-200/60 pt-3 dark:border-slate-700/60">
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
        <div key={item.type} data-recovery-recipe className="min-w-0 space-y-1 border-t border-slate-200/60 pt-3 dark:border-slate-700/60">
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
    </RegistryDetailSection>
  );
}
