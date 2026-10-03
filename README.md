# Veridict

A text moderation workspace with evidence-linked AI assistance, human decisions, independent appeals, immutable policy versions, and an audit trail.

## Run locally

Use Node.js 22 or newer and PostgreSQL 16+.

```bash
npm ci
cp .env.example .env
docker compose up -d
```

Edit `.env`: set `SEED_PASSWORD` to a strong password of at least 12 characters. Set `AI_MODE=fixture` for an explicitly labeled deterministic demonstration, or `AI_MODE=live` with your `AI_API_KEY` and a JSON-mode-compatible `AI_MODEL` for real AI review (this is the server-funded provider used for automatic analysis).

For the Bring-Your-Own-Key (BYOK) feature, set `AI_ENCRYPTION_KEY` to the base64 encoding of 32 random bytes (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`); the API and the worker must share the same value or saved keys cannot be decrypted. Set `AI_CUSTOM_ALLOWED_HOSTS` to a comma-separated allowlist of HTTPS hosts permitted for Custom OpenAI-compatible providers (leave empty to disallow custom endpoints). Signed-in users connect their own provider key from the "Connect your AI provider" setup modal or the `/settings` → AI connection screen; keys are verified, encrypted at rest (AES-256-GCM), and used only for AI work the user explicitly requests.

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:5173. The API listens on 3001. `RUN_WORKER=true` starts the persistent job consumer in the API process. Alternatively set it false and run `npm run worker` separately with the same environment/database. Do not use both modes unless you intend to run multiple lease-safe consumers.

## Accounts

The seed command creates these accounts with your `SEED_PASSWORD`. Existing accounts and passwords are never overwritten by reseeding.

| Email                     | Role                        |
| ------------------------- | --------------------------- |
| author@veridict.local     | Author                      |
| author2@veridict.local    | Second author/reporter      |
| moderator@veridict.local  | Moderator                   |
| moderator2@veridict.local | Second moderator            |
| reviewer@veridict.local   | Independent appeal reviewer |
| reviewer2@veridict.local  | Second appeal reviewer      |
| admin@veridict.local      | Policy administrator        |

Share demonstration credentials privately. There is no public account registration. Use separate browser profiles for different roles, or log out before switching.

## Deploy yourself: Render + Vercel

Full steps are in [DEPLOYMENT.md](DEPLOYMENT.md). Render runs the API, durable worker, and PostgreSQL. Vercel serves the frontend and proxies `/api` to Render so sessions stay same-origin. The ZIP does not contain credentials or a deployment.

## Public introduction

A public product introduction lives at `/about` (no login required). The sign-in screen at `/` links to it, and its primary CTA leads back to sign-in. The authenticated dashboard stays at `/`.

## Project layout

- `web/`: React UI, responsive styling, typed API client. Editorial design system in `web/styles.css`; public page in `web/pages/public/About.tsx` (lazy-loaded).
- `docs/API-TO-SCREEN.md`, `docs/design-system.md`, `docs/REDESIGN-VERIFICATION.md`: frontend ↔ backend map, design tokens, and verification results.
- `shared/contracts.ts`: Zod request/AI schemas and shared DTO types.
- `server/app.ts`: HTTP routes, sessions, CSRF, authorization, errors.
- `server/service.ts`: transactional case/appeal/policy workflows.
- `server/jobs.ts`: durable queue, leases, retries, supersession and audit.
- `server/ai.ts`: deterministic checks and live provider adapter.
- `server/schema.sql`: relational schema and indexes.
- `tests/`: domain, SQL/API integration, and real-browser tests.

## Workflow

1. An author submits a post/comment; a review is queued against immutable content and policy snapshots.
2. Deterministic rules and AI produce advisory findings with exact policy and content citations.
3. A moderator claims a case and records allow/warn/remove, or escalates it. AI cannot enforce an action.
4. The author can appeal an adverse decision once. An independent reviewer claims and resolves the appeal.
5. A published policy schedules re-evaluation of unresolved cases and open appeals. Prior decisions keep their original policy. Stale forms are rejected.

## AI behavior

Live mode calls a server-configured OpenAI-compatible Chat Completions endpoint. Model outputs are schema-validated and all policy quotes and UTF-16 content offsets are checked against pinned input. Reports are treated as allegations; previous decisions are context. Unsupported citations fail the job instead of becoming a finding. Provider calls have bounded timeouts and one retry/repair attempt. No AI tools can enforce moderation.

Fixture mode only runs configured exact-text rules and labels its output accordingly. It is useful for repeatable testing, not a substitute for a real model. Live provider behavior requires your credentials and must be verified after configuration.

## Integrity and security

Server-enforced roles and ownership, independent reviewer conflict checks, scrypt passwords, expiring database-backed sessions, CSRF token plus origin validation, rate limits, body limits, plain-text rendering, immutable version records, revision conflicts, and idempotent transactional mutations. The worker cannot change visibility. The global transaction lock deliberately favors correctness for a small review team over high write throughput.

The HTTP application exposes no update/delete route for audit, decisions, analyses, or published policy history. This is application-level append-only behavior, not cryptographic tamper-proofing against a database administrator. Use database backups and restrict deployment/database access.

## Verification

```bash
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

API integration tests use PGlite (embedded PostgreSQL) with actual SQL and real Express requests. Browser tests run a real frontend and API against an isolated embedded database and fixture provider. They do not mock all API routes. See `VERIFICATION.md` for the checks actually run on this package.

## Deliberate boundaries

Text only, one controlled community, invited demo accounts, no real social network, no automatic bans, no file attachments, no email. Content/appeal views show the latest 100 records; case and audit tables support pagination. Exact-match deterministic rules identify strings, not semantic intent. Context-sensitive interpretation is delegated to the configured model and ultimately a human. The source is deployment-ready but deployment and live provider validation require your own environment and keys.
