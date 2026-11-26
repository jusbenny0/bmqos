# Playbook: Web application (`web-app`)

Authenticated product UI with data, forms and a backend.

Gates: visual=true, qa=true, security=true.

## Steps

1. **Brief** (role: ceo) — Acceptance: User stories, data model sketch, roles/permissions, out-of-scope list and repo are in the brief.
2. **UX spec** (role: designer-builder) — Acceptance: Screens and states (empty, loading, error, success) at 1440 and 390; component list reusing the existing design system.
3. **Build** (role: builder) — Acceptance: Feature implemented with typed API boundaries, migrations, and tests for business logic.
4. **Code review** (role: reviewer, gate: review) — Acceptance: Diff within scope; input validated at boundaries; no `any`; migrations reversible.
5. **Security gate** (role: security, gate: security) — Acceptance: Every item of SECURITY RULES checked and reported pass/fail with file references.
6. **Visual gate** (role: visual, gate: visual) — Acceptance: Screenshots at 1440 and 390 score >= 8/10; all four states exist.
7. **QA** (role: qa, gate: qa) — Acceptance: Playwright flow covers the main user story plus one failure path; no console errors.

## SECURITY RULES

Checklist for the Security role:

- [ ] No secrets, tokens or `.env` content in code, commits, logs or screenshots.
- [ ] Dependencies: pin versions, run the audit (`npm audit --omit=dev`), no new package without a stated reason.
- [ ] Authentication on every route and server action; authorisation checked per resource (no IDOR).
- [ ] Sessions: httpOnly, Secure, SameSite cookies; CSRF protection for state-changing requests.
- [ ] All input validated server-side with a schema (e.g. zod); output encoded; no raw SQL string building.
- [ ] Passwords hashed with scrypt/argon2; no custom crypto.
- [ ] File upload: type and size limits, random file names, stored outside the web root.
- [ ] Rate limit login and public endpoints; generic error messages (no stack traces to the client).
- [ ] Secrets only from environment; nothing sensitive in client bundles or logs.

## TECH STACK DEFAULTS

- Next.js 16 (App Router, Server Actions) + TypeScript strict
- Tailwind CSS 4
- Postgres + Drizzle ORM with versioned migrations
- zod for validation
- Playwright for end-to-end tests
- GSAP/Lenis only for polish, never required for function
