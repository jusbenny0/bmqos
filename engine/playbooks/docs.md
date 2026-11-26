# Playbook: Documentation (`docs`)

Docs, guides and READMEs; no product code changes.

Gates: visual=false, qa=false, security=false.

## Steps

1. **Brief** (role: ceo) — Acceptance: Audience, pages to write or change, source of truth (code, issues) and repo are in the brief.
2. **Write** (role: builder) — Acceptance: Pages written from the code and real commands; every command was executed or marked as untested.
3. **Review** (role: reviewer, gate: review) — Acceptance: Only documentation files changed; links resolve; examples match current code; no marketing filler.

## SECURITY RULES

Checklist for the Security role:

- [ ] No secrets, tokens or `.env` content in code, commits, logs or screenshots.
- [ ] Dependencies: pin versions, run the audit (`npm audit --omit=dev`), no new package without a stated reason.
- [ ] Documentation-only: the diff must not touch source code, CI or config.
- [ ] No real tokens, hostnames, emails or customer data in examples; use obvious placeholders.
- [ ] Do not document insecure shortcuts (disabled auth, `--no-verify`) as recommended practice.

## TECH STACK DEFAULTS

- Markdown in `docs/` (GitHub-flavoured)
- Short pages, one topic each, linked from `docs/README.md`
- Code blocks tagged with a language; commands copy-pastable
- Playwright only if screenshots are required
