# Evals

Exam papers for agent roles. One file per role: `evals/<role>.json`, an array of cases:

```json
{ "id": "missing-criterion",
  "input": "<exactly what the role receives>",
  "expect": { "last_line": "^VERDICT:\\s*RETURN$", "must": ["regex"], "must_not": ["regex"] },
  "judge": "optional rule for an LLM judge (Haiku), e.g. 'names the missing validation'" }
```

- **Code judge** (`expect`): deterministic checks, use them whenever the right answer is a fixed value (verdict, routing, a field).
- **LLM judge** (`judge`): one rule, PASS/FAIL, for free-form output. Look at the pass rate over time, not 100/100.
- The role answers with its real system prompt but **without tools**, so evals test judgement, not tool use.

Run: `npm run eval` (all roles) or `npm run eval -- reviewer`. Results are stored in the `eval_runs` table and shown by `GET /api/evals`.

**Gate:** lessons learned from retrospectives enter a role prompt only if that role's pass rate does not drop (`lib/retro.ts` → `gatePrompt`). Disable with `CREW_EVAL_GATE=0`.

Add a case every time a role makes a real mistake (a wrong RETURN, a missed secret): the mistake becomes a permanent test.
