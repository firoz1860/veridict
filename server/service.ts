import { randomUUID } from "node:crypto";
import type { SQL, Database } from "./db.js";
import { one } from "./db.js";
import { ensure, revision, canResolve, resolveAction } from "./domain.js";
import { hash } from "./auth.js";
import type {
  User,
  Policy,
  CaseRow,
  CaseDetail,
  AppealRow,
  AppealDetail,
  Analysis,
  Decision,
} from "../shared/contracts.js";
export const uid = () => randomUUID();
export async function audit(
  q: SQL,
  actor: string | null,
  action: string,
  id: string,
  detail: unknown = {},
) {
  await q.query(
    "INSERT INTO audit(id,actor_id,action,resource_id,detail) VALUES($1,$2,$3,$4,$5)",
    [uid(), actor, action, id, JSON.stringify(detail)],
  );
}
export async function activePolicy(q: SQL) {
  const p = await one<Policy>(
    q,
    "SELECT p.* FROM policies p JOIN app_state s ON s.policy_id=p.id WHERE s.id=1",
  );
  ensure(p, 503, "NO_POLICY", "An administrator must publish a policy");
  return p;
}
// A user-funded job carries references (never the secret itself) so the worker
// can resolve + decrypt the owner's credential at execution time.
export type JobCredential = {
  userId: string;
  credentialId: string;
  credentialVersion: number;
  model: string;
};
export async function enqueue(
  q: SQL,
  c: Record<string, any>,
  appealId: string | null = null,
  cred: JobCredential | null = null,
) {
  await q.query(
    "UPDATE jobs SET status='SUPERSEDED' WHERE status IN ('QUEUED','RUNNING') AND ((case_id=$1 AND appeal_id IS NULL) OR ($2::uuid IS NOT NULL AND appeal_id=$2))",
    [appealId ? null : c.id, appealId],
  );
  const id = uid();
  await q.query(
    "INSERT INTO jobs(id,case_id,appeal_id,version_id,policy_id,user_id,credential_id,credential_version,requested_model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id,
      c.id,
      appealId,
      c.version_id,
      c.policy_id,
      cred?.userId ?? null,
      cred?.credentialId ?? null,
      cred?.credentialVersion ?? null,
      cred?.model ?? null,
    ],
  );
  return id;
}
export async function mutate<T>(
  db: Database,
  user: User,
  path: string,
  key: string | undefined,
  body: unknown,
  fn: (q: SQL) => Promise<T>,
) {
  ensure(
    key && key.length <= 100,
    400,
    "IDEMPOTENCY_REQUIRED",
    "An Idempotency-Key is required",
  );
  const scope = `${user.id}:${path}:${key}`,
    h = hash(JSON.stringify(body));
  return db.tx(async (q) => {
    const old = await one(q, "SELECT * FROM idempotency WHERE scope=$1", [
      scope,
    ]);
    if (old) {
      ensure(
        old.hash === h,
        409,
        "KEY_REUSED",
        "This idempotency key was used with different data",
      );
      return old.response as T;
    }
    const r = await fn(q);
    await q.query(
      "INSERT INTO idempotency(scope,hash,response) VALUES($1,$2,$3)",
      [scope, h, JSON.stringify(r)],
    );
    return r;
  });
}
export async function caseData(q: SQL, id: string) {
  const c = await one<CaseRow & { parent_text: string | null }>(
    q,
    `SELECT c.*,v.text,v.parent_text,o.author_id,o.type,u.name author_name,p.version policy_version FROM cases c JOIN content_versions v ON v.id=c.version_id JOIN contents o ON o.id=c.content_id JOIN users u ON u.id=o.author_id JOIN policies p ON p.id=c.policy_id WHERE c.id=$1`,
    [id],
  );
  ensure(c, 404, "NOT_FOUND", "Case not found");
  const analysis = await one<Analysis>(
    q,
    "SELECT * FROM analyses WHERE case_id=$1 AND appeal_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1",
    [id],
  );
  return {
    ...c,
    analysis: analysis || null,
    isStale:
      !analysis ||
      analysis.policy_id !== c.policy_id ||
      analysis.version_id !== c.version_id,
    severity:
      analysis?.output.findings.reduce(
        (a: string, f: any) =>
          ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(f.severity) >
          ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(a)
            ? f.severity
            : a,
        "LOW",
      ) || "LOW",
  };
}
export async function caseDetail(q: SQL, id: string, user: User) {
  const c = await caseData(q, id);
  const reports = (
    await q.query(
      "SELECT * FROM reports WHERE case_id=$1 ORDER BY created_at",
      [id],
    )
  ).rows;
  const permittedActions: string[] = [];
  if (
    user.role === "MODERATOR" &&
    c.author_id !== user.id &&
    !reports.some((r) => r.reporter_id === user.id) &&
    c.status !== "DECIDED"
  ) {
    if (!c.assignee) permittedActions.push("CLAIM");
    if (c.assignee === user.id)
      permittedActions.push("ANALYZE", "DECIDE", "ESCALATE");
  }
  return {
    ...c,
    policy: await one(q, "SELECT * FROM policies WHERE id=$1", [c.policy_id]),
    reports,
    history: (
      await q.query(
        "SELECT d.* FROM decisions d JOIN cases c ON c.id=d.case_id JOIN contents o ON o.id=c.content_id WHERE o.author_id=$1 ORDER BY d.created_at DESC LIMIT 20",
        [c.author_id],
      )
    ).rows,
    analyses: (
      await q.query(
        "SELECT * FROM analyses WHERE case_id=$1 AND appeal_id IS NULL ORDER BY created_at DESC",
        [id],
      )
    ).rows,
    decision:
      (await one(q, "SELECT * FROM decisions WHERE case_id=$1", [id])) || null,
    permittedActions,
  };
}
export async function appealDetail(q: SQL, id: string, user: User) {
  const a = await one<
    AppealRow & {
      original_actor: string;
      original_policy: string;
      case_id: string;
      version_id: string;
      text: string;
    }
  >(
    q,
    `SELECT a.*,d.actor_id original_actor,d.action,d.policy_id original_policy,d.case_id,d.version_id,o.author_id,v.text FROM appeals a JOIN decisions d ON d.id=a.decision_id JOIN cases c ON c.id=d.case_id JOIN contents o ON o.id=c.content_id JOIN content_versions v ON v.id=d.version_id WHERE a.id=$1`,
    [id],
  );
  ensure(
    a && (user.role !== "AUTHOR" || a.author_id === user.id),
    404,
    "NOT_FOUND",
    "Appeal not found",
  );
  const reports = (
    await q.query("SELECT reporter_id FROM reports WHERE case_id=$1", [
      a.case_id,
    ])
  ).rows.map((x) => x.reporter_id);
  const eligible = canResolve(
    user.role,
    user.id,
    a.original_actor,
    a.author_id,
    reports,
  );
  return {
    ...a,
    original: await one(q, "SELECT * FROM decisions WHERE id=$1", [
      a.decision_id,
    ]),
    originalPolicy: await one(q, "SELECT * FROM policies WHERE id=$1", [
      a.original_policy,
    ]),
    currentPolicy: await one(q, "SELECT * FROM policies WHERE id=$1", [
      a.policy_id,
    ]),
    analysis:
      (await one(
        q,
        "SELECT * FROM analyses WHERE appeal_id=$1 AND policy_id=$2 ORDER BY created_at DESC LIMIT 1",
        [id, a.policy_id],
      )) || null,
    analysisJob:
      (await one(
        q,
        "SELECT status,error FROM jobs WHERE appeal_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
        [id],
      )) || null,
    resolution:
      (await one(q, "SELECT * FROM resolutions WHERE appeal_id=$1", [id])) ||
      null,
    permittedActions:
      a.status === "RESOLVED" || !eligible
        ? []
        : !a.assignee
          ? ["CLAIM"]
          : a.assignee === user.id
            ? ["RESOLVE", "ANALYZE"]
            : [],
  };
}
export async function createContent(
  q: SQL,
  user: User,
  b: { text: string; type: string; parentId?: string | null },
) {
  const p = await activePolicy(q);
  let parent = null;
  if (b.type === "COMMENT") {
    ensure(b.parentId, 400, "PARENT_REQUIRED", "Choose a parent post");
    parent = await one(
      q,
      "SELECT v.text FROM contents c JOIN content_versions v ON v.content_id=c.id AND v.number=c.revision WHERE c.id=$1 AND c.type='POST' AND c.visibility='VISIBLE'",
      [b.parentId],
    );
    ensure(parent, 404, "NOT_FOUND", "Parent post not found");
  }
  const id = uid(),
    v = uid(),
    c = uid();
  await q.query(
    "INSERT INTO contents(id,author_id,type,parent_id) VALUES($1,$2,$3,$4)",
    [id, user.id, b.type, b.type === "COMMENT" ? b.parentId : null],
  );
  await q.query(
    "INSERT INTO content_versions(id,content_id,number,text,parent_text) VALUES($1,$2,1,$3,$4)",
    [v, id, b.text, parent?.text || null],
  );
  await q.query(
    "INSERT INTO cases(id,content_id,version_id,policy_id) VALUES($1,$2,$3,$4)",
    [c, id, v, p.id],
  );
  await enqueue(q, { id: c, version_id: v, policy_id: p.id });
  await audit(q, user.id, "CONTENT_CREATED", id, { caseId: c });
  return { id, caseId: c };
}
export async function decide(q: SQL, id: string, user: User, b: any) {
  const c = await caseDetail(q, id, user);
  revision(c.revision, b.expectedRevision);
  ensure(
    c.permittedActions.includes("DECIDE"),
    403,
    "FORBIDDEN",
    "Claim this case with an eligible moderator account",
  );
  ensure(
    c.status !== "DECIDED",
    409,
    "ALREADY_DECIDED",
    "Case already decided",
  );
  const p = await activePolicy(q);
  ensure(c.policy_id === p.id, 409, "STALE_POLICY", "Policy changed");
  ensure(
    b.manualReview ||
      (!c.isStale && c.analysis && c.status === "READY_FOR_REVIEW"),
    409,
    "STALE_ANALYSIS",
    "Wait for current analysis or explicitly review manually",
  );
  if (!b.manualReview) {
    if (b.disposition === "APPROVE")
      ensure(
        b.action === c.analysis!.output.proposedAction,
        400,
        "ACTION_MISMATCH",
        "Approval must match the proposal",
      );
    if (b.disposition === "REJECT")
      ensure(
        b.action === "ALLOW",
        400,
        "ACTION_MISMATCH",
        "Rejecting the finding must allow content",
      );
  }
  ensure(
    b.action === "ALLOW" || b.clauseKeys.length > 0,
    400,
    "CLAUSE_REQUIRED",
    "Adverse decisions require policy clauses",
  );
  ensure(
    b.clauseKeys.every((k: string) => p.clauses.some((x) => x.key === k)),
    400,
    "INVALID_CLAUSE",
    "Select clauses from the current policy",
  );
  const d = uid();
  await q.query(
    "INSERT INTO decisions(id,case_id,actor_id,action,rationale,clause_keys,policy_id,version_id,disposition,manual) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      d,
      id,
      user.id,
      b.action,
      b.rationale,
      JSON.stringify(b.clauseKeys),
      c.policy_id,
      c.version_id,
      b.disposition,
      b.manualReview,
    ],
  );
  await q.query(
    "UPDATE cases SET status='DECIDED',revision=revision+1 WHERE id=$1",
    [id],
  );
  await q.query("UPDATE contents SET visibility=$2 WHERE id=$1", [
    c.content_id,
    b.action === "REMOVE" ? "REMOVED" : "VISIBLE",
  ]);
  await q.query(
    "UPDATE jobs SET status='SUPERSEDED' WHERE case_id=$1 AND appeal_id IS NULL AND status IN ('QUEUED','RUNNING')",
    [id],
  );
  await audit(q, user.id, "DECISION_RECORDED", d, {
    action: b.action,
    caseId: id,
    policyId: p.id,
    manual: b.manualReview,
    rationale: b.rationale,
  });
  return { id: d };
}
export async function publish(
  q: SQL,
  id: string,
  user: User,
  expected: number,
) {
  const draft = await one(q, "SELECT * FROM drafts WHERE id=$1", [id]);
  ensure(draft, 404, "NOT_FOUND", "Draft not found");
  revision(draft.revision, expected);
  const n = await one(q, "SELECT coalesce(max(version),0)+1 n FROM policies");
  const p = uid();
  await q.query(
    "INSERT INTO policies(id,version,title,clauses) VALUES($1,$2,$3,$4)",
    [p, n!.n, draft.title, JSON.stringify(draft.clauses)],
  );
  await q.query("UPDATE app_state SET policy_id=$1 WHERE id=1", [p]);
  const cases = (
    await q.query(
      "UPDATE cases SET policy_id=$1,status='PENDING_ANALYSIS',revision=revision+1 WHERE status<>'DECIDED' RETURNING *",
      [p],
    )
  ).rows;
  for (const c of cases) await enqueue(q, c);
  const appeals = (
    await q.query(
      "UPDATE appeals SET policy_id=$1,status='AWAITING_REEVALUATION',revision=revision+1 WHERE status<>'RESOLVED' RETURNING *",
      [p],
    )
  ).rows;
  for (const a of appeals) {
    const d = (await one(q, "SELECT * FROM decisions WHERE id=$1", [
      a.decision_id,
    ]))!;
    await enqueue(
      q,
      { id: d.case_id, version_id: d.version_id, policy_id: p },
      a.id,
    );
  }
  await q.query("DELETE FROM drafts WHERE id=$1", [id]);
  await audit(q, user.id, "POLICY_PUBLISHED", p, {
    version: n!.n,
    cases: cases.length,
    appeals: appeals.length,
  });
  return { id: p, version: n!.n, scheduled: cases.length + appeals.length };
}
export async function resolveAppeal(q: SQL, id: string, user: User, b: any) {
  const a = await appealDetail(q, id, user);
  revision(a.revision, b.expectedRevision);
  ensure(
    a.permittedActions.includes("RESOLVE"),
    403,
    "FORBIDDEN",
    "Only the assigned independent reviewer can resolve",
  );
  ensure(
    b.policyId === a.policy_id || b.policyId === a.original_policy,
    400,
    "POLICY_BASIS",
    "Choose the original or current policy",
  );
  ensure(
    a.policy_id === (await activePolicy(q)).id,
    409,
    "STALE_POLICY",
    "Policy changed",
  );
  ensure(
    b.manualReview ||
      (a.analysis && (!a.analysisJob || a.analysisJob.status === "SUCCEEDED")),
    409,
    "ANALYSIS_REQUIRED",
    "Wait for current analysis or explicitly review manually",
  );
  const action = resolveAction(b.outcome, a.action, b.action);
  const newer = await one(
    q,
    "SELECT c.id FROM cases c JOIN cases original ON original.id=$1 WHERE c.content_id=original.content_id AND c.id<>original.id AND c.created_at>=original.created_at",
    [a.case_id],
  );
  const visibilityApplied = !newer;
  await q.query(
    "INSERT INTO resolutions(id,appeal_id,actor_id,outcome,action,rationale,policy_id,manual,visibility_applied) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      uid(),
      id,
      user.id,
      b.outcome,
      action,
      b.rationale,
      b.policyId,
      b.manualReview,
      visibilityApplied,
    ],
  );
  await q.query(
    "UPDATE appeals SET status='RESOLVED',revision=revision+1 WHERE id=$1",
    [id],
  );
  await q.query(
    "UPDATE jobs SET status='SUPERSEDED' WHERE appeal_id=$1 AND status IN ('QUEUED','RUNNING')",
    [id],
  );
  if (visibilityApplied)
    await q.query(
      "UPDATE contents SET visibility=$2 WHERE id=(SELECT content_id FROM cases WHERE id=$1)",
      [a.case_id, action === "REMOVE" ? "REMOVED" : "VISIBLE"],
    );
  await audit(q, user.id, "APPEAL_RESOLVED", id, {
    outcome: b.outcome,
    visibilityApplied,
    action,
    policyId: b.policyId,
    rationale: b.rationale,
    manual: b.manualReview,
  });
  return { id, outcome: b.outcome, action, visibilityApplied };
}
