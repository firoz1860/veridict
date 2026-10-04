import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { migrate, type Database } from "../server/db.js";
import { seed } from "../server/seed-data.js";
import { createContent } from "../server/service.js";

test("legacy schema migration repairs posting without losing existing records", async () => {
  const p = new PGlite();
  const db: Database = {
    query: async (s, v) => p.query(s, v),
    tx: (fn) =>
      p.transaction((tx) => fn({ query: async (s, v) => tx.query(s, v) })),
    close: () => p.close(),
  };
  try {
    await migrate(db);
    const users = await seed(db, "migration-test-password");
    await p.query("ALTER TABLE jobs DROP COLUMN requested_model");
    await p.query("ALTER TABLE resolutions DROP COLUMN visibility_applied");
    await assert.rejects(
      db.tx((q) =>
        createContent(q, users.author, { text: "Upgrade test", type: "POST" }),
      ),
      (e: any) => e.code === "42703",
    );
    await migrate(db);
    await migrate(db);
    const result = await db.tx((q) =>
      createContent(q, users.author, { text: "Upgrade test", type: "POST" }),
    );
    const job: any = (
      await p.query(
        "SELECT requested_model,status FROM jobs WHERE case_id=$1",
        [result.caseId],
      )
    ).rows[0];
    assert.equal(job.status, "QUEUED");
    assert.equal(job.requested_model, null);
    assert.equal((await p.query("SELECT id FROM users")).rows.length, 7);
    assert.equal((await p.query("SELECT id FROM policies")).rows.length, 1);
  } finally {
    await db.close();
  }
});
