import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { migrate, type Database } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seed } from "../server/seed-data.js";
import { runOne } from "../server/jobs.js";
let db: Database;
let p: PGlite;
let app: ReturnType<typeof createApp>;
let users: Record<string, any>;
let c: string, decision: string, appeal: string;
const clients: Record<string, any> = {};
const csrf: Record<string, string> = {};
before(async () => {
  p = new PGlite();
  let chain = Promise.resolve();
  db = {
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
  users = await seed(db, "test-password-12345");
  app = createApp(db, {
    origin: "http://localhost:5173",
    production: false,
    aiMode: "fixture",
  });
  for (const role of [
    "author",
    "author2",
    "moderator",
    "moderator2",
    "reviewer",
    "admin",
  ]) {
    const a = request.agent(app);
    clients[role] = a;
    const s = await a.get("/api/v1/auth/csrf");
    csrf[role] = s.body.data.csrf;
    const login = await a
      .post("/api/v1/auth/login")
      .set("X-CSRF-Token", csrf[role])
      .set("Origin", "http://localhost:5173")
      .send({
        email: `${role}@veridict.local`,
        password: "test-password-12345",
      });
    assert.equal(login.status, 200);
    csrf[role] = login.body.data.csrf;
  }
});
after(async () => db?.close());
function post(
  role: string,
  path: string,
  body: any,
  key: string = crypto.randomUUID(),
) {
  return clients[role]
    .post("/api/v1" + path)
    .set("Origin", "http://localhost:5173")
    .set("X-CSRF-Token", csrf[role])
    .set("Idempotency-Key", key)
    .send(body);
}
const get = (role: string, path: string) => clients[role].get("/api/v1" + path);
test("rejects unauthorized staff requests and missing CSRF", async () => {
  assert.equal((await request(app).get("/api/v1/cases")).status, 401);
  assert.equal((await get("author", "/cases")).status, 403);
  assert.equal(
    (await clients.author.post("/api/v1/contents").send({ text: "hello" }))
      .status,
    403,
  );
});
test("creates content; fixture analysis does not enforce removal", async () => {
  const r = await post("author", "/contents", {
    text: "Visit scam.invalid for a prize",
    type: "POST",
  });
  assert.equal(r.status, 201);
  c = r.body.data.caseId;
  await runOne(db, "fixture");
  const d = await get("moderator", `/cases/${c}`);
  assert.equal(d.body.data.analysis.output.proposedAction, "REMOVE");
  const content = await get("author", `/contents/${r.body.data.id}`);
  assert.equal(content.body.data.visibility, "VISIBLE");
});
test("only assigned moderator can decide; idempotency avoids duplicate decisions", async () => {
  let d = (await get("moderator", `/cases/${c}`)).body.data;
  assert.equal(
    (
      await post("moderator", "/cases/" + c + "/claim", {
        expectedRevision: d.revision,
      })
    ).status,
    200,
  );
  d = (await get("moderator", `/cases/${c}`)).body.data;
  const body = {
    expectedRevision: d.revision,
    action: "REMOVE",
    disposition: "APPROVE",
    rationale: "The prohibited domain is explicitly present.",
    clauseKeys: ["LINKS"],
    manualReview: false,
  };
  assert.equal(
    (await post("moderator2", `/cases/${c}/decisions`, body)).status,
    403,
  );
  const r = await post(
    "moderator",
    `/cases/${c}/decisions`,
    body,
    "same-decision",
  );
  assert.equal(r.status, 200);
  decision = r.body.data.id;
  assert.equal(
    (await post("moderator", `/cases/${c}/decisions`, body, "same-decision"))
      .body.data.id,
    decision,
  );
  assert.equal(
    (
      await post(
        "moderator",
        `/cases/${c}/decisions`,
        { ...body, action: "ALLOW" },
        "same-decision",
      )
    ).status,
    409,
  );
  assert.equal(
    Number(
      (await db.query("SELECT count(*) FROM decisions WHERE case_id=$1", [c]))
        .rows[0].count,
    ),
    1,
  );
});
test("author-only appeal and independent resolution restore content", async () => {
  assert.equal(
    (
      await post("author2", `/decisions/${decision}/appeals`, {
        reason: "This was only an example link.",
      })
    ).status,
    404,
  );
  const r = await post("author", `/decisions/${decision}/appeals`, {
    reason: "This was a quoted example for safety education.",
    evidence: "Please consider the educational context.",
  });
  assert.equal(r.status, 201);
  appeal = r.body.data.id;
  await runOne(db, "fixture");
  let a = (await get("reviewer", `/appeals/${appeal}`)).body.data;
  assert.equal(
    (
      await post("moderator", `/appeals/${appeal}/claim`, {
        expectedRevision: a.revision,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post("reviewer", `/appeals/${appeal}/claim`, {
        expectedRevision: a.revision,
      })
    ).status,
    200,
  );
  a = (await get("reviewer", `/appeals/${appeal}`)).body.data;
  const resolved = await post("reviewer", `/appeals/${appeal}/resolve`, {
    expectedRevision: a.revision,
    outcome: "OVERTURNED",
    action: "ALLOW",
    rationale: "Independent review confirms educational context.",
    policyId: a.currentPolicy.id,
    manualReview: false,
  });
  assert.equal(resolved.status, 200);
  assert.equal(
    (await get("reviewer", `/appeals/${appeal}`)).body.data.resolution.action,
    "ALLOW",
  );
  assert.equal(
    (
      await db.query(
        "SELECT visibility FROM contents WHERE id=(SELECT content_id FROM cases WHERE id=$1)",
        [c],
      )
    ).rows[0].visibility,
    "VISIBLE",
  );
});
test("new policy makes pending review stale and retains historical decisions", async () => {
  const r = await post("author", "/contents", { text: "A neutral new post." });
  const id = r.body.data.caseId;
  await runOne(db, "fixture");
  const old = (await get("moderator", `/cases/${id}`)).body.data;
  const draft = await post("admin", "/policies/drafts", {
    title: "Community policy revision",
    clauses: [
      {
        key: "LINKS",
        text: "Do not post scam.invalid or malware.invalid links.",
        severity: "HIGH",
        term: "scam.invalid",
      },
    ],
  });
  assert.equal(draft.status, 201);
  assert.equal(
    (
      await post("admin", `/policies/drafts/${draft.body.data.id}/publish`, {
        expectedRevision: 1,
      })
    ).status,
    200,
  );
  const updated = (await get("moderator", `/cases/${id}`)).body.data;
  assert.equal(updated.isStale, true);
  assert.notEqual(updated.policy_id, old.policy_id);
  assert.equal(
    (await db.query("SELECT policy_id FROM decisions WHERE id=$1", [decision]))
      .rows[0].policy_id,
    old.policy_id,
  );
  await runOne(db, "fixture");
  assert.equal(
    (await get("moderator", `/cases/${id}`)).body.data.isStale,
    false,
  );
});
test("content editing invalidates the old analysis; stale moderator revision is rejected", async () => {
  const made = (
    await post("author", "/contents", { text: "Original clean text." })
  ).body.data;
  while (await runOne(db, "fixture")) {}
  let d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  await post("moderator", `/cases/${made.caseId}/claim`, {
    expectedRevision: d.revision,
  });
  d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  assert.equal(
    (
      await post("author", `/contents/${made.id}/versions`, {
        expectedRevision: 1,
        text: "Changed text with scam.invalid.",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post("moderator", `/cases/${made.caseId}/decisions`, {
        expectedRevision: d.revision,
        action: "ALLOW",
        disposition: "MODIFY",
        rationale: "This was the old content review.",
        clauseKeys: [],
        manualReview: false,
      })
    ).status,
    409,
  );
  const revised = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  assert.equal(revised.isStale, true);
  assert.equal(revised.text, "Changed text with scam.invalid.");
  while (await runOne(db, "fixture")) {}
  assert.equal(
    (await get("moderator", `/cases/${made.caseId}`)).body.data.analysis.output
      .proposedAction,
    "REMOVE",
  );
});
test("provider failure stays unresolved; manual human review remains available", async () => {
  const made = (
    await post("author", "/contents", {
      text: "A post awaiting an unavailable provider.",
    })
  ).body.data;
  await runOne(db, "unavailable");
  let d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  assert.equal(d.status, "ANALYSIS_FAILED");
  assert.equal(d.decision, null);
  await post("moderator", `/cases/${made.caseId}/claim`, {
    expectedRevision: d.revision,
  });
  d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  const result = await post("moderator", `/cases/${made.caseId}/decisions`, {
    expectedRevision: d.revision,
    action: "ALLOW",
    disposition: "MODIFY",
    rationale: "Manual review finds no policy violation.",
    clauseKeys: [],
    manualReview: true,
  });
  assert.equal(result.status, 200);
});
test("policy updates during an appeal block stale resolution and retain the original decision", async () => {
  const made = (
    await post("author", "/contents", {
      text: "Another link scam.invalid for review.",
    })
  ).body.data;
  while (await runOne(db, "fixture")) {}
  let d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  await post("moderator", `/cases/${made.caseId}/claim`, {
    expectedRevision: d.revision,
  });
  d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  const dec = (
    await post("moderator", `/cases/${made.caseId}/decisions`, {
      expectedRevision: d.revision,
      action: "REMOVE",
      disposition: "APPROVE",
      rationale: "The domain is prohibited in the current policy.",
      clauseKeys: ["LINKS"],
      manualReview: false,
    })
  ).body.data;
  const aid = (
    await post("author", `/decisions/${dec.id}/appeals`, {
      reason: "Please review this educational context.",
    })
  ).body.data.id;
  while (await runOne(db, "fixture")) {}
  let a = (await get("reviewer", `/appeals/${aid}`)).body.data;
  await post("reviewer", `/appeals/${aid}/claim`, {
    expectedRevision: a.revision,
  });
  a = (await get("reviewer", `/appeals/${aid}`)).body.data;
  const draft = (
    await post("admin", "/policies/drafts", {
      title: "Policy with context exception",
      clauses: [
        {
          key: "LINKS",
          text: "Do not post scam.invalid except for clear educational context.",
          severity: "HIGH",
          term: "scam.invalid",
        },
      ],
    })
  ).body.data;
  await post("admin", `/policies/drafts/${draft.id}/publish`, {
    expectedRevision: 1,
  });
  const stale = await post("reviewer", `/appeals/${aid}/resolve`, {
    expectedRevision: a.revision,
    outcome: "UPHELD",
    action: "REMOVE",
    rationale: "Trying to submit an outdated decision.",
    policyId: a.currentPolicy.id,
  });
  assert.equal(stale.status, 409);
  const pending = (await get("reviewer", `/appeals/${aid}`)).body.data;
  assert.equal(pending.status, "AWAITING_REEVALUATION");
  assert.equal(pending.originalPolicy.id, a.originalPolicy.id);
  assert.notEqual(pending.currentPolicy.id, a.currentPolicy.id);
  assert.equal(
    (
      await post("author", `/contents/${made.id}/versions`, {
        expectedRevision: 1,
        text: "Edited during appeal.",
      })
    ).status,
    409,
  );
  while (await runOne(db, "fixture")) {}
  const current = (await get("reviewer", `/appeals/${aid}`)).body.data;
  assert.ok(current.analysis);
  assert.equal(current.analysis.policy_id, current.currentPolicy.id);
});
test("report triggers review and authors cannot inspect private case evidence", async () => {
  const made = (
    await post("author", "/contents", { text: "A new post to be reported." })
  ).body.data;
  const report = await post("author2", `/contents/${made.id}/reports`, {
    reason: "Please check the context of this post.",
  });
  assert.equal(report.status, 201);
  assert.equal((await get("author2", `/cases/${made.caseId}`)).status, 403);
  assert.equal(
    (
      await post("author2", `/contents/${made.id}/reports`, {
        reason: "Reporting the same content again.",
      })
    ).status,
    409,
  );
});
test("reports cannot create a competing case while an appeal is open", async () => {
  const row = (
    await db.query(
      "SELECT c.content_id FROM appeals a JOIN decisions d ON d.id=a.decision_id JOIN cases c ON c.id=d.case_id WHERE a.status<>'RESOLVED' LIMIT 1",
    )
  ).rows[0];
  await db.query("UPDATE contents SET visibility='VISIBLE' WHERE id=$1", [
    row.content_id,
  ]);
  assert.equal(
    (
      await post("author2", `/contents/${row.content_id}/reports`, {
        reason: "A new report while the appeal is open.",
      })
    ).status,
    409,
  );
});
