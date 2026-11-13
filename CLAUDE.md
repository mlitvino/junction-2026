@AGENTS.md

Zone rules (one file per zone, shared with Codex):
@src/app/AGENTS.md
@src/app/api/AGENTS.md
@src/client/AGENTS.md
@src/components/AGENTS.md
@src/features/AGENTS.md
@src/server/AGENTS.md
@src/shared/AGENTS.md

# Claude Code notes

All project rules are in the `AGENTS.md` files (imported above), shared with the other developer's Codex. Keep this file to Claude-specific notes only. When you add a zone `AGENTS.md`, add its import here.

In this repo, Claude Code works for the **backend/infra dev**: see "Ownership" in `AGENTS.md` for the paths you may edit.

## Guardrails (enforced by `.claude/settings.json`, not by this file)

- `.env*` files (except `.env.example`), `~/.ssh`, `~/.aws` and other credential paths are off-limits: reads are denied, and `.claude/hooks/guard.sh` blocks Bash commands that mention `.env`.
- `sudo`, `curl`, `wget`, `WebFetch` and force-push are denied. `rm`, `git push` and other destructive git commands always ask.
- Bash runs in a sandbox: no writes outside the project, network only to the npm registry, GitHub and Google Fonts.
- bypassPermissions mode is disabled. Don't try to work around a block. Stop and tell the user what you needed and why.
