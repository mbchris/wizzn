// Minimal App Store Connect API client (JWT ES256 signed with your .p8 key).
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from './lib.mjs'

export const b64url = (b) => Buffer.from(b).toString('base64url')

export function es256Jwt({ keyPath, keyId, header = {}, payload }) {
  const key = createPrivateKey(readFileSync(resolve(ROOT, keyPath)))
  const h = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT', ...header }))
  const p = b64url(JSON.stringify(payload))
  const sig = sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' })
  return `${h}.${p}.${b64url(sig)}`
}

export function ascClient({ keyPath, keyId, issuerId }) {
  const now = Math.floor(Date.now() / 1000)
  const jwt = es256Jwt({ keyPath, keyId, payload: { iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' } })
  return async function api(method, path, body) {
    const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    const json = text ? JSON.parse(text) : {}
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.errors?.map((e) => e.detail).join('; ') || text}`)
    return json
  }
}
