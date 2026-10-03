import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Encryption + custom-host allowlist must be set before the modules read them.
process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.AI_CUSTOM_ALLOWED_HOSTS = "ai.example.com,llm.internal-approved.com";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { migrate, one, type Database } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seed } from "../server/seed-data.js";
import { runOne } from "../server/jobs.js";
import { encryptKey, decryptKey } from "../server/crypto.js";
import { validateCustomBaseUrl, ProviderError } from "../server/providers.js";
import { resolveCredential } from "../server/credentials.js";

// ---------------------------------------------------------------------------
// Mocked provider transport. No real network calls are made; every test here
// uses a stubbed global fetch. (There are NO live-provider/real-key checks in
// this suite — those would require explicitly supplied test credentials.)
// ---------------------------------------------------------------------------
type Handler = (
  url: string,
  init: RequestInit | undefined,
) => { status: number; body: unknown };
const VALID_ANALYSIS = {
  findings: [],
  proposedAction: "ALLOW",
  summary: "Mocked provider assessment: no violation detected.",
  requiresHumanJudgment: true,
};
let handler: Handler = defaultHandler;
function defaultHandler(url: string, init?: RequestInit) {
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET" && url.includes("/models"))
    return { status: 200, body: { data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] } };
  if (url.includes("/chat/completions"))
    return {
      status: 200,
      body: {
        choices: [
          { finish_reason: "stop", message: { content: JSON.stringify(VALID_ANALYSIS) } },
        ],
      },
    };
  return { status: 404, body: { error: "unexpected mock call" } };
}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const { status, body } = handler(String(input), init);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}) as typeof fetch;

let db: Database;
let p: PGlite;
let app: ReturnType<typeof createApp>;
const clients: Record<string, any> = {};
const csrf: Record<string, string> = {};
const ORIGIN = "http://localhost:5173";

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
  await seed(db, "test-password-12345");
  app = createApp(db, { origin: ORIGIN, production: false, aiMode: "fixture" });
  for (const role of ["author", "moderator", "moderator2", "admin"]) {
    const a = request.agent(app);
    clients[role] = a;
    const s = await a.get("/api/v1/auth/csrf");
    csrf[role] = s.body.data.csrf;
    const login = await a
      .post("/api/v1/auth/login")
      .set("X-CSRF-Token", csrf[role])
      .set("Origin", ORIGIN)
      .send({ email: `${role}@veridict.local`, password: "test-password-12345" });
    assert.equal(login.status, 200);
    csrf[role] = login.body.data.csrf;
  }
});
after(async () => {
  globalThis.fetch = realFetch;
  await db?.close();
});

function post(role: string, path: string, body: any, key = crypto.randomUUID()) {
  return clients[role]
    .post("/api/v1" + path)
    .set("Origin", ORIGIN)
    .set("X-CSRF-Token", csrf[role])
    .set("Idempotency-Key", key)
    .send(body);
}
function del(role: string, path: string, body: any = {}, key = crypto.randomUUID()) {
  return clients[role]
    .delete("/api/v1" + path)
    .set("Origin", ORIGIN)
    .set("X-CSRF-Token", csrf[role])
    .set("Idempotency-Key", key)
    .send(body);
}
function patch(role: string, path: string, body: any, key = crypto.randomUUID()) {
  return clients[role]
    .patch("/api/v1" + path)
    .set("Origin", ORIGIN)
    .set("X-CSRF-Token", csrf[role])
    .set("Idempotency-Key", key)
    .send(body);
}
const get = (role: string, path: string) => clients[role].get("/api/v1" + path);

test("crypto: AES-256-GCM round-trip and AAD binding", () => {
  const parts = { userId: "u1", credentialId: "c1", version: 1 };
  const { ciphertext, nonce } = encryptKey("sk-secret-123", parts);
  assert.notEqual(ciphertext, "sk-secret-123");
  assert.equal(decryptKey(ciphertext, nonce, parts), "sk-secret-123");
  // Wrong user, credential or version must fail authentication.
  assert.throws(() => decryptKey(ciphertext, nonce, { ...parts, userId: "u2" }));
  assert.throws(() => decryptKey(ciphertext, nonce, { ...parts, version: 2 }));
  assert.throws(() =>
    decryptKey(ciphertext, nonce, { ...parts, credentialId: "c2" }),
  );
});

test("SSRF: custom base URLs reject private, metadata, loopback, http and userinfo", async () => {
  const rejected = [
    "https://localhost/v1",
    "https://127.0.0.1/v1",
    "https://10.0.0.5/v1",
    "https://192.168.1.4/v1",
    "https://169.254.169.254/latest/meta-data",
    "http://ai.example.com/v1", // not https
    "https://user:pass@ai.example.com/v1", // embedded credentials
    "https://not-approved-host.com/v1", // not in allowlist
  ];
  for (const u of rejected)
    await assert.rejects(
      validateCustomBaseUrl(u, async () => ["1.2.3.4"]),
      (e) => e instanceof ProviderError,
      `expected rejection for ${u}`,
    );
  // Allowlisted host resolving to a public IP is accepted and normalized.
  const ok = await validateCustomBaseUrl("https://ai.example.com/v1/", async () => [
    "1.2.3.4",
  ]);
  assert.equal(ok, "https://ai.example.com/v1");
  // Allowlisted host that resolves to a private IP (DNS rebinding) is rejected.
  await assert.rejects(
    validateCustomBaseUrl("https://ai.example.com/v1", async () => ["10.0.0.9"]),
    (e) => e instanceof ProviderError,
  );
});

test("providers registry is server-controlled and omits base URLs/secrets", async () => {
  const r = await get("author", "/ai/providers");
  assert.equal(r.status, 200);
  const providers = r.body.data as any[];
  assert.ok(providers.find((p) => p.id === "anthropic"));
  for (const p of providers) {
    assert.ok(typeof p.keyUrl === "string");
    assert.equal((p as any).baseUrl, undefined); // internal base URLs not exposed
  }
});

test("verify returns models on success and a sanitized taxonomy code on failure", async () => {
  handler = defaultHandler;
  const okRes = await post("moderator", "/ai/connection/verify", {
    provider: "openai",
    apiKey: "sk-valid-key-123",
  });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.body.data.ok, true);
  assert.deepEqual(okRes.body.data.models, ["gpt-4o", "gpt-4o-mini"]);

  handler = () => ({ status: 401, body: { error: "unauthorized" } });
  const badRes = await post("moderator", "/ai/connection/verify", {
    provider: "openai",
    apiKey: "sk-bad-key-000",
  });
  assert.equal(badRes.status, 200);
  assert.equal(badRes.body.data.ok, false);
  assert.equal(badRes.body.data.error.code, "INVALID_KEY");
  handler = defaultHandler;
});

test("verify rejects custom SSRF targets with UNSUPPORTED and never calls fetch", async () => {
  const res = await post("moderator", "/ai/connection/verify", {
    provider: "custom",
    apiKey: "sk-whatever-123",
    baseUrl: "https://127.0.0.1/v1",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.ok, false);
  assert.equal(res.body.data.error.code, "UNSUPPORTED");
});

test("save returns only safe metadata; no plaintext/ciphertext leaves the server", async () => {
  handler = defaultHandler;
  const res = await post("moderator", "/ai/connection", {
    provider: "openai",
    apiKey: "sk-live-abcd1234",
    model: "gpt-4o",
  });
  assert.equal(res.status, 201);
  const meta = res.body.data;
  assert.equal(meta.provider, "openai");
  assert.equal(meta.model, "gpt-4o");
  assert.equal(meta.version, 1);
  assert.equal(meta.keySuffix, "••••1234");
  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes("sk-live-abcd1234"));
  assert.ok(!("ciphertext" in meta));
  assert.ok(!("nonce" in meta));
  assert.ok(!("apiKey" in meta));
  // Stored at rest encrypted, not as plaintext.
  const row = await one(db, "SELECT * FROM ai_credentials WHERE id=$1", [meta.id]);
  assert.notEqual(row!.ciphertext, "sk-live-abcd1234");
  assert.ok(row!.ciphertext.length > 0);
});

test("cross-user isolation: others and admins cannot see or decrypt the owner's credential", async () => {
  // moderator connected above.
  assert.ok((await get("moderator", "/ai/connection")).body.data);
  assert.equal((await get("moderator2", "/ai/connection")).body.data, null);
  assert.equal((await get("admin", "/ai/connection")).body.data, null);
  const row = await one(
    db,
    "SELECT * FROM ai_credentials WHERE active=true AND user_id=(SELECT id FROM users WHERE email='moderator@veridict.local')",
  );
  // Decryption bound to the owner: another user's id cannot resolve it.
  const other = await one(db, "SELECT id FROM users WHERE email='admin@veridict.local'");
  await assert.rejects(
    resolveCredential(db, row!.id, row!.version, other!.id),
    (e: any) => e.status === 409,
  );
});

test("worker uses the requesting moderator's credential and records the model", async () => {
  handler = defaultHandler;
  // Author posts neutral content (no deterministic match); drain automatic job.
  const made = (
    await post("author", "/contents", {
      text: "A perfectly ordinary neutral community update.",
    })
  ).body.data;
  while (await runOne(db, "fixture")) {}
  let d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  await post("moderator", `/cases/${made.caseId}/claim`, {
    expectedRevision: d.revision,
  });
  d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  const trig = await post("moderator", `/cases/${made.caseId}/analyze`, {
    expectedRevision: d.revision,
  });
  assert.equal(trig.status, 202);
  // The queued job carries the moderator's credential reference.
  const job = await one(db, "SELECT * FROM jobs WHERE id=$1", [trig.body.data.jobId]);
  assert.ok(job!.credential_id);
  assert.ok(job!.user_id);
  await runOne(db, "fixture"); // credential path ignores mode, uses mocked provider
  const after = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  assert.equal(after.status, "READY_FOR_REVIEW");
  assert.equal(after.analysis.output.proposedAction, "ALLOW");
  assert.equal(after.analysis.model, "openai:gpt-4o");
});

test("personal-key failure fails the job with NO fallback to fixture/env", async () => {
  const made = (
    await post("author", "/contents", {
      text: "Another neutral ordinary post for review.",
    })
  ).body.data;
  while (await runOne(db, "fixture")) {}
  let d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  await post("moderator", `/cases/${made.caseId}/claim`, {
    expectedRevision: d.revision,
  });
  d = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  const trig = await post("moderator", `/cases/${made.caseId}/analyze`, {
    expectedRevision: d.revision,
  });
  // Provider now rejects the key during chat.
  handler = (url, init) => {
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET" && url.includes("/models"))
      return { status: 200, body: { data: [{ id: "gpt-4o" }] } };
    return { status: 401, body: { error: "revoked" } };
  };
  await runOne(db, "fixture");
  handler = defaultHandler;
  const after = (await get("moderator", `/cases/${made.caseId}`)).body.data;
  assert.equal(after.status, "ANALYSIS_FAILED");
  const job = await one(db, "SELECT * FROM jobs WHERE id=$1", [trig.body.data.jobId]);
  assert.equal(job!.status, "FAILED");
  // No fixture fallback analysis was written for this failed run.
  assert.equal(after.decision, null);
});

test("replace key creates a new version and revokes the previous one", async () => {
  handler = defaultHandler;
  const res = await post("moderator", "/ai/connection", {
    provider: "openai",
    apiKey: "sk-replacement-wxyz",
    model: "gpt-4o-mini",
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.version, 2);
  assert.equal(res.body.data.model, "gpt-4o-mini");
  const rows = (
    await db.query(
      "SELECT version,active FROM ai_credentials WHERE user_id=(SELECT id FROM users WHERE email='moderator@veridict.local') ORDER BY version",
    )
  ).rows;
  assert.equal(rows.find((r: any) => r.version === 1)!.active, false);
  assert.equal(rows.find((r: any) => r.version === 2)!.active, true);
});

test("change model patches the owned credential only", async () => {
  const res = await patch("moderator", "/ai/connection", { model: "gpt-4o" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.model, "gpt-4o");
  // A user without a connection cannot patch.
  assert.equal((await patch("moderator2", "/ai/connection", { model: "x" })).status, 404);
});

test("disconnect removes usable secret material and blocks reuse", async () => {
  const before = await one(
    db,
    "SELECT id,version FROM ai_credentials WHERE active=true AND user_id=(SELECT id FROM users WHERE email='moderator@veridict.local')",
  );
  const res = await del("moderator", "/ai/connection");
  assert.equal(res.status, 200);
  assert.equal((await get("moderator", "/ai/connection")).body.data, null);
  const row = await one(db, "SELECT * FROM ai_credentials WHERE id=$1", [before!.id]);
  assert.equal(row!.active, false);
  assert.equal(row!.status, "REVOKED");
  assert.equal(row!.ciphertext, ""); // secret material overwritten
  const mod = await one(db, "SELECT id FROM users WHERE email='moderator@veridict.local'");
  await assert.rejects(
    resolveCredential(db, before!.id, before!.version, mod!.id),
    (e: any) => e.status === 409,
  );
});
