# Playbooks

A playbook is a recipe for one task type. Each contains:

- **steps** — role, title, optional `gate` (`review`, `visual`, `qa`, `security`) and acceptance criteria;
- **security_rules** — checklist for the Security role, specific to the type;
- **tech_stack** — defaults the builder should use unless the brief says otherwise;
- **needs** — which gates to enable (`visual`, `qa`, `security`);
- optional **extra_sections** — named bullet lists (e.g. anti-slop rules in `web-landing`).

Built-in: `web-landing`, `web-app`, `api`, `docs` in `engine/playbooks/` (`<id>.json` + readable `<id>.md`). `web-landing` has a section *Findings from web-lab comparison (TODO, filled after A4)* that is intentionally empty until the web-lab comparison exists.

## How the CEO uses them

The CEO prompt lists the available playbook ids (the default is marked). For a new task the CEO calls `GET /api/playbooks/<id>`, pastes the `brief` field (steps, security rules, stack) into the task brief and sets the `needs_*` flags from `needs`. No fitting playbook means a plain brief.

## Overrides

User changes never edit the built-ins. They are stored in `engine/data/playbooks/<id>.json` (override the folder with `CREW_PLAYBOOKS_DIR`) and shallow-merged over the built-in: any field you set replaces the built-in field. A file with a new id and a complete definition adds a custom playbook. Invalid override files are ignored (the built-in is used).

Minimal custom playbook:

```json
{
  "title": "Newsletter", "description": "Weekly email",
  "needs": { "visual": false, "qa": false, "security": false },
  "steps": [{ "role": "builder", "title": "Write", "acceptance": "Proofread, links work" }],
  "security_rules": [], "tech_stack": []
}
```

## Setup

`npm run setup` (interactive) asks for a default playbook and stores it in `engine/data/playbooks/_default.json`. Non-interactive runs skip it.

## API (engine, port 3800)

| Call | Effect |
| :--- | :--- |
| `GET /api/playbooks` | List: `id`, `title`, `description`, `default`, `overridden` |
| `PATCH /api/playbooks` `{"default": "<id>"}` | Set (or `null` clear) the default |
| `GET /api/playbooks/<id>` | Effective playbook plus `brief` (text for the task brief) |
| `PATCH /api/playbooks/<id>` | Save a partial override (validated after merging); `{"reset": true}` deletes it |

`GET` also accepts the CEO `X-Crew-Token`; `PATCH` needs a session or the API bearer token.

Check: `cd engine && npm run test:playbooks`.
