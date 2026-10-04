import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import * as auth from "../server/auth.js";
import { migrate } from "../server/db.js";
let db: PGlite;
before(async () => {
  db = new PGlite();
  await migrate(db);
});
after(async () => {
  await db.close();
});
test("signup normalizes email, hashes passwords, and never grants a requested staff role", async () => {
  const user = await (auth as any).registerAuthor(db, {
    name: "New Author",
    email: "New@Example.com",
    password: "test-long-password",
    role: "ADMIN",
  });
  assert.equal(user.role, "AUTHOR");
  assert.equal(user.email, "new@example.com");
  const saved: any = (
    await db.query("SELECT * FROM users WHERE id=$1", [user.id])
  ).rows[0];
  assert.notEqual(saved.password, "test-long-password");
  assert.ok(await auth.checkPassword("test-long-password", saved.password));
  assert.equal(user.password, undefined);
});
test("signup rejects weak passwords and reserved internal email addresses", async () => {
  for (const input of [
    { email: "weak@example.com", password: "short" },
    { email: "admin@veridict.local", password: "test-long-password" },
  ])
    await assert.rejects(() =>
      (auth as any).registerAuthor(db, { name: "Test", ...input }),
    );
});
test("duplicate normalized email cannot overwrite an account", async () => {
  await assert.rejects(
    () =>
      (auth as any).registerAuthor(db, {
        name: "Replacement",
        email: "NEW@example.com",
        password: "other-long-password",
      }),
    /already|registered/i,
  );
  const saved: any = (
    await db.query("SELECT * FROM users WHERE email='new@example.com'")
  ).rows[0];
  assert.equal(saved.name, "New Author");
});
