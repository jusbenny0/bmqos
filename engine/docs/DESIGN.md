# Crew Engine UI & Design Guidelines

The web interface is designed as a dense, high-clarity control plane inspired by modern developer platforms (Linear, GitHub). It emphasizes clean information density, a single accent color, and minimal visual noise without unnecessary gradients or heavy shadows.

---

## Visual Design Principles

- **Clarity and Density:** High information density optimized for operational oversight.
- **Subtle Elevation:** 1px borders and gentle contrast differences rather than heavy drop shadows.
- **Consistent States:** Clear, color-coded status badges with subtle pulse animations for active states.
- **Theme Support:** Dark mode default with automatic light mode support via `prefers-color-scheme`.

---

## Design Tokens & Variables

All tokens are defined in `app/globals.css`:

### Color Palette
- `--bg`: Main application background.
- `--surface`: Card and modal background surfaces.
- `--surface-2`: Elevated surfaces, hovering layers, and tooltips.
- `--border`: Neutral border stroke for cards and dividers.
- `--fg`: Primary text and high-contrast foreground icons.
- `--muted`: Secondary text, meta details, and subdued labels.
- `--accent`: Brand focus color for interactive highlights and primary CTAs.

### Semantic Status Tokens
- `--ok`: Success, completed tasks, healthy agent statuses.
- `--warn`: Tasks requiring attention or approaching token caps.
- `--err`: Blocked tasks, compilation failures, execution errors.
- `--info`: Informational events and neutral progress states.

---

## Typography

- **Font Family:** `Inter`, system sans-serif fallback.
- **Base Body:** `14px / 1.5` line height.
- **Section & Column Headers:** `12px` uppercase with tracking and `--muted` styling.
- **Code & Tokens:** System monospace font for numbers, paths, commit hashes, and token metrics.

---

## Components & Layout

- **Board Layout (`.board` / `.board-col`):**
  - Kanban board with fixed column widths (`280px`).
  - Columns stack vertically on mobile screens (`<= 640px`).
- **Cards (`.card`):**
  - Used for tasks and employee representations.
  - Border radius `8px`, 1px border stroke.
  - Border highlight on hover.
- **Status Badges (`.badge`, `.badge-<status>`):**
  - Display indicator dot + status text.
  - States: `idle`, `todo`, `running` / `in_progress` (with subtle pulse animation), `done`, `blocked` / `waiting`, `error` / `failed`.
- **Motion & Transitions:**
  - `150ms ease` on interactive hover states.
  - `1.6s` gentle pulse animation on running tasks.
  - Disabled when `prefers-reduced-motion` is active.
- **Empty & Error States:**
  - Empty columns show understated `--muted` placeholder text.
  - Errors display with `.badge-error` and explicit error messages.
