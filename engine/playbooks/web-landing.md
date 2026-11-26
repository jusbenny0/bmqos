# Playbook: Marketing / landing page (`web-landing`)

Single- or few-page marketing site where design quality is the product.

Gates: visual=true, qa=true, security=false.

## Steps

1. **Brief** (role: ceo) — Acceptance: Goal, audience, single conversion action, copy source, brand assets, deadline and repo are written in the task brief.
2. **Art direction** (role: designer-builder) — Acceptance: One written direction: references, type pair, palette with contrast ratios, motion language, one signature idea. No generic gradient-and-cards look.
3. **Spec** (role: designer-builder) — Acceptance: Section list with purpose of each section, layout at 1440 and 390, copy, states, motion timeline, asset list.
4. **Build** (role: builder) — Acceptance: Implements the spec on the default stack; Lighthouse performance >= 90 mobile, no layout shift, reduced-motion respected.
5. **Code review** (role: reviewer, gate: review) — Acceptance: Diff matches the spec and scope; no dead code; accessibility basics (landmarks, alt, focus, contrast >= 4.5:1).
6. **Visual gate** (role: visual, gate: visual) — Acceptance: Screenshots at 1440 and 390 score >= 8.5/10 against the art direction and the anti-slop rules. Below 8.5 returns to build.
7. **QA** (role: qa, gate: qa) — Acceptance: Playwright run at 1440/390: CTA works, forms validate, no console errors, links resolve, keyboard navigation works.

## SECURITY RULES

Checklist for the Security role:

- [ ] No secrets, tokens or `.env` content in code, commits, logs or screenshots.
- [ ] Dependencies: pin versions, run the audit (`npm audit --omit=dev`), no new package without a stated reason.
- [ ] Forms: server-side validation, rate limit, honeypot or captcha, no PII in logs.
- [ ] Third-party scripts (analytics, fonts, embeds) only from an allow-list; set CSP and `rel=noopener` on external links.
- [ ] No inline secrets in client bundles; only `NEXT_PUBLIC_*` values are public by design.
- [ ] Security headers set: CSP, HSTS, X-Content-Type-Options, Referrer-Policy.
- [ ] User-supplied HTML is never rendered unsanitised.

## TECH STACK DEFAULTS

- Next.js 16 (App Router) + TypeScript strict
- Tailwind CSS 4
- GSAP + Lenis for scroll and motion (respect prefers-reduced-motion)
- React Three Fiber only when 3D is the signature idea, lazy-loaded
- Playwright for screenshots and QA
- next/image and next/font; no layout-shifting assets

## Anti-slop rules

- No purple-to-blue gradient hero, no stock three-card feature grid as the main structure.
- No emoji as icons, no generic 'Revolutionize your workflow' copy; copy names a concrete benefit.
- Maximum two typefaces, a real type scale, one accent colour used with intent.
- Every section has a purpose that can be stated in one sentence; delete the ones that do not.
- Motion supports meaning (reveal, focus, feedback); no decorative parallax everywhere.
- Real or art-directed imagery; no default placeholder illustrations.
- Spacing follows a scale; alignment is verified at 1440 and 390, not assumed.

## Findings from web-lab comparison (TODO, filled after A4)

- TODO: findings from `docs/comparison.md` (web-lab, task A4) are not available yet. A separate small follow-up task will add them here. Do not invent results.
