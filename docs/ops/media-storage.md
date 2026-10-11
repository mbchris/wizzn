# Media Storage, Backup & DevPack

Media (images, audio) live in a self-hosted **Garage** S3 server on Coolify. A nightly **backup** service writes DB + media to an encrypted restic repo on **Google Drive**. **DevPacks** (100 prod units + media) feed local development.

Design rationale: [`STORAGE_AND_BACKUP.md`](../../STORAGE_AND_BACKUP.md).

## Overview
| Piece | Where | Purpose |
|---|---|---|
| Garage | Separate Coolify service | `s3.wizzn.app` (:3900, S3 API, auth) · `media.wizzn.app` (:3902, public read) |
| `wizzn-media` | Garage bucket | App media; `MEDIA_DRIVER=s3` |
| `wizzn-devpack` | Garage bucket | DevPack archives + `latest.txt` |
| `backup` | Service in `docker-compose.yml` | 03:15 nightly: `pg_dump` + bucket mirror → restic → `gdrive:wizzn-backup` |
| `media` (nginx) | `docker-compose.yml` | Legacy; serves the old volume until cutover |

| Garage key | Access | Used by |
|---|---|---|
| default (`WIZZN_S3_KEY_ID`) | read/write/owner `wizzn-media` | api, worker, `storage:*`, push scripts |
| `devpack` | read/write `wizzn-devpack` | `devpack:build`, `devpack:load` (local `.env`) |
| `backup` | read `wizzn-media` | backup service |

## 1. Garage on Coolify
1. DNS (registrar, not Coolify): `A s3.wizzn.app → <server IP>` (skip if `*.wizzn.app` exists).
2. Coolify → project → **+ New → Service → Garage**. Do not deploy yet.
3. Keys (Garage requires the `GK` prefix):
   ```bash
   echo "GK$(openssl rand -hex 16)"; openssl rand -hex 32
   ```
4. **Edit Compose File**:
   ```yaml
   - GARAGE_DEFAULT_ACCESS_KEY=${WIZZN_S3_KEY_ID}
   - GARAGE_DEFAULT_SECRET_KEY=${WIZZN_S3_SECRET}
   ```
   In the `garage.toml` content, below `db_engine = "lmdb"`: `metadata_auto_snapshot_interval = "6h"` (consistent metadata snapshots inside the volume).
5. Env: `WIZZN_S3_KEY_ID`, `WIZZN_S3_SECRET` (step 3), `GARAGE_DEFAULT_BUCKET=wizzn-media`.
6. Domains (garage container): `https://s3.wizzn.app:3900`. Deploy.
7. Terminal (garage container):
   ```sh
   /garage status
   /garage bucket website --allow wizzn-media
   /garage bucket alias wizzn-media media.wizzn.app   # web endpoint picks the bucket by Host header
   /garage bucket create wizzn-devpack
   /garage key create devpack
   /garage bucket allow --read --write wizzn-devpack --key devpack
   /garage key create backup
   /garage bucket allow --read wizzn-media --key backup
   /garage key info --show-secret devpack
   /garage key info --show-secret backup
   ```
8. Local `.env.production` (Mac):
   ```env
   MEDIA_DRIVER=s3
   S3_ENDPOINT=https://s3.wizzn.app
   S3_REGION=garage
   S3_BUCKET=wizzn-media
   S3_ACCESS_KEY_ID=<WIZZN_S3_KEY_ID>
   S3_SECRET_ACCESS_KEY=<WIZZN_S3_SECRET>
   MEDIA_PUBLIC_URL=https://media.wizzn.app
   ```
   Check: `pnpm storage:check` → bucket reachable, CORS set, upload/delete OK.

## 2. Google Drive
1. [Google Cloud Console](https://console.cloud.google.com/): new project → enable **Google Drive API** → OAuth consent screen (External, own account as user) → **Publishing status: In production**. Testing mode expires refresh tokens after 7 days → backups stop.
2. Credentials → OAuth client ID → **Desktop app** → client ID + secret.
3. `brew install rclone && rclone authorize "drive" "<client_id>" "<client_secret>"` → JSON token.
4. Free Drive = 15 GB; GBs of media need Google One.
5. `openssl rand -base64 32` → `RESTIC_PASSWORD`, store in the password manager. Lost password = unrecoverable backups.

## 3. App env (Coolify → wizzn app)
| Var | Value |
|---|---|
| `MEDIA_DRIVER` | `s3` (at cutover, step 4) |
| `S3_ENDPOINT` | `https://s3.wizzn.app` |
| `S3_BUCKET` | `wizzn-media` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | default key |
| `RESTIC_PASSWORD` | step 2.5 |
| `GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET` | step 2.2 |
| `GDRIVE_TOKEN` | step 2.3 JSON, verbatim |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | `backup` key |
| `HEALTHCHECK_URL` | optional, e.g. healthchecks.io ping URL (alerts on missed/failed runs) |
| `BACKUP_CRON` | optional, default `15 3 * * *` (Europe/Berlin) |
| `BACKUP_ON_START` | optional `true`: run once on container start (first test) |

`pnpm coolify:env -- --domain wizzn.app` copies these from `.env.production` into `setup-out/coolify.env`.

Backup service exits with `✗ missing env: …` until configured. `postgresql17-client` must be ≥ the prod Postgres major version.

## 4. Cutover (old volume → Garage)
1. `pnpm storage:migrate -- <ssh-host> <app-uuid>`: rclone on the server copies the volume into `wizzn-media` (never deletes; prints file counts).
2. Coolify: set `MEDIA_DRIVER=s3` → redeploy app (api/worker write to Garage).
3. Domains: remove `media.wizzn.app` from the `media` service; add `https://media.wizzn.app:3902` to the garage service.
4. `pnpm storage:migrate -- <ssh-host> <app-uuid>` again (files written between 1 and 2).
5. `pnpm storage:check https://media.wizzn.app` → public GET, `Cache-Control`, CORS headers.
6. Spot-check the app; then remove the `media` service + `media` volume mounts from `docker-compose.yml` and delete the volume.

URLs stay identical (`MEDIA_PUBLIC_URL` unchanged, same relative paths).

## 5. Backup operations
Coolify → backup container → Terminal:
| Task | Command |
|---|---|
| Run now | `/backup/backup.sh` |
| List snapshots | `/backup/restore.sh snapshots` |
| DB dump (latest) | `/backup/restore.sh db > /cache/wizzn.dump` |
| Restore DB | `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" /cache/wizzn.dump` |
| Media → `/restore` only | `/backup/restore.sh media-local [snapshot]` |
| Media → bucket | `BACKUP_S3_ACCESS_KEY_ID=<rw key> BACKUP_S3_SECRET_ACCESS_KEY=<…> /backup/restore.sh media [snapshot]` |

Schedule: snapshots kept 7 daily / 4 weekly / 6 monthly; Sunday: `restic check --read-data-subset=5%`.
Restore test: after the first run, restore the DB dump into a scratch database and `media-local`; repeat quarterly.
Without the server: any machine with restic + rclone (`gdrive` remote) + `RESTIC_PASSWORD` can read `rclone:gdrive:wizzn-backup`.

## 6. DevPack
Local `.env`:
```env
DEVPACK_S3_ENDPOINT=https://s3.wizzn.app
DEVPACK_S3_ACCESS_KEY_ID=<devpack key>
DEVPACK_S3_SECRET_ACCESS_KEY=<devpack secret>
```
| Command | Effect |
|---|---|
| `pnpm devpack:load` | Download latest pack, replace local content tables, copy media into `packages/api/media-data` |
| `pnpm devpack:load -- devpacks/<file>.tgz` | Load a local pack |
| `pnpm devpack:build -- <ssh-host> <postgres-container \| app-uuid>` | Build from prod (read-only), upload, mark latest |
| `… --units 200` / `--no-upload` | Pack size / keep local only |

- Selection: published units, round-robin over field × format, newest first.
- Content: all fields + themes; selected units with briefs, sources, assets, check reports, links among them; referenced media (fetched from `MEDIA_PUBLIC_URL`). No users, sessions or progress.
- Load keeps local users; their progress/interests/saved units are cleared (they reference content).
- Schema guard: pack records the last Drizzle migration. Local behind → `pnpm db:migrate`. Pack behind → rebuild or `--force`.
- Requires `rclone` and the dev compose Postgres running.

## Local S3 (optional)
```bash
docker compose -f docker-compose.dev.yml --profile s3 up -d garage
```
`.env`: `MEDIA_DRIVER=s3`, `S3_ENDPOINT=http://localhost:3900`, `S3_ACCESS_KEY_ID=GK000000000000000000000000000000`, `S3_SECRET_ACCESS_KEY=` 64 × `0`, `S3_BUCKET=wizzn-media`. Public reads: `docker compose … exec garage /garage bucket website --allow wizzn-media` + `/garage bucket alias wizzn-media localhost`, then `MEDIA_PUBLIC_URL=http://localhost:3902`.
