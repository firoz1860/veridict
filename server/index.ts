import "dotenv/config";
import { postgres } from "./db.js";
import { createApp } from "./app.js";
import { workerLoop } from "./jobs.js";
const origin = process.env.APP_ORIGIN;
if (!origin) throw Error("APP_ORIGIN is required");
new URL(origin);
const db = postgres();
const app = createApp(db, {
  origin,
  production: process.env.NODE_ENV === "production",
  aiMode: process.env.AI_MODE || "live",
});
const abort = new AbortController();
const worker =
  process.env.RUN_WORKER === "true"
    ? workerLoop(db, abort.signal)
    : Promise.resolve();
const server = app.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log(
    JSON.stringify({ event: "api_started", port: process.env.PORT || 3001 }),
  ),
);
let stopping = false;
for (const s of ["SIGTERM", "SIGINT"])
  process.on(s, () => {
    if (stopping) return;
    stopping = true;
    abort.abort();
    server.close(async () => {
      await worker;
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 65000).unref();
  });
