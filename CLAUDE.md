# Veridict — project guide for Claude Code

Text moderation workspace: evidence-linked AI assistance, human decisions, independent appeals, immutable policy versions, and an append-only audit trail. This file captures project-specific architecture; global engineering rules live in the user's global CLAUDE.md.

## Stack

- **Frontend:** React 19 + Vite 6 + react-router-dom 7 (`web/`), typed API client (`web/api.ts`).
- **Backend:** Express 5 (`server/app.ts`) with sessions, CSRF, authorization, rate limits, Helmet.
- **Worker:** durable job queue with leases/retries (`server/jobs.ts`), run in-process via `RUN_WORKER=true` or standalone via `npm run worker`.
- **Contracts:** shared Zod request/AI schemas + DTO types (`shared/contracts.ts`).
- **Database:** PostgreSQL via explicit SQL (`server/schema.sql`, `server/db.ts`), `pg` pool. Tests use embedded PGlite.
- **Runtime:** Node >= 22, ES modules (`"type": "module"`), `tsx` for TS execution.

## Layout

- `server/app.ts` — HTTP routes (`/api/v1/...`), sessions, CSRF, authz, error envelope.
- `server/service.ts` — transactional case/appeal/policy workflows.
- `server/jobs.ts` — durable queue, leases, retries, supersession, audit.
- `server/ai.ts` — deterministic fixture checks + live OpenAI-compatible adapter (schema-validated, citation-checked).
- `server/db.ts` / `server/schema.sql` — data access + relational schema.
- `server/{migrate,seed,seed-data}.ts` — schema apply + demo accounts/samples.
- `web/` — React UI, responsive styling, typed client.
- `tests/` — domain unit, SQL/API integration (PGlite + real Express), Playwright browser E2E.

## Commands

```bash
npm run dev          # API (:3001) + worker + Vite frontend (:5173)
npm run db:migrate   # apply schema.sql to DATABASE_URL
npm run db:seed      # create demo accounts (idempotent; never resets existing passwords)
npm run typecheck    # tsc --noEmit
npm run build        # tsc --noEmit && vite build
npm test             # domain + API/SQL integration (PGlite, no external DB)
npm run test:e2e     # Playwright chromium (spins up its own isolated PGlite stack on 3001/5173)
npm run format       # prettier
```

E2E note: `playwright.config.ts` uses `reuseExistingServer: false` and binds 3001 + 5173 itself — stop any running `npm run dev` before `npm run test:e2e`.

## Environment (`.env`, gitignored)

`DATABASE_URL`, `PORT`, `APP_ORIGIN`, `NODE_ENV`, `RUN_WORKER`, `AI_MODE` (`fixture` | `live`), `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `SEED_PASSWORD` (>= 12 chars). `fixture` AI mode runs offline deterministic rules; `live` calls a JSON-mode OpenAI-compatible endpoint. See `.env.example`.

## Invariants (do not weaken)

- AI is advisory only — no AI path may enforce a moderation action.
- Decisions, analyses, audit, and published policy history are append-only (no update/delete HTTP routes).
- Each case/appeal pins immutable content + policy snapshots; prior decisions keep their original policy.
- Server-enforced roles/ownership; independent reviewer conflict checks; CSRF token + origin validation.
- Live-mode AI outputs are schema-validated and every policy quote / content offset is verified against pinned input; unsupported citations fail the job rather than becoming a finding.

## Deploy

Vercel (frontend, proxies `/api` to Render) + Render (API, worker, PostgreSQL). See `DEPLOYMENT.md`. No credentials are committed.
