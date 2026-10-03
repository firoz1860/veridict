import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
export interface SQL {
  query<T = Record<string, any>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends SQL {
  tx<T>(fn: (q: SQL) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(url = process.env.DATABASE_URL): Database {
  if (!url) throw Error("DATABASE_URL is required");
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 10000,
  });
  return {
    query: async <T = Record<string, any>>(s: string, p?: unknown[]) => ({
      rows: (await pool.query(s, p)).rows as T[],
    }),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT id FROM app_state WHERE id=1 FOR UPDATE");
        const r = await fn(c);
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
export async function migrate(db: SQL) {
  for (const sql of (
    await readFile(new URL("./schema.sql", import.meta.url), "utf8")
  )
    .split(";")
    .filter((x) => x.trim()))
    await db.query(sql);
}
export async function one<T = Record<string, any>>(
  q: SQL,
  s: string,
  p: unknown[] = [],
): Promise<T | undefined> {
  return (await q.query<T>(s, p)).rows[0];
}
