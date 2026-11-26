# Advisors

An advisor is an optional role outside the pipeline. It answers questions from the CEO or the owner using only the owner's own materials.

## Set up a business/growth mentor

1. Start from `engine/personas/advisor-template.json` and pick a slug (`a-z`, `0-9`, `-`, max 50 chars), e.g. `growth-advisor`.
2. Create `data/advisors/<slug>/kb/` and put your own notes there as `.md` / `.txt`: playbooks, lessons learned, offers, experiment logs, summaries of books you read in your own words.
3. Optional: write `kb/INDEX.md` by hand. If it is missing, the engine generates it (file list + first heading of each file).
4. Ask: `POST /api/advisors/<slug>/ask` with `{"question": "..."}` (same auth as the other engine APIs; the CEO uses `X-Crew-Token`). Response: `{"answer": "..."}`.

The advisor runs on `sonnet`, from `data/advisors/<slug>/` as its working directory, with read-only tools (Read, Glob, Grep) and no shell, write or web access. It reads `kb/INDEX.md` first, opens only relevant files and cites them. It does not invent anything outside `kb/`.

## Rules

- Use only material you are allowed to use. Do not commit transcripts, quotes or other people's names to this repository; `data/` is git-ignored.
- The advisor is inspired by your materials. It never claims to be a real person.
