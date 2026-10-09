import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { loadEnv } from '../env.js'
import { createDb } from './client.js'

// Used in the container at startup; drizzle-kit stays a dev-only tool
const { db, pool } = createDb(loadEnv().DATABASE_URL)
await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
await pool.end()
console.log('Migrations applied')
