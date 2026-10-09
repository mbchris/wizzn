# Google & Apple console setup

Scripts in `scripts/setup/` create the store/console resources for `app.fourki.wizzn`. All are idempotent: re-run anytime, existing resources are skipped. Each run ends with a list of the **manual steps** that have no API.

| Command | Creates |
|---|---|
| `pnpm setup:google` | GCP project, billing link, APIs, Firebase, Android + iOS Firebase apps, SHA fingerprints, `fcm-sender` service account → `setup-out/google-services.json`, `GoogleService-Info.plist`, `google.env` |
| `pnpm setup:google -- --create-key` | same + service-account key `setup-out/fcm-sender.json` (run once) |
| `pnpm setup:apple` | Bundle ID + capabilities (Push, Sign in with Apple, IAP); checks App Store Connect app record |
| `pnpm setup:apple:secret` | Sign in with Apple client secret JWT → `setup-out/apple.env` (valid 6 months) |

Outputs land in `setup-out/` (gitignored). Put `.p8` keys in `secrets/` (gitignored).

## 1. Prepare `.env`
```bash
cat .env.setup.template >> .env   # then fill in values
```

**Google credentials:** none in `.env`; scripts use your gcloud login.
```bash
brew install --cask google-cloud-sdk
gcloud auth login
gcloud billing accounts list        # → GCP_BILLING_ACCOUNT
```
Android SHA-1 (debug): `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`. Add the release/Play App Signing SHA-1 later (Play Console → App integrity) and re-run.

**Apple credentials:** App Store Connect → Users and Access → Integrations → App Store Connect API → generate key, role **Admin**. Download the `.p8` (only once) to `secrets/AuthKey_ASC.p8`; copy Key ID → `ASC_KEY_ID`, Issuer ID → `ASC_ISSUER_ID`. Team ID: developer.apple.com → Membership → `APPLE_TEAM_ID`.

## 2. Run, in this order
```bash
pnpm setup:apple                    # bundle id + capabilities
#   manual: create app record in App Store Connect, APNs key, SIWA key (links printed)
#   set APP_STORE_ID, APNS_KEY_ID, APPLE_SIWA_KEY_ID in .env
pnpm setup:apple                    # re-run → confirms app record

pnpm setup:google -- --create-key   # Firebase + FCM
#   manual: OAuth consent screen, Web + iOS OAuth clients, upload APNs .p8 to Firebase
pnpm setup:google                   # re-run → configs now contain OAuth client ids

pnpm setup:apple:secret             # Better Auth Apple secret
```

## 3. Use the outputs
- `setup-out/google.env` + `setup-out/apple.env` → merge into `packages/api/.env` (prod: Coolify env). Fill `GOOGLE_CLIENT_SECRET` from Credentials → Web client.
- `setup-out/fcm-sender.json` → API/worker push credentials (prod: mount as secret, never commit).
- After `npx cap add android|ios` in `packages/web`:
  - `google-services.json` → `src-capacitor/android/app/`
  - `GoogleService-Info.plist` → `src-capacitor/ios/App/App/` (add to Xcode target)

## Manual-only steps (no public API)
| Where | Step |
|---|---|
| App Store Connect | Create app record (API can't create apps) |
| Apple Developer → Keys | APNs key; Sign in with Apple key |
| Apple Developer → Identifiers | Services ID (only for Apple sign-in on Android/web) |
| Google Cloud → Auth | OAuth consent screen (Branding); Web + iOS OAuth clients |
| Firebase → Cloud Messaging | Upload APNs key |

## Maintenance
- `APPLE_CLIENT_SECRET` expires after 6 months → `pnpm setup:apple:secret`, redeploy.
- New signing key / Play App Signing → add SHA-1 to `ANDROID_SHA1`, `pnpm setup:google`.
