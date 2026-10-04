# Account access

Authors can select Create an account on the login screen. Signup requires a display name, email, and a password of at least 12 characters. Email is normalized and staff roles cannot be requested. Internal .local addresses are reserved. Email verification and password recovery are not yet implemented; email is an unverified login identifier.

Try author demo creates a unique author account and a session lasting up to 12 hours, with a random inaccessible password. It never signs visitors into a shared staff account. Demo accounts cannot moderate, inspect staff evidence, or change policies. They use the current community, not an isolated sandbox: label test posts clearly. Posts, accounts and audit history are retained. Demo sessions cannot be recovered after logout.

POST /api/v1/auth/signup and POST /api/v1/auth/demo both require same-origin CSRF protection. They rotate the anonymous session, set the existing HttpOnly session cookie, and record an audit event. Combined account creation is capped at five attempts per IP per hour and 100 globally per hour. Existing sign-in and authorization checks remain unchanged.

Moderators, reviewers and administrators are still operator-provisioned. No staff credentials are exposed by the demo button. Deployment requires no database migration or new environment variable.

Deployed seeded password rotation remains separate. Changing SEED_PASSWORD or rerunning the seed does not update existing passwords.
