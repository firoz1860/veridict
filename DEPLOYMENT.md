# Vercel frontend + Render API and worker

## 1. Repository

Extract the ZIP and push the contents of `veridict/` as the repository root. Keep `.env` out of Git. Commit `package-lock.json`. Do not upload `node_modules`.

## 2. Render

Create a Blueprint from `render.yaml`, or create a Node web service and PostgreSQL database manually.

The supplied Blueprint uses a paid starter web instance and a basic PostgreSQL plan. Review Render's pricing before creating resources. The worker runs inside the API process by default, avoiding a separate worker service. A sleeping/free instance may delay processing; it cannot guarantee continuous background execution.

Manual settings:

- Build command: `npm ci`
- Pre-deploy command: `npm run db:migrate`
- Start command: `npm start`
- Health path: `/api/v1/health/live`
- Node version: 22+
- `NODE_ENV=production`
- `DATABASE_URL`: Render internal PostgreSQL connection string
- `RUN_WORKER=true`
- `APP_ORIGIN`: exact Vercel frontend origin, e.g. `https://veridict-yourname.vercel.app` (no trailing slash)
- `AI_MODE=live`
- `AI_API_KEY`: your provider key (server only)
- `AI_MODEL`: your provider's JSON-mode-compatible model identifier
- `AI_BASE_URL`: optional, defaults to `https://api.openai.com/v1`
- `SEED_PASSWORD`: your strong temporary demonstration password

If Vercel's URL is not known yet, create the Vercel project, copy its assigned production URL, and update APP_ORIGIN before testing login. Do not enable wildcard origins. Preview deployments need their own backend origin configuration to use authenticated writes.

Run these once in Render's shell after the database is connected:

```bash
npm run db:migrate
npm run db:seed
```

The seed is idempotent and does not reset existing passwords. Remove `SEED_PASSWORD` from runtime settings after seeding if no longer needed. API readiness at `/api/v1/health/ready` includes worker heartbeat. Render's liveness probe intentionally uses `/health/live` so a temporary AI outage does not trigger restart loops.

## 3. Configure Vercel proxy

From the local project root:

```bash
npm run configure:vercel -- https://YOUR-ACTUAL-API.onrender.com
```

This changes `vercel.json` from its explicit placeholder to your actual Render origin. Commit that change. No API credentials are needed on Vercel. Never put the AI key into a `VITE_` variable.

Import the same repository into Vercel:

- Root directory: repository root
- Framework: Vite
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `dist`

The `/api/:path*` rewrite must stay before the SPA fallback. The browser always uses relative `/api/v1` requests. The proxy preserves the backend's host-only HttpOnly session cookie on the frontend origin. API responses use no-store headers.

## 4. Smoke checks

1. Open the frontend and log in using a seeded account and your seed password.
2. Author creates content; moderator can see it in the queue.
3. Admin Service status shows healthy worker and `live` AI configured.
4. Open a review and verify its actual model assessment. A configured key is not proof of a successful model request.
5. Moderator decides; author appeals; a distinct reviewer resolves.
6. Admin publishes a revised policy and verifies unresolved items are re-evaluated.
7. Refresh pages and verify sessions and data persist.
8. `/api/v1/health/ready` returns 200 when the database and worker are healthy.

If login fails with ORIGIN, make APP_ORIGIN match the browser URL exactly. If a request returns HTML instead of JSON, correct the first Vercel rewrite. If cases stay pending, check RUN_WORKER and Render logs. If AI fails, check provider billing, model support, API key, and base URL; fixture mode is visibly labeled and never an automatic fallback.

## Separate worker option

Set `RUN_WORKER=false` on the API and create a Render background worker with `npm ci` / `npm run worker`. Give it the same DATABASE_URL and AI variables. The worker doesn't need APP_ORIGIN or seed password. Do not run migrations automatically inside every worker start; apply migrations before starting upgraded services.
