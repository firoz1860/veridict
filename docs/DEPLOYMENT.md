# Deployment

Use Node.js 22+ and PostgreSQL 16+. Render runs the API and worker; Vercel serves the frontend and proxies API requests. See `.env.example` and `render.yaml` for the complete configuration.

## Render

Build: `npm ci`. Predeploy: `npm run db:migrate`. Start: `npm start`.

Set `DATABASE_URL`, `NODE_ENV=production`, `APP_ORIGIN` to the exact Vercel origin without a trailing slash, and `RUN_WORKER=true`. Set `AI_MODE=fixture` for a labeled deterministic demo, or `AI_MODE=live` with `AI_API_KEY` and `AI_MODEL` for automatic live analysis. User connections do not fund automatic jobs.

For personal provider keys, set `AI_ENCRYPTION_KEY` to the base64 encoding of 32 random bytes. Generate it with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

API and worker must use the same encryption key. Preserve it across deployments. Configure `AI_CUSTOM_ALLOWED_HOSTS` only for trusted HTTPS provider hosts.

On a fresh database, set a private `SEED_PASSWORD` of at least 12 characters and run `npm run db:seed` once. Reseeding does not update existing passwords.

## Upgrade for review integrity fixes

Pause workers and deploy the API/worker together after `npm run db:migrate`. This adds `jobs.requested_model` and `resolutions.visibility_applied`. Legacy personal jobs are backfilled with their credential's model at migration time; their original selection cannot be recovered if it had already changed. Newly queued jobs always snapshot the model. Migration is additive and repeatable. Restart workers after migration.

## Vercel

Import the repository with the Vite preset. Build: `npm run build`. Output: `dist`. Ensure the API rewrite destination in `vercel.json` points to your Render service (the checked-in destination is the project's existing service). Keep `/api` on the frontend origin so cookies work consistently. Frontend provider or database secrets are not needed.

## Verification

Open `/api/v1/health/ready` through the frontend. Expect HTTP 200 and `data.database=true`, `data.worker=true`. Sign in, submit content, moderate it, submit an appeal, and resolve it with a separate reviewer account. Verify personal AI requests separately using an account and model with available credit. Fixture/browser tests do not prove live provider compatibility.

## Previously published demonstration password

The old README included a demonstration password. Removing it does not remove it from Git history or change existing accounts. If it was used on your deployment, rotate every affected account password and revoke its sessions. Merely changing `SEED_PASSWORD` is insufficient.

An operator with database access can run the following in the backend's Bash shell for each affected email. Input is read without echo; do not put the password in command history. This changes the chosen user's password and invalidates all of that user's sessions in one transaction.

```bash
read -r -p 'Account email: ' RESET_EMAIL
read -r -s -p 'New password (12+ characters): ' RESET_PASSWORD
export RESET_EMAIL RESET_PASSWORD
node --import tsx --input-type=module <<'JS'
import { postgres, one } from './server/db.ts';
import { passwordHash } from './server/auth.ts';
const email = process.env.RESET_EMAIL?.trim().toLowerCase();
const password = process.env.RESET_PASSWORD;
if (!email || !password || password.length < 12) throw new Error('Email and a 12+ character password are required');
const hashed = await passwordHash(password);
const db = postgres();
try {
  await db.tx(async q => {
    const user = await one(q, 'UPDATE users SET password=$2 WHERE email=$1 RETURNING id', [email, hashed]);
    if (!user) throw new Error('Account not found');
    await q.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
  });
  console.log('Password changed; sessions revoked.');
} finally { await db.close(); }
JS
unset RESET_EMAIL RESET_PASSWORD
```

This PR does not rotate deployed credentials or execute a deployment.

## Startup schema upgrades

The API runs the existing repeatable migrations before starting the worker or HTTP listener. If migration fails, startup fails instead of serving an incompatible schema. This also supports manually configured Render services without a pre-deploy command. Startup does not seed users or reset passwords.
