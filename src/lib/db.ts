import * as schema from "@/db/schema";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

/**
 * Choose the right Drizzle driver based on the DATABASE_URL hostname.
 *
 * - Neon HTTP driver (`@neondatabase/serverless` + `drizzle-orm/neon-http`)
 *   is the optimal driver for serverless / edge runtimes (e.g. Next.js
 *   Route Handlers on Vercel). Each request opens a stateless HTTP fetch
 *   to Neon's pooler, which avoids cold-start connection overhead and
 *   idle-connection limits.
 *
 * - For a local PostgreSQL instance (e.g. the one in `docker-compose.yml`),
 *   the Neon HTTP driver refuses to connect because the hostname is not a
 *   Neon domain. In that case we fall back to `pg` (node-postgres) with a
 *   long-lived TCP pool, which is the standard driver for long-running
 *   Node processes.
 */
function isNeonUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname.endsWith(".neon.tech") ||
      hostname.endsWith(".neon.com") ||
      hostname.endsWith(".neon.build")
    );
  } catch {
    return false;
  }
}

function createDb() {
  const url = process.env.DATABASE_URL!;

  if (isNeonUrl(url)) {
    // Serverless / edge path: Neon HTTP driver.
    const sql: NeonQueryFunction<false, false> = neon(url);
    return drizzleNeon(sql, { schema });
  }

  // Local / standard PostgreSQL path: node-postgres pool.
  const pool = new Pool({ connectionString: url });
  return drizzleNode(pool, { schema });
}

export const db = createDb();
