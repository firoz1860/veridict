# API → Screen map

How each screen in the redesigned frontend maps to the real Express backend. Every endpoint is under `/api/v1`. Responses use the envelope `{ data, requestId, nextCursor? }`; errors use `{ error: { code, message, fieldErrors? }, requestId }`. All mutations require a `write` guard (matching `Origin` + `x-csrf-token`) and an `Idempotency-Key` header; revisioned resources also require `expectedRevision`. Roles: `AUTHOR`, `MODERATOR`, `REVIEWER`, `ADMIN` (the last three are "staff").

This map reflects what the backend actually implements. Where the UI would like a capability the backend does not expose, it is listed under **Gaps**.

---

## Session (all screens)

| Concern | Endpoint | Notes |
| --- | --- | --- |
| Restore session | `GET /auth/me` | Returns `{id,name,email,role}` for the `vd_session` cookie; 401 → unauthenticated. |
| CSRF bootstrap | `GET /auth/csrf` | Mints an anonymous session + csrf before login; client caches csrf and rotates it from mutation responses. |
| Login | `POST /auth/login` | Body `{email,password}`. Rotates the session. Returns `{user, csrf}`. 401 `INVALID_CREDENTIALS`, 429 `RATE_LIMIT`. |
| Logout | `POST /auth/logout` | Deletes the session row, clears the cookie. |

Client behaviour: a 401 on any non-login request dispatches a `session-expired` event that clears local state and returns the user to the login screen. Session tokens live only in the `httpOnly` cookie — never in `localStorage`.

---

## Public introduction — `/about` (public; also reachable when signed in)

- **Purpose:** truthful product introduction and entry point to sign-in.
- **Roles:** anyone (no auth). Signed-in users get an "Open workspace" CTA to their role's home.
- **Endpoints:** none — static, derived entirely from documented behaviour.
- **Actions:** anchor navigation (Workflow/Roles/Principles/FAQ), CTA → `/` (sign-in) or role workspace.
- **States:** n/a (no data fetch). Reduced-motion disables decorative motion; nav collapses to an accessible drawer on mobile.

## Login — `/` (unauthenticated)

- **Purpose:** authenticate an invited user.
- **Endpoints:** `GET /auth/csrf` then `POST /auth/login`.
- **Request fields:** `email`, `password`. **Response:** `{ user, csrf }`.
- **Actions:** sign in; show/hide password; link to `/about`.
- **States:** idle, submitting, error (invalid credentials / rate limit / origin). No signup, OAuth, or reset — the backend has none.

## Overview — `/` (staff)

- **Purpose:** what needs attention now.
- **Endpoints:** `GET /dashboard` (poll 10s) → `{ pending, appeals, stale, failed }`; `GET /cases` → recent `CaseRow[]`.
- **Actions:** each stat card links to the matching screen (`/queue`, `/appeals`, `/queue`, `/status`).
- **States:** loading (spinner), zero (card shows `0`), failed (inline error). Recent-cases table has its own loading/empty/error.

## Moderation queue — `/queue` (staff)

- **Purpose:** search and triage cases.
- **Endpoints:** `GET /cases?status=&q=&cursor=` → `{ data: CaseRow[], nextCursor }`.
- **Request fields:** `status` (one of `PENDING_ANALYSIS|ANALYZING|READY_FOR_REVIEW|ANALYSIS_FAILED|DECIDED`), `q` (text ILIKE), `cursor` (keyset uuid). Filter state is kept in the URL.
- **Response fields used:** `id, text, type, author_name, status, severity, policy_version, isStale, analysis, created_at`.
- **Actions:** search (debounced), status filter, first/next page, open case.
- **States:** queued/analyzing/failed/stale/ready/decided shown via badges + a "stale evidence" marker. Loading, empty, error handled. Pagination caps at 50/page.

## Case review — `/cases/:id` (staff) — highest priority

- **Purpose:** review evidence against immutable snapshots and record a human decision.
- **Endpoints:** `GET /cases/:id` (poll 4s) → `CaseDetail`; mutations: `POST /cases/:id/claim`, `/decisions`, `/analyze`, `/escalate`.
- **Response fields used:** `text` (immutable snapshot), `parent_text`, `reports[]` (allegations), `history[]`, `policy` (+clauses), `analysis`/`analyses[]`, `decision`, `permittedActions`, `revision`, `isStale`, `status`.
- **Findings:** each shows source (`DETERMINISTIC` vs `AI`), exact `policyQuote`, exact content span (`text.slice(start,end)` — UTF-16 offsets, no fuzzy matching), `severity`, `certainty` (Supported/Uncertain), `confidence`, and "human judgment required". Clicking a citation highlights the exact span in the snapshot only when `end <= text.length` (guards against highlighting a newer version).
- **Actions (gated by `permittedActions`):** `CLAIM`, `DECIDE` (allow/warn/remove with disposition approve/reject/modify + clause keys + rationale + manualReview), `ANALYZE` (re-run), `ESCALATE`. Removal uses an accessible confirmation dialog; it is never the default.
- **Request fields:** all decision mutations send `expectedRevision`; decisions send `{action, disposition, rationale, clauseKeys, manualReview}`.
- **States:** stale/failed-analysis notices; 409 handling preserves the rationale (see Error handling). AI never enforces an action.

## My content / Community — `/content`, `/community` (author)

- **Purpose:** create content and follow its review history; read the community feed and report concerns.
- **Endpoints:** `GET /contents?mine=` → `ContentRow[]`; `POST /contents` (create); `GET /contents/:id` (+`history`); `POST /contents/:id/versions` (edit); `POST /contents/:id/reports`.
- **Request fields:** create `{text, type, parentId}`; edit `{text, expectedRevision}`; report `{reason}`.
- **Actions:** compose post/comment (char limits match backend: 1–5000), edit own content, report others' visible content.
- **States:** visibility + review status badges; edit blocked by an open appeal surfaces `OPEN_APPEAL` (409) as a clear message. No reporter identities or staff notes are shown to authors.

## Content detail — `/content/:id` (author)

- **Endpoints:** `GET /contents/:id`; `POST /decisions/:id/appeals`.
- **Actions:** view decision history; appeal an eligible `WARN`/`REMOVE` decision once `{reason, evidence}`.
- **States:** appeal control only shows for appealable, un-appealed decisions on own content; after submit, navigates to the appeal.

## Appeals — `/appeals`, `/appeals/:id`

- **Purpose:** list and resolve appeals; authors see their own (redacted).
- **Endpoints:** `GET /appeals` → `AppealRow[]`; `GET /appeals/:id` → `AppealDetail`; `POST /appeals/:id/claim`, `/resolve` (reviewer).
- **Response fields used:** `original` decision, `text`, `originalPolicy` vs `currentPolicy` (made visually explicit), `analysis` (staff only), `resolution`, `permittedActions`, `revision`, `status`.
- **Request fields:** resolve `{expectedRevision, outcome(UPHELD|OVERTURNED|MODIFIED), action, rationale, policyId, manualReview}`.
- **Actions:** `CLAIM`, `RESOLVE` (independent reviewers only). Resolution uses an accessible confirmation dialog. AI never resolves an appeal.
- **Author redaction:** for authors the backend returns `analysis: null`, no original actor, and `permittedActions: []` — the UI respects this and shows no staff-only evidence.
- **States:** policy-changed notice when original ≠ current; awaiting-reviewer message; the original decision maker can never gain resolve powers (enforced server-side via `permittedActions`).

## Policies — `/policies`

- **Purpose:** read published versions; admins draft, edit, and publish.
- **Endpoints:** `GET /policies` → `Policy[]`; `GET /policy-drafts` (admin) → drafts; `POST /policies/drafts`, `PATCH /policies/drafts/:id`, `POST /policies/drafts/:id/publish`.
- **Request fields:** draft `{title, clauses[{key,text,severity,term}]}` (+`expectedRevision` on PATCH/publish).
- **Actions:** select version, create/edit draft, add/remove clauses, **Save & publish**. Publish saves the current edits first, then publishes against the server-confirmed revision — unsaved edits are never discarded. Confirmation dialog explains re-evaluation scheduling.
- **States:** published versions are immutable; publish response reports `scheduled` (cases+appeals re-evaluated). Draft editing is admin-only.
- **Gaps:** no clause-level diff endpoint exists; version comparison is done client-side from the returned clause arrays.

## Audit trail — `/audit` (staff)

- **Endpoints:** `GET /audit?cursor=` → `{ data, nextCursor }`.
- **Response fields used:** `action`, `actor` (name or "System"), `resource_id`, `created_at`, `detail` (JSON).
- **Actions:** paginate (keyset). No edit/delete controls — the backend exposes none (append-only).

## Service status — `/status` (staff)

- **Endpoints:** `GET /status` (poll 5s) → `{ aiMode, aiConfigured, workerHealthy, heartbeat, jobs[] }`.
- **Display:** AI mode (fixture clearly labelled "not live AI"; live shows "configured — not a verified live request", never conflating configuration with a verified call); worker health + last heartbeat; job counts by status. No secrets or raw env values are shown.

---

## Error handling (all mutations)

| Status | Code examples | UI behaviour |
| --- | --- | --- |
| 400 | `VALIDATION`, `ACTION_MISMATCH`, `CLAUSE_REQUIRED` | Inline message; field errors where provided. |
| 401 | `LOGIN_REQUIRED` | `session-expired` → return to login. |
| 403 | `FORBIDDEN`, `ORIGIN`, `CSRF` | Permission/verification message; csrf re-bootstrapped on next mutation. |
| 404 | `NOT_FOUND` | Resource-unavailable message. |
| 409 | `STALE_REVISION`, `ALREADY_DECIDED`, `OPEN_APPEAL`, `STALE_POLICY`, `NEWER_CONTENT`, … | The user's typed rationale is preserved, the record is reloaded, and the conflict is explained. No silent resubmit against the new revision. |
| 429 | `RATE_LIMIT` | Back-off message. |
| 5xx / network | `SERVER_ERROR`, `AI_UNAVAILABLE` | Failure surfaced; no fake success, no sample data. |

Idempotency: a protected mutation retried after a failure reuses the same `Idempotency-Key` + payload. Changing the payload under the same key returns 409 `KEY_REUSED`, so the client generates a fresh key per distinct submission. Polling stops on terminal states and is cleaned up on navigation; stale responses never overwrite newer data (guarded by an `active` flag per effect).

## Gaps / unsupported (deliberately not built in the UI)

- No notifications, profile editing, settings, uploads, or email — the backend has none.
- No clause-level diff endpoint (comparison is client-side).
- Live-AI correctness cannot be asserted from the UI; status only reports configuration + worker health.
- `/contents`, `/appeals`, `/policies`, `/policy-drafts` are capped lists (100 / version list) with no cursor; only `/cases` and `/audit` paginate.
