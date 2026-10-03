# Verification record

Verified locally on 2026-10-03:

- TypeScript checking and Vite production build: passed.
- 16 domain and API/SQL integration tests: passed.
- 2 Chromium end-to-end tests: passed.
- Production dependency audit: 0 reported vulnerabilities at verification time.
- Desktop dashboard and 390px mobile policy screen: screenshot inspection.

The real-browser workflow covered author login and content creation, a completed fixture assessment, explicit moderator removal, author appeal submission, independent reviewer claim and overturn, and restored visibility. Separate browser contexts preserved role/session separation. The layout test checked for page overflow and browser page errors.

Integration tests cover citation correctness and range bounds, ownership and CSRF, idempotency, assigned-moderator enforcement, independent reviewer restrictions, original policy retention, stale revisions, content edits, provider failure with manual review, policy changes during an appeal, and conflicting report prevention.

Database tests run actual PostgreSQL SQL using PGlite in isolated test databases. They are not a managed Render PostgreSQL deployment test. Live provider calls are implemented but were not executed with a real paid provider key. Vercel/Render production deployment, production cookies across the configured proxy, and live AI must be smoke-tested using your own configuration as described in DEPLOYMENT.md. No deployment or provider credentials are included.
