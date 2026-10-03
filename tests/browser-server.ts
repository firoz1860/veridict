import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../server/db.js";
import { migrate } from "../server/db.js";
import { seed } from "../server/seed-data.js";
import { createApp } from "../server/app.js";
import { workerLoop } from "../server/jobs.js";
process.env.AI_MODE = "fixture";
const p = new PGlite();
let chain = Promise.resolve();
const db: Database = {
  query: async (s, v) => p.query(s, v),
  tx(fn) {
    const r = chain.then(() =>
      p.transaction((tx) => fn({ query: async (s, v) => tx.query(s, v) })),
    );
    chain = r.then(
      () => {},
      () => {},
    );
    return r;
  },
  close: () => p.close(),
};
await migrate(db);
await seed(db, "browser-test-password");
const server = createApp(db, {
  origin: "http://127.0.0.1:5173",
  production: false,
  aiMode: "fixture",
}).listen(3001, "127.0.0.1");
const abort = new AbortController();
const worker = workerLoop(db, abort.signal);
process.on("SIGTERM", () => {
  abort.abort();
  server.close(async () => {
    await worker;
    await db.close();
    process.exit();
  });
});
