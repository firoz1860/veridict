import type { Database } from "./db.js";
import { one } from "./db.js";
import { uid, audit } from "./service.js";
import { analyze, type ResolvedCredential } from "./ai.js";
import { resolveCredential } from "./credentials.js";
import type { Policy } from "../shared/contracts.js";
export async function runOne(
  db: Database,
  mode = process.env.AI_MODE || "live",
) {
  const job = await db.tx(async (q) => {
    await q.query("UPDATE app_state SET heartbeat=now() WHERE id=1");
    await q.query(
      "UPDATE jobs SET status='FAILED',error='Worker interrupted too often' WHERE status='RUNNING' AND lease_until<now() AND attempts>=3",
    );
    await q.query(
      "UPDATE cases SET status='ANALYSIS_FAILED' WHERE status='ANALYZING' AND EXISTS(SELECT 1 FROM jobs j WHERE j.case_id=cases.id AND j.appeal_id IS NULL AND j.status='FAILED' AND j.version_id=cases.version_id AND j.policy_id=cases.policy_id)",
    );
    const j = await one<{
      id: string;
      case_id: string;
      appeal_id: string | null;
      version_id: string;
      policy_id: string;
      user_id: string | null;
      credential_id: string | null;
      credential_version: number | null;
      requested_model: string | null;
    }>(
      q,
      "SELECT * FROM jobs WHERE status='QUEUED' OR (status='RUNNING' AND lease_until<now() AND attempts<3) ORDER BY created_at,id LIMIT 1",
    );
    if (!j) return null;
    const lease = uid();
    await q.query(
      "UPDATE jobs SET status='RUNNING',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '120 seconds' WHERE id=$1",
      [j.id, lease],
    );
    if (!j.appeal_id)
      await q.query(
        "UPDATE cases SET status='ANALYZING' WHERE id=$1 AND status<>'DECIDED'",
        [j.case_id],
      );
    return { ...j, lease };
  });
  if (!job) return false;
  try {
    const policy = (await one<Policy>(
      db,
      "SELECT * FROM policies WHERE id=$1",
      [job.policy_id],
    ))!;
    const v = (await one(db, "SELECT * FROM content_versions WHERE id=$1", [
      job.version_id,
    ]))!;
    const reports = (
      await db.query(
        "SELECT reason FROM reports WHERE case_id=$1 ORDER BY created_at LIMIT 20",
        [job.case_id],
      )
    ).rows;
    const history = (
      await db.query(
        "SELECT d.action,d.rationale FROM decisions d JOIN cases c ON c.id=d.case_id JOIN contents o ON o.id=c.content_id WHERE o.author_id=(SELECT author_id FROM contents WHERE id=$1) ORDER BY d.created_at DESC LIMIT 10",
        [v.content_id],
      )
    ).rows;
    const appeal = job.appeal_id
      ? await one(db, "SELECT reason,evidence FROM appeals WHERE id=$1", [
          job.appeal_id,
        ])
      : undefined;
    // User-funded job: resolve + decrypt the owner's credential at execution,
    // verifying it is still active and owned. Any failure fails the job — there
    // is NO fallback to the server env provider or fixture mode.
    let credential: ResolvedCredential | undefined;
    if (job.credential_id) {
      credential = await resolveCredential(
        db,
        job.credential_id,
        job.credential_version!,
        job.user_id!,
      );
    }
    if (credential) {
      if (!job.requested_model)
        throw new Error("Missing requested model snapshot");
      credential.model = job.requested_model;
    }
    const output = await analyze(
      policy,
      {
        text: v.text,
        parentText: v.parent_text,
        reports,
        history,
        appeal: appeal as { reason: string; evidence: string } | undefined,
      },
      mode,
      credential,
    );
    await db.tx(async (q) => {
      const j = await one(q, "SELECT * FROM jobs WHERE id=$1", [job.id]);
      if (j?.status !== "RUNNING" || j.lease_token !== job.lease) return;
      const target = await one(
        q,
        job.appeal_id
          ? "SELECT * FROM appeals WHERE id=$1"
          : "SELECT * FROM cases WHERE id=$1",
        [job.appeal_id || job.case_id],
      );
      if (
        !target ||
        target.policy_id !== job.policy_id ||
        ["RESOLVED", "DECIDED"].includes(target.status) ||
        (!job.appeal_id && target.version_id !== job.version_id)
      ) {
        await q.query("UPDATE jobs SET status='SUPERSEDED' WHERE id=$1", [
          job.id,
        ]);
        return;
      }
      await q.query(
        "INSERT INTO analyses(id,case_id,appeal_id,version_id,policy_id,output,mode,model) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          uid(),
          job.case_id,
          job.appeal_id,
          job.version_id,
          job.policy_id,
          JSON.stringify(output),
          credential ? "live" : mode,
          credential
            ? `${credential.provider}:${credential.model}`
            : mode === "fixture"
              ? "deterministic-fixture"
              : process.env.AI_MODEL,
        ],
      );
      await q.query(
        "UPDATE jobs SET status='SUCCEEDED',error=NULL WHERE id=$1",
        [job.id],
      );
      if (job.appeal_id)
        await q.query(
          "UPDATE appeals SET status=CASE WHEN assignee IS NULL THEN 'SUBMITTED' ELSE 'UNDER_REVIEW' END,revision=revision+1 WHERE id=$1",
          [job.appeal_id],
        );
      else
        await q.query(
          "UPDATE cases SET status='READY_FOR_REVIEW',revision=revision+1 WHERE id=$1",
          [job.case_id],
        );
      await audit(q, null, "ANALYSIS_COMPLETED", job.appeal_id || job.case_id, {
        jobId: job.id,
        policyId: job.policy_id,
        mode,
      });
    });
  } catch (e) {
    await db.tx(async (q) => {
      const j = await one(q, "SELECT * FROM jobs WHERE id=$1", [job.id]);
      if (j?.status !== "RUNNING" || j.lease_token !== job.lease) return;
      await q.query(
        "UPDATE jobs SET status='FAILED',error='AI unavailable or output failed citation validation' WHERE id=$1",
        [job.id],
      );
      if (!job.appeal_id)
        await q.query(
          "UPDATE cases SET status='ANALYSIS_FAILED',revision=revision+1 WHERE id=$1 AND status<>'DECIDED'",
          [job.case_id],
        );
      await audit(q, null, "ANALYSIS_FAILED", job.appeal_id || job.case_id, {
        jobId: job.id,
      });
    });
    console.error(
      JSON.stringify({
        event: "analysis_failed",
        jobId: job.id,
        errorType: e instanceof Error ? e.name : "Unknown",
      }),
    );
  }
  return true;
}
export async function workerLoop(db: Database, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      if (!(await runOne(db))) await new Promise((r) => setTimeout(r, 1500));
    } catch {
      console.error(JSON.stringify({ event: "worker_database_error" }));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
