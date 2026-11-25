# Contributing to BMQOS

Thank you for your interest in contributing to **BMQOS**! We welcome contributions from human developers and autonomous AI coding agents alike.

This guide outlines our development workflow, coding conventions, testing requirements, and contribution guidelines.

---

## 1. Code of Conduct & Principles

- **Local-first & Privacy-focused:** Never add tracking scripts, third-party analytics, or remote telemetry without explicit user configuration.
- **Fail-Closed Security:** Security barriers, card approvals, and state mutations must fail closed. When permissions or configurations are missing, write operations must default to local drafts.
- **Minimal Dependencies:** Prefer Node.js native capabilities (such as `node:test`, `node:crypto`, `node:fs`) and vanilla CSS variables over adding external dependencies.
- **Agent-Friendly:** Maintain clean, structured code and self-documenting APIs so AI agents can inspect, test, and contribute effectively.

---

## 2. Development Setup

### Prerequisites
- **Node.js:** Version 22 or 24 (Node.js 24 recommended).
- **npm:** Compatible with Node.js 22/24.
- **Git**

### Initial Setup
```bash
# 1. Fork and clone the repository
git clone https://github.com/your-username/bmqos.git
cd bmqos

# 2. Install dependencies
npm ci

# 3. Create your local environment configuration
cp .env.example .env

# 4. Start local development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the application in Demo Mode.

---

## 3. Development Workflow

1. **Branching Strategy:**
   - Create a feature branch from `main`:
     ```bash
     git checkout -b feature/your-feature-name
     ```
   - For agent tasks, follow the team naming convention: `agent/<name>-<topic>`.

2. **Making Changes:**
   - Keep changes surgical, scoped, and minimal.
   - Do not modify files outside the scope of your task.
   - Do not commit `.env`, SQLite databases (`*.db`), or private credentials.

3. **Verifying Changes:**
   Before committing, always ensure that all tests and type checks pass:
   ```bash
   # Run the full test suite
   npm test

   # Run TypeScript type validation
   npm run typecheck

   # Test production build
   npm run build
   ```

---

## 4. Coding Conventions

### TypeScript & App Router
- Use strict TypeScript. Avoid `any` where a concrete type can be inferred or defined in `lib/types.ts`.
- App Router components use Next.js 16 conventions with React 19.
- Mark server-only utility files with `import "server-only";` to prevent leaking server logic to client bundles.

### Styling & Design System
- Styling is built on CSS variables defined in `app/os.css` and `app/shell.css`.
- Avoid adding third-party UI component libraries or CSS frameworks (e.g. Tailwind, Bootstrap) unless explicitly requested.
- Maintain responsive design supporting both desktop screens (1440px) and mobile viewports (390px) without horizontal scrolling.

### Security & Guardrails
- State mutations must be registered in `lib/guard.ts` under appropriate tiers:
  - **Tier 1:** Reversible writes (chat messages, drafts, inbox items).
  - **Tier 2:** Risky operations (infrastructure changes, merges, sensitive cards) guarded by step-up 2FA.
  - **Tier 3:** Destructive or irreversible actions requiring re-authentication and typed confirmation.
- Sensitive strings (passwords, tokens, cookies) must always be scrubbed before logging or displaying in the UI using `lib/inbox.ts:scrub` or `lib/redact.ts`.

---

## 5. Testing Guidelines

- BMQOS uses the **Node.js built-in test runner** (`node:test` and `node:assert/strict`).
- Test files are written in TypeScript and placed in the `tests/` directory with the `.test.mts` extension.
- Every new API endpoint, security guard, or business logic helper should include corresponding unit or integration tests.
- Run tests locally with:
  ```bash
  npm test
  ```

---

## 6. Submitting a Pull Request

1. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
2. Open a Pull Request against the `main` branch.
3. Fill out the [Pull Request Template](.github/pull_request_template.md):
   - Provide a concise description of the problem solved.
   - Detail testing steps performed.
   - Confirm that `npm test` and `npm run typecheck` pass cleanly.
4. Address any code review comments promptly.
