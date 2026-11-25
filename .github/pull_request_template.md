## Description
Please include a concise summary of the change, motivation, and which issue or task this PR resolves.

Fixes #(issue)

## Type of Change
Please check the options that apply:
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance improvement or refactoring
- [ ] Security fix

## Testing & Verification
Describe how the changes were verified:
- [ ] Unit tests added / updated in `tests/*.test.mts`
- [ ] All tests pass: `npm test`
- [ ] TypeScript typecheck passes: `npm run typecheck`
- [ ] Production build succeeds: `npm run build`
- [ ] Tested in Demo Mode (without backend credentials)
- [ ] Verified responsive layout (desktop 1440px and mobile 390px)

## Security & Privacy Checklist
- [ ] No secrets, passwords, or private API keys committed in code or fixtures
- [ ] Mutations follow action guard tiers (`lib/guard.ts`)
- [ ] Sensitive outputs are scrubbed before logging or inbox storage
- [ ] No tracking, third-party analytics, or unauthorized telemetry added
