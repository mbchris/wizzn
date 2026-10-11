# Media Storage & Backup — Design Proposal

Status: **proposed, awaiting approval** (2026-10-11)

## Requirements
- Self-hosted S3 on the Coolify server; app stores all media there.
- Regular backups to **Google Drive**.
- DevPack: **100 published units from prod** for local development.
- Setup guide for Coolify.

## Current State
| Area | Finding |
|---|---|
| Local media | `packages/api/media-data/` (gitignored), 1.4 GB, 665 unit dirs |
| Prod media | Docker volume `media`, served by nginx, filled via `push-delta.sh` over SSH |
| Backup | None |
| Code | `MediaStore` interface, content-addressed paths `unitId/hash.ext`; `MEDIA_DRIVER: local\|s3` in `env.ts`, only `local` implemented |
| Wiring | `server.ts` and `providers/index.ts` both hard-wire `createLocalMediaStore`; `rerender-audio.ts` unlinks from `MEDIA_DIR` directly |

## Storage Server Options
| Option | Pros | Cons |
|---|---|---|
| **Garage v2.3 (chosen)** | Coolify one-click template (single-node, default bucket); lightweight; web endpoint serves public bucket → replaces media nginx | No object versioning → history via restic |
| SeaweedFS | Mature, feature-rich, admin UI | Heavier, more config |
| MinIO | Familiar | Community edition archived Feb 2026, no security fixes |

## Design

### 1. Infrastructure (Coolify)
- Garage as **separate Coolify service**; app redeploys never touch storage.
- Domains:
  | Domain | Port | Purpose |
  |---|---|---|
  | `s3.<domain>` | 3900 | S3 API, authenticated (app, Mac push scripts) |
  | `media.<domain>` | 3902 | Public read-only web access to `wizzn-media` → `MEDIA_PUBLIC_URL` |
- Keys:
  | Key | Access |
  |---|---|
  | app | read/write `wizzn-media` |
  | devpack | read/write `wizzn-devpack` |
  | backup | read-only `wizzn-media` |
- Remove `media` nginx service and `media` volume from `docker-compose.yml` after migration.
- One-time migration: `rclone copy` old volume → bucket, on the server.

### 2. Backups → Google Drive
- New `backup` service in `docker-compose.yml`: restic, rclone, pg_dump 17, supercronic.
- Nightly:
  1. `pg_dump` streamed into restic.
  2. `rclone sync` Garage → local mirror volume (incremental; plain files, restorable anywhere).
  3. `restic backup` mirror → encrypted repo `rclone:gdrive:wizzn-backup`.
- Retention: 7 daily, 4 weekly, 6 monthly; weekly `restic check`.
- Restore procedure documented and tested.
- Constraints:
  - Auth: `rclone authorize "drive"` on Mac → token in Coolify env var (personal Gmail: no service accounts).
  - Free Drive = 15 GB → Google One plan needed for GBs of media.
  - Mirror costs server disk equal to media size.

### 3. App Code
- `MediaStore.delete(path)` added (replaces direct unlink in `rerender-audio.ts`).
- `createS3MediaStore`: `@aws-sdk/client-s3`, path-style; uploads set `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`.
- `createMediaStore(env)` factory picks `local` / `s3`; `server.ts` uses `providers.media` (no second store).
- Env (required when `MEDIA_DRIVER=s3`, validated in `env.ts`):
  | Var | Example |
  |---|---|
  | `S3_ENDPOINT` | `https://s3.<domain>` |
  | `S3_REGION` | `garage` |
  | `S3_BUCKET` | `wizzn-media` |
  | `S3_ACCESS_KEY_ID` | app key id |
  | `S3_SECRET_ACCESS_KEY` | app key secret |
- Local dev defaults to `local`; optional Garage in `docker-compose.dev.yml` (profile `s3`) to test the S3 driver.
- `push-data.sh` / `push-delta.sh` media step → `rclone copy` Mac → `s3.<domain>` (replaces tar over SSH).

### 4. DevPack (100 prod units)
- `pnpm devpack:build -- <ssh-host> <uuid>`:
  1. Select 100 published units, round-robin across fields × formats, newest first.
  2. Export via SQL: units, their briefs, sources, assets, check reports, links among selected units, all fields + themes. No users/progress (no personal data).
  3. Pull only referenced media.
  4. Pack `devpack-YYYYMMDD.tgz` + `manifest.json` (counts, last migration); upload to private `wizzn-devpack`, update `latest` pointer.
- `pnpm devpack:load [latest|file]`:
  1. Refuse if pack's last migration ≠ local → run `db:migrate`.
  2. Confirm, then replace local content tables.
  3. Extract media into `media-data/`.

### 5. Docs & Tests
- Setup guide: `docs/ops/media-storage.md` (Garage on Coolify, keys/bucket, domains, Drive auth, backup service, migration, restore).
- vitest: S3 store (mocked client), env validation, DevPack unit selection.
- E2E: S3 store against local dev Garage.

## Next Steps
1. Approve this design.
2. Spec → `docs/superpowers/specs/2026-10-11-media-object-storage-design.md`.
3. Implementation plan → build.

## Sources
- [Self-Hosted Object Storage in 2026 (MinIO archived)](https://www.offshoreserverhosting.com/blog/self-hosted-object-storage-2026-seaweedfs-garage-minio-replacement/)
- [Coolify service templates (`garage.yaml`)](https://github.com/coollabsio/coolify/tree/v4.x/templates/compose)
