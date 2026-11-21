# Recovery hints and personal instructions (upstream issue #136)

Portracker can show **copy-only** recovery suggestions for services it observed
previously, and remember user-authored notes even after the process stops.
Nothing in this feature executes a command, starts or stops a service, or
modifies Docker, systemd or NixOS configuration.

## Opt in securely

```env
ENABLE_AUTH=true
SERVICE_REGISTRY_RECOVERY_ENABLED=true
```

Recovery notes and hints are intentionally disabled if the global Portracker
authentication setting is off, even if the recovery flag is requested. Previously
saved paths, notes and suggestions are not returned to unauthenticated clients.
The history list never contains private recovery data. Restart the backend
after changing configuration.

For more useful automatic hints you may separately enable the opt-in discovery
and Linux/Docker provenance features:

```env
SERVICE_REGISTRY_ENABLED=true
SERVICE_REGISTRY_PROVENANCE_ENABLED=true
SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED=true
```

**Do not save tokens, passwords or private credentials in manual recovery notes.**
Text is stored in Portracker's SQLite database. Each note belongs to a
**specific historical service ID**, not an IP address or port; if another app
takes the same port, it will not inherit the previous app's notes.

## Automatic hints and confidence

- **systemd system units:** `systemctl start UNIT`, `systemctl status UNIT`,
  and `journalctl -u UNIT` are suggested only for a concrete unit observed
  directly from a Linux cgroup.
- **systemd user units:** the corresponding `systemctl --user` and
  `journalctl --user` variants are suggested for genuine user units.
  Interactive scopes and the `user@UID.service` manager do **not** become
  application startup commands.
- **Docker Compose:** when a project/service and one or more absolute Compose
  config paths were captured, Portracker suggests a copyable
  `docker compose --project-directory ... -f ... -p ... up -d SERVICE`.
  These paths are **historical Docker-host paths**. The files and current
  project are not verified; the suggested command is marked `unverified`.
- **Standalone Docker:** a captured container ID might no longer exist. Until
  current read-only inspection proves a stopped container is still present,
  Portracker offers **`docker inspect CONTAINER_ID`** as a verification
  suggestion, **not an unverified `docker start` command**.
- **Manual dev servers:** executable and cwd may be recorded, but no
  `npm`, `pnpm`, `direnv`, `nix develop` or flake command is fabricated.
  Use saved user notes for exact local project startup instructions.

All generated command lines are constructed from **structured argument lists**
with tested POSIX single-quote escaping. Invalid unit names, project/service
names and paths are rejected. No raw process command line, argv, environment,
Docker labels, or arbitrary inspection JSON is copied into a command.

Commands are not guaranteed safe to run just because they came from historical
evidence. Review them first, make sure you are on the correct Linux/Docker host,
and verify the service or config file still exists. On NixOS, starting a unit
does not declaratively enable that unit or persist a change across rebuilds.

## Preferred one-line startup command (upstream issue #136)

Authenticated History details display a **single copyable startup command** as
ordinary selectable text, not a read-only input. Click **Edit command** to
replace that text with one prefilled input; **Save command** persists and
returns immediately to read mode. **Copy** copies exactly the displayed
one-line text. A Cancel button discards the current edit. Up to 2,000
printable characters can be saved; multi-line input is rejected.

On older records with separate working directory and command, the API
can render a quoted one-liner such as `cd -- '/home/dev/my project' && pnpm dev`.
When editing, the user explicitly saves the **entire displayed line** as
one command, without a second directory input. This migrates presentation
without executing or guessing the command. New preferred lines send
`cwd: ""` (legacy field retained only for backward compatibility).

With no saved user command, a trusted structured systemd or Compose suggestion
may appear instead; unknown manual projects are never assigned fabricated
`npm dev` or `nix develop` arguments. All instructions are historical,
unverified, copy-only suggestions and must never be executed by Portracker.

- `GET /api/service-registry/:id` exposes `recovery.preferred` only with
  authenticated recovery opt-in.
- `PUT /api/service-registry/:id/recovery-start` accepts
  `{"command":"cd /home/user/project && pnpm dev","cwd":"","version":0}` with
  separate optimistic concurrency and an HTTP 409 on conflicting edits.
- Preferred commands survive offline states and logical restarts where the
  record can be safely reidentified (logical identity follow-up to upstream #132); historical entries with insufficient
  identity evidence may still require manual linking later.

## User-authored notes

The service detail view contains a plain-text note editor (4,000 characters
maximum), a Save button and read-only generated suggestions below the
user's preferred instructions. Saving is guarded by an **optimistic version
number**. If another editor changed the note, the API returns HTTP 409 rather
than silently overwriting it; refresh before retrying.

The notes are rendered as inert text and are **never shell-evaluated**.
The copy buttons only ask the browser to copy displayed text to the clipboard.
If clipboard access is unavailable, manually select the command.

## API

- `GET /api/service-registry/:id`: when recovery is enabled with a
  signed-in session, adds a `recovery` object containing `notes` and
  copy-only `recipes`.
- `PUT /api/service-registry/:id/recovery-notes`:
  `{"notes":"text","version":0}`, returning the new version. Requires an
  authenticated session and uses the existing same-origin protection.
- `DELETE /api/service-registry/:id`: also deletes the saved recovery notes,
  without deleting or stopping any real service.

The notes table was introduced in schema v6 and extended for preferred startup commands in v8. Saved
notes survive application restarts and offline periods, and do not affect the
existing live port dashboard or Docker health collection.

## Validation

Jest covers shell quoting (spaces, apostrophes, Unicode and shell syntax),
system/user units, Compose paths, stale standalone Docker, arbitrary input
rejection, note version conflicts, deletion, database restart and API privacy.
Native AMD64/ARM64 Docker/browser contracts exercise the history detail view,
read-only suggestions and the manual note editor. No server action capable of
executing commands is added.
