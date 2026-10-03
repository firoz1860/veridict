import "dotenv/config";
import { postgres } from "./db.js";
import { workerLoop } from "./jobs.js";
const db = postgres(),
  abort = new AbortController();
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => abort.abort());
await workerLoop(db, abort.signal);
await db.close();
