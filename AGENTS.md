# Agents — portracker

See `dev/AGENTS.md` for the full workflow contract. Highlights for this repo:

- Backend: `backend/index.js` + `backend/collectors/`, `backend/routes/`
- Frontend: Vite + React in `frontend/` (Tailwind + shadcn-style components)
- Containerized via root `Dockerfile` and `docker-compose.yml`

## Task tracking — `bd` is mandatory

Use the global Beads DB at `/data/beads/.beads`. Do not create ad-hoc TODO markdown.

```sh
bd ready --json                   # start every session here
bd create "Title" -p 1 -t task
bd update <id> --claim
bd update <id> --notes "..."
bd close <id> --reason "..."
```

Tag portracker work with `--label portracker` or `[portracker]` in the title:

```sh
bd list --label portracker --status open --json
```

Full rules: see `dev/AGENTS.md` → "Task tracking — `bd` (Beads) is mandatory".

## Repo-specific guardrails

- UI changes need visual verification via Playwright (compare prod `:30233` vs dev `:4998`).
- Dismiss the "What's New" modal in screenshots (see user memory: `playwright-mcp-stdio.md`).
- Never restart the production portracker container without explicit approval.
