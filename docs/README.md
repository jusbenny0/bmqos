# BMQOS Documentation Hub

Welcome to the **BMQOS** documentation center. Here you will find guides, architectural concepts, step-by-step how-tos, and complete references for operating your AI-powered company.

---

## 🚀 Quick Navigation

| Document | Purpose |
| :--- | :--- |
| [**Getting Started (5 min)**](getting-started.md) | Clone, configure, and run BMQOS and the Crew Agent Engine in under 5 minutes. |
| [**Core Concepts**](concepts.md) | Company architecture, roles, quality gates, retrospectives, evidence, personas, advisors, providers, and playbooks. |
| [**How-To Guides**](how-to.md) | Practical recipes: custom roles, custom playbooks (SOPs), and Claude MCP integration. |
| [**Technical Reference**](reference.md) | Exhaustive reference for environment variables, REST/SSE APIs, and CLI utilities. |
| [**Troubleshooting**](troubleshooting.md) | Solutions for port conflicts, database locks, CLI logins, Chromium evidence, and token caps. |
| [**Frequently Asked Questions (FAQ)**](faq.md) | Common questions about demo mode, cost control, security tiers, and multi-model hosting. |

---

## 📚 Deep-Dive Topics

For specialized architectural and operational details:

- [**System Architecture & Design**](architecture.md) — Internal system structure, data flow, SQLite WAL layer, and zero-telemetry philosophy.
- [**Security Architecture & Threat Model**](security.md) — 3-tier action gating, TOTP step-up authentication, LAN check, and secret scrubbing.
- [**Setup Script Options**](setup.md) — Command-line flags and automated deployment modes for `npm run setup`.
- [**Deployment Guide**](install.md) — Local machine, VPS, Docker Compose, and native desktop shell installations.
- [**Configuration Reference**](config.md) — Complete environment variable specification for the BMQOS control panel.
- [**Crew Module Integration**](crew.md) — Task lifecycles, kanban queues, and company Brain integration.
- [**Advisors Guide**](advisors.md) — Setting up domain mentors backed by private knowledge bases.
- [**Playbooks Guide**](playbooks.md) — Task-type recipes (landing, web app, API, docs), overrides and the playbooks API.

---

## 🛠️ Verification & Health Checks

Verify your installation with the standard check suite:

```bash
# Verify TypeScript compilation
npm run typecheck

# Run unit tests
npm test

# Test engine MCP server
cd engine && npm run test:mcp
```
