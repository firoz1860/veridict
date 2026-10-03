import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { z, ZodError } from "zod";
import type { Database, SQL } from "./db.js";
import { one } from "./db.js";
import { AppError, ensure, revision } from "./domain.js";
import {
  hash,
  newSession,
  checkPassword,
  throttle,
  passwordHash,
} from "./auth.js";
import {
  Login,
  ContentInput,
  Revision,
  DecisionInput,
  AppealInput,
  ResolutionInput,
  PolicyInput,
  type User,
} from "../shared/contracts.js";
import {
  uid,
  mutate,
  audit,
  activePolicy,
  createContent,
  caseData,
  caseDetail,
  appealDetail,
  decide,
  publish,
  resolveAppeal,
  enqueue,
} from "./service.js";
export type Config = { origin: string; production: boolean; aiMode: string };
type Authed = Request & {
  user: User;
  session: { token: string; csrf: string; user_id: string | null };
  requestId: string;
};
export function createApp(db: Database, config: Config) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", async (req, res, next) => {
    const r = req as Authed;
    r.requestId = uid();
    res.set("X-Request-Id", r.requestId);
    res.set("Cache-Control", "no-store");
    res.set("CDN-Cache-Control", "no-store");
    try {
      const cookie = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("vd_session="))
        ?.slice(11);
      if (cookie && /^[a-f0-9]{64}$/.test(cookie)) {
        const session = await one(
          db,
          "SELECT * FROM sessions WHERE token=$1 AND expires_at>now()",
          [hash(cookie)],
        );
        if (session) {
          r.session = session as Authed["session"];
          if (session.user_id)
            r.user = (await one<User>(
              db,
              "SELECT id,name,email,role FROM users WHERE id=$1",
              [session.user_id],
            ))!;
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });
  const send = (res: Response, data: unknown, status = 200) =>
    res.status(status).json({ data, requestId: res.get("X-Request-Id") });
  const sessionCookie = (res: Response, raw: string) =>
    res.cookie("vd_session", raw, {
      httpOnly: true,
      secure: config.production,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 3600 * 1000,
    });
  const wrap =
    (fn: (r: Authed, s: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve(fn(req as Authed, res)).catch(next);
  const logged = (req: Request, _res: Response, next: NextFunction) => {
    try {
      ensure((req as Authed).user, 401, "LOGIN_REQUIRED", "Please sign in");
      next();
    } catch (e) {
      next(e);
    }
  };
  const roles =
    (...allowed: string[]) =>
    (req: Request, _res: Response, next: NextFunction) => {
      try {
        ensure(
          (req as Authed).user && allowed.includes((req as Authed).user.role),
          403,
          "FORBIDDEN",
          "This role cannot access this operation",
        );
        next();
      } catch (e) {
        next(e);
      }
    };
  const write = (req: Request, _res: Response, next: NextFunction) => {
    try {
      const r = req as Authed;
      ensure(
        req.headers.origin === config.origin,
        403,
        "ORIGIN",
        "Request origin is not allowed",
      );
      ensure(
        r.session && req.headers["x-csrf-token"] === r.session.csrf,
        403,
        "CSRF",
        "Session verification failed. Refresh and try again.",
      );
      next();
    } catch (e) {
      next(e);
    }
  };
  const id = (r: Request) => z.string().uuid().parse(r.params.id);
  const mutation = (r: Authed, fn: (q: SQL) => Promise<unknown>) =>
    mutate(db, r.user, r.path, r.get("Idempotency-Key"), r.body, fn);
  const staff = roles("MODERATOR", "REVIEWER", "ADMIN");
  app.get("/api/v1/health/live", (_r, s) => send(s, { alive: true }));
  app.get(
    "/api/v1/health/ready",
    wrap(async (_r, s) => {
      const state = await one(db, "SELECT heartbeat FROM app_state WHERE id=1");
      const worker =
        !!state?.heartbeat &&
        Date.now() - new Date(state.heartbeat).getTime() < 120000;
      return send(s, { database: true, worker }, worker ? 200 : 503);
    }),
  );
  app.get(
    "/api/v1/auth/csrf",
    wrap(async (r, s) => {
      if (!(await throttle(db, "csrf:" + r.ip, 120, 60)))
        throw new AppError(429, "RATE_LIMIT", "Too many requests");
      if (r.session) return send(s, { csrf: r.session.csrf });
      const session = await newSession(db, null);
      sessionCookie(s, session.raw);
      return send(s, { csrf: session.csrf });
    }),
  );
  let dummyHash: Promise<string> | undefined;
  app.post(
    "/api/v1/auth/login",
    write,
    wrap(async (r, s) => {
      const b = Login.parse(r.body);
      ensure(
        (await throttle(db, "login:" + hash(b.email.toLowerCase()), 10, 900)) &&
          (await throttle(db, "ip-login:" + r.ip, 30, 900)),
        429,
        "RATE_LIMIT",
        "Too many sign-in attempts. Try again later.",
      );
      const u = await one(db, "SELECT * FROM users WHERE email=$1", [
        b.email.toLowerCase(),
      ]);
      dummyHash ??= passwordHash("unused-random-placeholder-password");
      const valid = await checkPassword(
        b.password,
        u?.password || (await dummyHash),
      );
      ensure(
        u && valid,
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect",
      );
      const session = await db.tx(async (q) => {
        await q.query("DELETE FROM sessions WHERE token=$1", [r.session.token]);
        return newSession(q, u.id);
      });
      sessionCookie(s, session.raw);
      return send(s, {
        user: { id: u.id, name: u.name, email: u.email, role: u.role },
        csrf: session.csrf,
      });
    }),
  );
  app.use("/api/v1", logged);
  app.get(
    "/api/v1/auth/me",
    wrap(async (r, s) => send(s, r.user)),
  );
  app.post(
    "/api/v1/auth/logout",
    write,
    wrap(async (r, s) => {
      await db.query("DELETE FROM sessions WHERE token=$1", [r.session.token]);
      s.clearCookie("vd_session", {
        path: "/",
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
      });
      return send(s, { ok: true });
    }),
  );
  app.use("/api/v1", async (req, res, next) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
        ensure(
          await throttle(db, "write:" + (req as Authed).user.id, 120, 60),
          429,
          "RATE_LIMIT",
          "Too many requests",
        );
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/api/v1/status",
    staff,
    wrap(async (_r, s) => {
      const row = await one(db, "SELECT heartbeat FROM app_state WHERE id=1");
      const jobs = (
        await db.query(
          "SELECT status,count(*)::int count FROM jobs GROUP BY status",
        )
      ).rows;
      return send(s, {
        aiMode: config.aiMode,
        aiConfigured:
          config.aiMode === "fixture" ||
          !!(process.env.AI_API_KEY && process.env.AI_MODEL),
        workerHealthy:
          !!row?.heartbeat &&
          Date.now() - new Date(row.heartbeat).getTime() < 120000,
        heartbeat: row?.heartbeat,
        jobs,
      });
    }),
  );
  app.get(
    "/api/v1/dashboard",
    staff,
    wrap(async (_r, s) =>
      send(
        s,
        await one(
          db,
          `SELECT (SELECT count(*)::int FROM cases WHERE status<>'DECIDED') pending,(SELECT count(*)::int FROM appeals WHERE status<>'RESOLVED') appeals,(SELECT count(*)::int FROM cases c WHERE status<>'DECIDED' AND EXISTS(SELECT 1 FROM analyses a WHERE a.case_id=c.id AND a.appeal_id IS NULL) AND NOT EXISTS(SELECT 1 FROM analyses a WHERE a.case_id=c.id AND a.appeal_id IS NULL AND a.policy_id=c.policy_id AND a.version_id=c.version_id)) stale,(SELECT count(*)::int FROM jobs WHERE status='FAILED') failed`,
        ),
      ),
    ),
  );
  app.get(
    "/api/v1/contents",
    wrap(async (r, s) => {
      const mine = r.query.mine === "true";
      const rows = (
        await db.query(
          `SELECT c.*,v.text,u.name author_name FROM contents c JOIN content_versions v ON v.content_id=c.id AND v.number=c.revision JOIN users u ON u.id=c.author_id WHERE ${mine ? "c.author_id=$1" : "(c.visibility='VISIBLE' OR c.author_id=$1)"} ORDER BY c.created_at DESC,c.id DESC LIMIT 100`,
          [r.user.id],
        )
      ).rows;
      return send(s, rows);
    }),
  );
  app.post(
    "/api/v1/contents",
    roles("AUTHOR"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, (q) =>
          createContent(q, r.user, ContentInput.parse(r.body)),
        ),
        201,
      ),
    ),
  );
  app.get(
    "/api/v1/contents/:id",
    wrap(async (r, s) => {
      const c = await one(
        db,
        "SELECT c.*,v.text,u.name author_name FROM contents c JOIN content_versions v ON v.content_id=c.id AND v.number=c.revision JOIN users u ON u.id=c.author_id WHERE c.id=$1",
        [id(r)],
      );
      ensure(
        c &&
          (r.user.role !== "AUTHOR" ||
            c.author_id === r.user.id ||
            c.visibility === "VISIBLE"),
        404,
        "NOT_FOUND",
        "Content not found",
      );
      const history =
        c.author_id === r.user.id || r.user.role !== "AUTHOR"
          ? (
              await db.query(
                "SELECT d.id,d.action,d.rationale,d.created_at,d.policy_id,d.clause_keys,a.id appeal_id FROM decisions d JOIN cases c ON c.id=d.case_id LEFT JOIN appeals a ON a.decision_id=d.id WHERE c.content_id=$1 ORDER BY d.created_at DESC",
                [c.id],
              )
            ).rows
          : [];
      return send(s, { ...c, history });
    }),
  );
  app.post(
    "/api/v1/contents/:id/versions",
    roles("AUTHOR"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = Revision.extend({
            text: z.string().trim().min(1).max(5000),
          }).parse(r.body);
          const c = await one(
            q,
            "SELECT * FROM contents WHERE id=$1 AND author_id=$2",
            [id(r), r.user.id],
          );
          ensure(c, 404, "NOT_FOUND", "Content not found");
          revision(c.revision, b.expectedRevision);
          const appeal = await one(
            q,
            "SELECT a.id FROM appeals a JOIN decisions d ON d.id=a.decision_id JOIN cases c ON c.id=d.case_id WHERE c.content_id=$1 AND a.status<>'RESOLVED'",
            [c.id],
          );
          ensure(
            !appeal,
            409,
            "OPEN_APPEAL",
            "Wait until the open appeal is resolved before editing",
          );
          const v = uid();
          const parent = c.parent_id
            ? await one(
                q,
                "SELECT v.text FROM content_versions v JOIN contents c ON c.id=v.content_id AND c.revision=v.number WHERE c.id=$1",
                [c.parent_id],
              )
            : null;
          await q.query(
            "INSERT INTO content_versions(id,content_id,number,text,parent_text) VALUES($1,$2,$3,$4,$5)",
            [v, c.id, c.revision + 1, b.text, parent?.text || null],
          );
          await q.query("UPDATE contents SET revision=revision+1 WHERE id=$1", [
            c.id,
          ]);
          const p = await activePolicy(q);
          let pending = await one(
            q,
            "SELECT * FROM cases WHERE content_id=$1 AND status<>'DECIDED'",
            [c.id],
          );
          if (pending) {
            await q.query(
              "UPDATE cases SET version_id=$2,policy_id=$3,status='PENDING_ANALYSIS',revision=revision+1 WHERE id=$1",
              [pending.id, v, p.id],
            );
          } else {
            pending = { id: uid() };
            await q.query(
              "INSERT INTO cases(id,content_id,version_id,policy_id) VALUES($1,$2,$3,$4)",
              [pending.id, c.id, v, p.id],
            );
          }
          await enqueue(q, { id: pending.id, version_id: v, policy_id: p.id });
          await audit(q, r.user.id, "CONTENT_EDITED", c.id, {
            version: c.revision + 1,
          });
          return { id: c.id, caseId: pending.id };
        }),
      ),
    ),
  );
  app.post(
    "/api/v1/contents/:id/reports",
    roles("AUTHOR"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = z
            .object({ reason: z.string().trim().min(10).max(2000) })
            .parse(r.body);
          const content = await one(
            q,
            "SELECT * FROM contents WHERE id=$1 AND visibility='VISIBLE'",
            [id(r)],
          );
          ensure(
            content && content.author_id !== r.user.id,
            404,
            "NOT_FOUND",
            "Reportable content not found",
          );
          ensure(
            !(await one(
              q,
              "SELECT a.id FROM appeals a JOIN decisions d ON d.id=a.decision_id JOIN cases c ON c.id=d.case_id WHERE c.content_id=$1 AND a.status<>'RESOLVED'",
              [content.id],
            )),
            409,
            "OPEN_APPEAL",
            "This content is already under independent appeal review",
          );
          let c = await one(
            q,
            "SELECT * FROM cases WHERE content_id=$1 AND status<>'DECIDED' ORDER BY created_at DESC LIMIT 1",
            [content.id],
          );
          if (!c) {
            const p = await activePolicy(q),
              v = await one(
                q,
                "SELECT id FROM content_versions WHERE content_id=$1 AND number=$2",
                [content.id, content.revision],
              );
            c = { id: uid(), version_id: v!.id, policy_id: p.id };
            await q.query(
              "INSERT INTO cases(id,content_id,version_id,policy_id) VALUES($1,$2,$3,$4)",
              [c.id, content.id, c.version_id, c.policy_id],
            );
          }
          ensure(
            !(await one(
              q,
              "SELECT id FROM reports WHERE case_id=$1 AND reporter_id=$2",
              [c.id, r.user.id],
            )),
            409,
            "DUPLICATE_REPORT",
            "You already reported this review",
          );
          await q.query(
            "INSERT INTO reports(id,case_id,reporter_id,version_id,reason) VALUES($1,$2,$3,$4,$5)",
            [uid(), c.id, r.user.id, c.version_id, b.reason],
          );
          await q.query(
            "UPDATE cases SET status='PENDING_ANALYSIS',revision=revision+1,assignee=CASE WHEN assignee=$2 THEN NULL ELSE assignee END WHERE id=$1",
            [c.id, r.user.id],
          );
          await enqueue(q, c);
          await audit(q, r.user.id, "REPORT_SUBMITTED", c.id);
          return { caseId: c.id };
        }),
        201,
      ),
    ),
  );
  app.get(
    "/api/v1/cases",
    staff,
    wrap(async (r, s) => {
      const b = z
        .object({
          status: z.string().max(40).optional(),
          q: z.string().max(100).optional(),
          cursor: z.string().uuid().optional(),
        })
        .parse(r.query);
      const rows = (
        await db.query(
          `SELECT c.id FROM cases c JOIN content_versions v ON v.id=c.version_id WHERE ($1::text IS NULL OR c.status=$1) AND ($2::text IS NULL OR v.text ILIKE '%'||$2||'%') AND ($3::uuid IS NULL OR (c.created_at,c.id)<(SELECT created_at,id FROM cases WHERE id=$3)) ORDER BY c.created_at DESC,c.id DESC LIMIT 51`,
          [b.status || null, b.q || null, b.cursor || null],
        )
      ).rows;
      const data = [];
      for (const x of rows.slice(0, 50)) data.push(await caseData(db, x.id));
      return s.json({
        data,
        nextCursor: rows.length > 50 ? rows[49].id : null,
        requestId: r.requestId,
      });
    }),
  );
  app.get(
    "/api/v1/cases/:id",
    staff,
    wrap(async (r, s) => send(s, await caseDetail(db, id(r), r.user))),
  );
  app.post(
    "/api/v1/cases/:id/claim",
    roles("MODERATOR"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = Revision.parse(r.body),
            c = await caseDetail(q, id(r), r.user);
          revision(c.revision, b.expectedRevision);
          ensure(
            c.permittedActions.includes("CLAIM"),
            403,
            "FORBIDDEN",
            "Case is assigned or conflicts with your role",
          );
          await q.query(
            "UPDATE cases SET assignee=$2,revision=revision+1 WHERE id=$1",
            [c.id, r.user.id],
          );
          await audit(q, r.user.id, "CASE_CLAIMED", c.id);
          return { id: c.id };
        }),
      ),
    ),
  );
  app.post(
    "/api/v1/cases/:id/analyze",
    roles("MODERATOR"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = Revision.parse(r.body),
            c = await caseDetail(q, id(r), r.user);
          revision(c.revision, b.expectedRevision);
          ensure(
            c.permittedActions.includes("ANALYZE"),
            403,
            "FORBIDDEN",
            "Claim this case first",
          );
          ensure(
            !["ANALYZING", "PENDING_ANALYSIS"].includes(c.status),
            409,
            "JOB_ACTIVE",
            "Analysis is already queued or running",
          );
          await q.query(
            "UPDATE cases SET status='PENDING_ANALYSIS',revision=revision+1 WHERE id=$1",
            [c.id],
          );
          return { jobId: await enqueue(q, c), status: "QUEUED" };
        }),
        202,
      ),
    ),
  );
  app.post(
    "/api/v1/cases/:id/escalate",
    roles("MODERATOR"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = Revision.extend({
              reason: z.string().min(10).max(2000),
            }).parse(r.body),
            c = await caseDetail(q, id(r), r.user);
          revision(c.revision, b.expectedRevision);
          ensure(
            c.permittedActions.includes("ESCALATE"),
            403,
            "FORBIDDEN",
            "Claim this case first",
          );
          await q.query(
            "UPDATE cases SET assignee=NULL,revision=revision+1 WHERE id=$1",
            [c.id],
          );
          await audit(q, r.user.id, "CASE_ESCALATED", c.id, {
            reason: b.reason,
          });
          return { id: c.id };
        }),
      ),
    ),
  );
  app.post(
    "/api/v1/cases/:id/decisions",
    roles("MODERATOR"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, (q) =>
          decide(q, id(r), r.user, DecisionInput.parse(r.body)),
        ),
      ),
    ),
  );
  app.post(
    "/api/v1/decisions/:id/appeals",
    roles("AUTHOR"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = AppealInput.parse(r.body),
            d = await one(
              q,
              "SELECT d.*,c.content_id,o.author_id FROM decisions d JOIN cases c ON c.id=d.case_id JOIN contents o ON o.id=c.content_id WHERE d.id=$1",
              [id(r)],
            );
          ensure(
            d && d.author_id === r.user.id,
            404,
            "NOT_FOUND",
            "Decision not found",
          );
          ensure(
            ["WARN", "REMOVE"].includes(d.action),
            400,
            "NOT_APPEALABLE",
            "Only warnings and removals can be appealed",
          );
          ensure(
            !(await one(q, "SELECT id FROM appeals WHERE decision_id=$1", [
              d.id,
            ])),
            409,
            "DUPLICATE_APPEAL",
            "This decision already has an appeal",
          );
          const latest = await one(
            q,
            "SELECT id FROM content_versions WHERE content_id=$1 ORDER BY number DESC LIMIT 1",
            [d.content_id],
          );
          ensure(
            latest?.id === d.version_id,
            409,
            "NEWER_VERSION",
            "A newer content version exists",
          );
          ensure(
            !(await one(
              q,
              "SELECT id FROM cases WHERE content_id=$1 AND status<>'DECIDED'",
              [d.content_id],
            )),
            409,
            "ACTIVE_REVIEW",
            "A newer moderation review is already open",
          );
          const p = await activePolicy(q),
            a = uid();
          await q.query(
            "INSERT INTO appeals(id,decision_id,reason,evidence,policy_id) VALUES($1,$2,$3,$4,$5)",
            [a, d.id, b.reason, b.evidence, p.id],
          );
          await enqueue(
            q,
            { id: d.case_id, version_id: d.version_id, policy_id: p.id },
            a,
          );
          await audit(q, r.user.id, "APPEAL_SUBMITTED", a, {
            decisionId: d.id,
          });
          return { id: a };
        }),
        201,
      ),
    ),
  );
  app.get(
    "/api/v1/appeals",
    wrap(async (r, s) =>
      send(
        s,
        (
          await db.query(
            `SELECT a.*,d.action,o.author_id FROM appeals a JOIN decisions d ON d.id=a.decision_id JOIN cases c ON c.id=d.case_id JOIN contents o ON o.id=c.content_id WHERE ($1::text<>'AUTHOR' OR o.author_id=$2) ORDER BY a.created_at DESC LIMIT 100`,
            [r.user.role, r.user.id],
          )
        ).rows,
      ),
    ),
  );
  app.get(
    "/api/v1/appeals/:id",
    wrap(async (r, s) => {
      const a = await appealDetail(db, id(r), r.user);
      if (r.user.role === "AUTHOR")
        return send(s, {
          ...a,
          original: {
            action: a.original!.action,
            rationale: a.original!.rationale,
            created_at: a.original!.created_at,
          },
          original_actor: undefined,
          analysis: null,
          permittedActions: [],
        });
      return send(s, a);
    }),
  );
  app.post(
    "/api/v1/appeals/:id/claim",
    roles("REVIEWER"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = Revision.parse(r.body),
            a = await appealDetail(q, id(r), r.user);
          revision(a.revision, b.expectedRevision);
          ensure(
            a.permittedActions.includes("CLAIM"),
            403,
            "FORBIDDEN",
            "An independent available reviewer is required",
          );
          await q.query(
            "UPDATE appeals SET assignee=$2,status=CASE WHEN status='AWAITING_REEVALUATION' THEN status ELSE 'UNDER_REVIEW' END,revision=revision+1 WHERE id=$1",
            [a.id, r.user.id],
          );
          await audit(q, r.user.id, "APPEAL_CLAIMED", a.id);
          return { id: a.id };
        }),
      ),
    ),
  );
  app.post(
    "/api/v1/appeals/:id/resolve",
    roles("REVIEWER"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, (q) =>
          resolveAppeal(q, id(r), r.user, ResolutionInput.parse(r.body)),
        ),
      ),
    ),
  );
  app.get(
    "/api/v1/policies",
    wrap(async (_r, s) =>
      send(
        s,
        (await db.query("SELECT * FROM policies ORDER BY version DESC")).rows,
      ),
    ),
  );
  app.get(
    "/api/v1/policy-drafts",
    roles("ADMIN"),
    wrap(async (_r, s) =>
      send(
        s,
        (await db.query("SELECT * FROM drafts ORDER BY created_at DESC")).rows,
      ),
    ),
  );
  app.post(
    "/api/v1/policies/drafts",
    roles("ADMIN"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = PolicyInput.parse(r.body),
            d = uid();
          await q.query(
            "INSERT INTO drafts(id,title,clauses) VALUES($1,$2,$3)",
            [d, b.title, JSON.stringify(b.clauses)],
          );
          await audit(q, r.user.id, "DRAFT_CREATED", d);
          return { id: d, revision: 1 };
        }),
        201,
      ),
    ),
  );
  app.patch(
    "/api/v1/policies/drafts/:id",
    roles("ADMIN"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, async (q) => {
          const b = PolicyInput.parse(r.body),
            expected = Revision.parse(r.body).expectedRevision,
            d = await one(q, "SELECT * FROM drafts WHERE id=$1", [id(r)]);
          ensure(d, 404, "NOT_FOUND", "Draft not found");
          revision(d.revision, expected);
          await q.query(
            "UPDATE drafts SET title=$2,clauses=$3,revision=revision+1 WHERE id=$1",
            [id(r), b.title, JSON.stringify(b.clauses)],
          );
          await audit(q, r.user.id, "DRAFT_UPDATED", id(r));
          return { id: id(r), revision: expected + 1 };
        }),
      ),
    ),
  );
  app.post(
    "/api/v1/policies/drafts/:id/publish",
    roles("ADMIN"),
    write,
    wrap(async (r, s) =>
      send(
        s,
        await mutation(r, (q) =>
          publish(q, id(r), r.user, Revision.parse(r.body).expectedRevision),
        ),
      ),
    ),
  );
  app.get(
    "/api/v1/audit",
    staff,
    wrap(async (r, s) => {
      const cursor = r.query.cursor
        ? z.string().uuid().parse(r.query.cursor)
        : null;
      const rows = (
        await db.query(
          "SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE ($1::uuid IS NULL OR (a.created_at,a.id)<(SELECT created_at,id FROM audit WHERE id=$1)) ORDER BY a.created_at DESC,a.id DESC LIMIT 51",
          [cursor],
        )
      ).rows;
      return s.json({
        data: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49].id : null,
        requestId: r.requestId,
      });
    }),
  );
  app.get(
    "/api/v1/jobs/:id",
    staff,
    wrap(async (r, s) => {
      const j = await one(
        db,
        "SELECT id,status,error,attempts,created_at FROM jobs WHERE id=$1",
        [id(r)],
      );
      ensure(j, 404, "NOT_FOUND", "Job not found");
      return send(s, j);
    }),
  );
  app.use("/api", (_r, _s, next) =>
    next(new AppError(404, "NOT_FOUND", "API route not found")),
  );
  app.use(
    (error: unknown, req: Request, res: Response, _next: NextFunction) => {
      const e = error as any;
      const status =
        e instanceof ZodError
          ? 400
          : e instanceof AppError
            ? e.status
            : e?.code === "23505"
              ? 409
              : e?.status === 413
                ? 413
                : 500;
      const code =
        e instanceof ZodError
          ? "VALIDATION"
          : e instanceof AppError
            ? e.code
            : status === 409
              ? "CONFLICT"
              : "SERVER_ERROR";
      if (status === 500)
        console.error(
          JSON.stringify({
            event: "request_failed",
            requestId: (req as Authed).requestId,
            errorType: e?.name,
            code: e?.code,
          }),
        );
      res
        .status(status)
        .json({
          error: {
            code,
            message:
              e instanceof ZodError
                ? "Check the required fields"
                : e instanceof AppError
                  ? e.message
                  : status === 409
                    ? "This operation conflicts with an existing record"
                    : "Request could not be completed",
            fieldErrors:
              e instanceof ZodError ? e.flatten().fieldErrors : undefined,
          },
          requestId: (req as Authed).requestId,
        });
    },
  );
  return app;
}
