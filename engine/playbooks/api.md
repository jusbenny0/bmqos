# Playbook: HTTP API / backend service (`api`)

Backend service or public API without a UI.

Gates: visual=false, qa=false, security=true.

## Steps

1. **Brief** (role: ceo) — Acceptance: Endpoints or events, request/response shapes, auth model, error format, limits and repo are in the brief.
2. **Contract** (role: builder) — Acceptance: OpenAPI or typed route definitions written first and agreed in the task.
3. **Build** (role: builder) — Acceptance: Implementation matches the contract; Drizzle migrations; integration tests against a real Postgres.
4. **Code review** (role: reviewer, gate: review) — Acceptance: Diff within scope; consistent error format; no `any`; idempotency where the contract says so.
5. **Security gate** (role: security, gate: security) — Acceptance: Every item of SECURITY RULES checked and reported pass/fail with file references.
6. **Contract tests** (role: qa, gate: qa) — Acceptance: Tests exercise success, validation error, unauthenticated and forbidden cases for each endpoint.

## SECURITY RULES

Checklist for the Security role:

- [ ] No secrets, tokens or `.env` content in code, commits, logs or screenshots.
- [ ] Dependencies: pin versions, run the audit (`npm audit --omit=dev`), no new package without a stated reason.
- [ ] Every endpoint authenticated unless explicitly listed as public; authorisation checked per resource.
- [ ] Validate body, query and params with schemas; reject unknown fields; size limits on bodies.
- [ ] Parametrised queries only (Drizzle); no string-built SQL.
- [ ] Rate limiting and request timeouts; pagination caps on list endpoints.
- [ ] CORS allow-list, not `*`, for credentialed requests.
- [ ] Errors return a stable JSON shape without stack traces or internal ids; log with request id, never with secrets or PII.
- [ ] Webhooks verify signatures with constant-time comparison; tokens compared in constant time.

## TECH STACK DEFAULTS

- Node 24 + TypeScript strict
- Hono (HTTP framework)
- Postgres + Drizzle ORM with versioned migrations
- zod for validation (e.g. @hono/zod-validator)
- node:test or Vitest for unit/integration tests
- Playwright (APIRequestContext) for end-to-end API checks
