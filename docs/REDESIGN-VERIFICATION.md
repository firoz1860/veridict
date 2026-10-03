# Redesign verification report

Date: 2026-10-03. Scope: editorial visual redesign of the Veridict frontend, backend integration preserved.

## Automated checks (actually run)

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | **Pass** (0 errors) |
| Production build | `npm run build` | **Pass** — app chunk ~616 KB (163 KB gzip), `/about` split into a separate 48 KB lazy chunk, CSS 37.5 KB |
| Domain + API/SQL integration | `npm test` | **Pass** — 16/16 (PGlite, real Express) |
| Browser E2E | `npm run test:e2e` | **Pass** — 3/3 (Chromium, isolated PGlite + fixture provider) |

E2E covers: author login + content creation; moderator claim + citation inspection; explicit removal via the new accessible confirmation dialog; author appeal; independent reviewer overturn via the new dialog; restored visibility; the new public `/about` navigation + CTA → sign-in; and the dashboard/mobile layout (no page error, no horizontal overflow at 390px).

## Manual + scripted verification (against the live stack on Neon PostgreSQL, fixture AI)

Captured with Playwright at 1440px and 390px (see `docs/screenshots/`):

- `public-hero`, `public-full` — hero, problem, workflow (illustrative SVG stages), roles tablist, principles, FAQ, footer.
- `login` — dark editorial brand panel + warm form, password reveal, About link.
- `dashboard` — real counts (6 awaiting review, 0 appeals/stale/failed at capture), recent cases table.
- `queue` — real cases, status badges.
- `case-review` — immutable snapshot, fixture assessment labelled "FIXTURE · NOT LIVE AI", advisory Allow, "a human decision is still required", sticky decision panel, Claim case.
- `policies`, `appeals` — version list + draft editor; appeals queue.
- `mobile-about`, `mobile-nav` (drawer open), `mobile-dashboard`.

Checklist outcomes (brief §12):
1. Public navigation + CTAs — verified (E2E + screenshots).
2. Login + session restoration — verified (`/auth/me`, cookie).
3. Role-aware navigation — verified (staff vs author links).
4. Real dashboard values — verified (counts from `/dashboard`).
5. Queue search/filter/pagination/deep links — URL-backed filters; verified.
6–12. Author create → moderator claim → removal (dialog) → appeal → independent overturn → restored visibility — verified end-to-end by the E2E flow.
13–15. Policy draft edit/publish, re-evaluation scheduling, historical preservation — publish path saves-then-publishes; backend enforces re-pin + original-policy retention (covered by integration tests).
16–20. Logout/expiry, permission-denied, validation/empty/slow/failure, duplicate-submission (idempotency), stale-revision without lost input — backend-enforced; UI preserves rationale on 409 and reuses idempotency keys.

## Accessibility & responsiveness

- No horizontal overflow at 390px (asserted in E2E `scrollWidth <= innerWidth`).
- Skip link, focus-visible rings, accessible dialog (focus trap/Escape/restore), mobile drawer with `aria-expanded` + scrim + Escape, role `tablist` on `/about`.
- `prefers-reduced-motion` disables decorative/continuous motion globally.

## Deployment compatibility (unchanged)

`vercel.json` (API rewrite before SPA fallback, relative `/api` calls), `render.yaml` (API + worker + Postgres), and `vite.config.ts` are untouched. Frontend output dir unchanged. No secrets in browser-exposed env.

## Not verified / external requirements

- **Live AI provider:** only fixture mode was exercised. Live mode needs real `AI_API_KEY`/`AI_MODEL` and must be smoke-tested in your environment; the UI deliberately does not claim a verified live request.
- **Vercel/Render production deploy** and production cross-proxy cookies: not performed here (prepare-only, per the brief).
- **200% zoom and 1920px** visual passes were not scripted; 390/768/1024/1440 were checked.
- The dev stack used the user-supplied **Neon** database; the Neon connection string lives only in the gitignored `.env`.
