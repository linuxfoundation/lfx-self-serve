---
description: Styling and brand-color rules — lfxColors scales, Tailwind config, no hard-coded hex
paths:
  - '**/*.html'
  - '**/*.scss'
  - '**/*.component.ts'
---

# Styling

## Brand colors

Brand palette lives in `@linuxfoundation/lfx-ui-core`, exported via `packages/shared/src/constants/colors.constants.ts` as `lfxColors`. Tailwind picks scales up automatically via `apps/lfx-one/tailwind.config.js` (there is no root-level Tailwind config).

Available scales:

- `blue` — primary
- `gray` — neutral
- `emerald` — success
- `red` — error
- `amber` — warning
- `violet` — accent

**Never hard-code hex values.** Reference scale names so brand updates propagate without code changes.

## Layout primitives

- Use `flex + flex-col + gap-*` for vertical stacking, never `space-y-*`
- Never nest ternary expressions inside templates — extract a computed or pipe instead
- `apps/lfx-one/src/styles.scss` sets `html { font-size: 14px; }` and `tailwind.config.js` doesn't override `theme.spacing`, so Tailwind's rem-based scale undershoots its px-sounding names (`px-3` renders 10.5px, not 12px). Prefer the standard scale, but an arbitrary `[Npx]` value is an accepted deviation when a design calls for an exact pixel size — leave a short comment saying so.

## Tailwind & PrimeNG wrappers

- Tailwind first; reach for custom SCSS only for PrimeNG overrides, complex animations, or pseudo-elements
- All PrimeNG components are accessed through LFX wrapper components in `shared/components/` — don't reach for raw `<p-*>` components directly in feature module templates if a wrapper exists
