---
name: dbhub-gradle-postgres
description: >
  Use when a local Gradle repository has PostgreSQL
  JDBC settings in gradle.properties and the user
  wants DBHub MCP database access.
---

# DBHub Gradle Postgres

Sync repo-local Gradle PostgreSQL definitions into
DBHub, shared MCP, and optional Claude Code MCP.

## Use

Run from the target repo, or pass the repo path:

```bash
python3 /path/to/ai-setup/packages/global/.apm/skills/dbhub-gradle-postgres/\
scripts/sync-dbhub-gradle-postgres.py .
```

The helper:

- scans all `gradle.properties` files below the repo
- finds direct `jdbc:postgresql://...` property values
- pairs nearby `username`/`user` and `password` values
- updates a managed block in `~/.config/dbhub/dbhub.toml`
- merges `dbhub` into `~/.config/mcp/mcp.json`
- with `--claude-code`, merges `dbhub` into repo `.mcp.json`
- starts Docker container `dbhub` with `--restart always`
- verifies DBHub exposes read-only SQL tools for all managed sources

## Defaults

| Setting      | Value                        |
| ------------ | ---------------------------- |
| DBHub config | `~/.config/dbhub/dbhub.toml` |
| MCP config   | `~/.config/mcp/mcp.json`     |
| Container    | `dbhub`                      |
| Image        | `bytebase/dbhub:latest`      |
| Endpoint     | `http://localhost:18080/mcp` |
| Tool mode    | read-only, `max_rows = 1000` |

## Options

```bash
python3 scripts/sync-dbhub-gradle-postgres.py /repo \
  --config ~/.config/dbhub/dbhub.toml \
  --mcp-config ~/.config/mcp/mcp.json \
  --port 18080
```

Use `--claude-code` to update the repo-local `.mcp.json` for
Claude Code. Use `--skip-docker` for config-only dry runs.
Use `--no-verify` only when Docker is unavailable.
Use `--self-test` to check parser behavior without Docker.

## Rules

- Preserve manual DBHub TOML outside the managed block.
- Add new repo DBs to the managed block; do not rewrite the file.
- Deduplicate managed DBs by DSN across repeated or multi-repo runs.
- Use DBHub TOML `id`, not `name`, for sources.
- Use HTTP MCP: `http://localhost:<port>/mcp`.
- Do not guess CLI MCP commands; update MCP JSON.
- Keep sources read-only unless the user asks otherwise.
- Local JDBC hosts become `host.docker.internal` for Docker.
- If Pi is already running, tell the user to reload/restart Pi.

## Limit

Only direct Gradle `key=value` and `key: value` properties are parsed.
Skipped: Gradle interpolation and custom config formats. Add them when a
real repo needs them.
