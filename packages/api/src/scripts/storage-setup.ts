/**
 * Ops: prepares and verifies the prod media bucket (Garage). Reads S3_* from the env file it is started with.
 *   pnpm storage:check                              → bucket reachable, CORS set, upload + delete work
 *   pnpm storage:check https://media.wizzn.app      → additionally fetches a probe via the public web endpoint
 *                                                     and checks Cache-Control + CORS headers (after the cutover)
 */
import { DeleteObjectCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import { z } from 'zod'
import { createS3Client, createS3MediaStore, IMMUTABLE_CACHE } from '../providers/media-store.js'

const env = z
  .object({
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('garage'),
    S3_BUCKET: z.string().min(1).default('wizzn-media'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .parse(process.env)
const publicUrl = process.argv.slice(2).find((a) => a.startsWith('http'))

const client = createS3Client(env)
const bucket = env.S3_BUCKET
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

await client.send(new HeadBucketCommand({ Bucket: bucket })).catch((err: Error) => fail(`bucket ${bucket} at ${env.S3_ENDPOINT}: ${err.name} ${err.message}`))
console.log(`✓ bucket ${bucket} reachable`)

// <img>/<audio> don't need CORS, but fetch()/canvas/Web Audio in the web + Capacitor apps do (nginx sent `*` before)
await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: { CORSRules: [{ AllowedOrigins: ['*'], AllowedMethods: ['GET', 'HEAD'], AllowedHeaders: ['*'], MaxAgeSeconds: 86_400 }] },
  }),
)
console.log('✓ CORS: GET/HEAD from any origin')

const store = createS3MediaStore({ bucket, publicBaseUrl: publicUrl ?? env.S3_ENDPOINT, client })
const path = await store.put('_probe', Buffer.from(`probe ${new Date().toISOString()}`), 'bin')
console.log(`✓ upload ${path}`)
try {
  if (publicUrl) {
    const res = await fetch(store.publicUrl(path), { headers: { Origin: 'https://example.com' } })
    if (!res.ok) throw new Error(`public GET ${store.publicUrl(path)} → ${res.status} (website access enabled? domain alias set?)`)
    const cache = res.headers.get('cache-control')
    const cors = res.headers.get('access-control-allow-origin')
    console.log(`✓ public GET ${res.status} · cache-control: ${cache ?? '—'} · access-control-allow-origin: ${cors ?? '—'}`)
    if (cache !== IMMUTABLE_CACHE) console.warn('⚠ Cache-Control not returned as uploaded — clients will re-validate media')
    if (!cors) console.warn('⚠ no CORS header on the web endpoint — add one in the Coolify proxy if the apps fetch() media')
  }
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
} finally {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }))
  console.log('✓ delete')
}
