# Production verification status

Checked 2026-10-04. This is a verification record, not a claim that every production journey has passed.

## Account access

Public signup, password reset, email invitations, and account administration are not implemented. Accounts are provisioned by an operator. The login page's invited-members wording does not imply an invitation delivery feature.

## Workflow coverage

| Journey | Evidence and remaining work |
| --- | --- |
| Login and session restoration | Existing browser journey signs in as author, moderator, and reviewer. Production authenticated verification still needed. |
| Posts and moderation | Existing API/browser tests cover submission, analysis, human removal, and visibility. |
| Comments, reports, edits | Implemented routes; API tests cover reporting and edit invalidation. Dedicated production UI checks still needed. |
| Appeals | API/browser tests cover author appeal, independent reviewer, retry, resolution, and restoration. |
| Policy changes | API tests cover stale cases/appeals and retained historical decisions. Production publishing deliberately not used as a test because it re-evaluates real unresolved work. |
| Authorization and CSRF | API tests cover role restrictions and CSRF rejection. New client regression tests cover recovery on the next explicit submission. |
| Provider connections | Transport is mocked in API tests. Paid provider calls are unverified. |
| Mobile and public page | Existing browser tests cover overflow, reduced motion, public navigation, and favicon. |
| Logout, expiry, slow network | Implementation exists; dedicated end-to-end failure-path coverage remains incomplete. |

## Changes from this check

A rejected CSRF token is cleared so the next explicit submission obtains the current token. Failed mutations are never automatically replayed. Unexpected HTML or malformed API envelopes now produce a useful error instead of false success or raw JSON parser errors.

Three client regressions failed before the fix and passed afterward. Six domain tests also passed, and the production build passed locally. The full local test command was blocked by the runner's socket permission restrictions (`listen EPERM`); GitHub CI must verify the full suite on this change.

## Production access still required

The connected Vercel account could list the project but returned 403 when reading its production domains. A confirmed frontend URL and authenticated test accounts are needed for production browser journeys. Do not publish passwords or API keys in this report. Deployed seeded passwords have not been rotated by this check.
