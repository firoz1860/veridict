# Verification

Review integrity fixes, verified locally on 2026-10-03 with Node.js 24.19.0. CI is configured for Node.js 22.

- `npm run build`: TypeScript check and Vite production build passed.
- `npm test`: 32 tests passed, using actual Express routes and SQL on isolated PGlite databases.
- `npm run test:e2e`: 3 Chromium browser tests passed, including content submission, moderation, appeal analysis retry, independent resolution, restoration, public navigation and mobile layout.
- `git diff --check`: passed.

Regression tests first reproduced the previous behavior: queued requests changed models, historical appeal resolution returned 409, and appeal retry routes were missing. Tests now cover the corrected behavior, reviewer ownership/role restrictions, duplicate retries, failed retry handling, manual fallback, immutable model selection, historical visibility preservation, and repeatable migration backfill.

The browser test now explicitly waits for navigation and analysis completion before submitting its decision. Earlier test runs exposed timing failures, including a correctly rejected stale revision; the final run passed.

External provider transport is mocked in the API tests. Browser tests use the explicitly labeled fixture provider. No paid model calls, production account mutations, credential rotations, or deployment were performed. These checks do not establish universal model compatibility or production PostgreSQL performance.

## About page follow-up

Production build and 32 unit/API tests passed. All 5 browser tests passed, including new mobile reduced-motion and desktop reveal checks, role tab interaction, overflow checks, and favicon loading. Desktop and mobile screenshots were inspected. No deployed password rotation was performed: the available Render connector cannot execute database writes, and the Neon project ID is not yet available.
