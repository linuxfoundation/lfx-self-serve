---
description: Styling and brand-color rules — lfxColors scales, Tailwind config, no hard-coded hex
paths:
  - '**/*.html'
  - '**/*.scss'
  - '**/*.component.ts'
---

# Styling

## Brand colors

Brand palette lives in `@linuxfoundation/lfx-ui-core`, exported via `packages/shared/src/constants/colors.constants.ts` as `lfxColors`. Tailwind picks scales up automatically via `apps/lfx-one/tailwind.config.js` (there is no root-level Tailwind config). That config is plain JS loaded by Tailwind through jiti's Node/`exports`-map resolution, so the `@lfx-one/shared/*` tsconfig alias does not apply there — it must import shared constants via the deep `@lfx-one/shared/src/...` source subpath (the public entrypoint would read a stale/missing built `dist/` on dev machines), and it is the sole consumer of the package's `"./src/*"` export (guarded by `src/server/tailwind-config.spec.ts`).

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
- `apps/lfx-one/src/styles.scss` sets `html { font-size: 14px; }`, and `tailwind.config.js` doesn't override this for either `theme.spacing` or `theme.fontSize` (`lfxFontSizes`), so Tailwind's rem-based scale undershoots its px-sounding names in both (`px-3` renders 10.5px not 12px; `text-2xs` renders 8.75px not 10px). Prefer the standard scale, but an arbitrary `[Npx]` value is an accepted deviation when a design calls for an exact pixel size — leave a short comment saying so.
- The Font Awesome kit in `index.html` is `defer`red, so first-paint spinners and other LCP-candidate icons must be pure CSS/Tailwind (not `fa-*`). See `docs/architecture/frontend/styling-system.md` § Icon System.

## Page headers

- Every main lens page (reached from the Me, Foundation, Project or Org sidebar) opens with `<lfx-page-header>` from `shared/components/page-header/`. Never hand-build a page `h1` and description.
- Don't restyle it: no font, size or colour classes for the title, and no top margin above it — `main-layout`'s `py-6` is the page's only top spacing. Leave 24px below it (`mb-6` or a parent `gap-6`).
- Use its slots: `[pageHeaderActions]` for right-side buttons or filters, `[pageHeaderTitleSuffix]` for an inline tag, `[pageHeaderDescription]` (a `<span>`) for description copy with markup.
- Detail, create and manage pages keep their own headings. Full spec: `docs/architecture/frontend/component-architecture.md` § Page header.

## Tailwind & PrimeNG wrappers

- Tailwind first; reach for custom SCSS only for PrimeNG overrides, complex animations, or pseudo-elements
- All PrimeNG components are accessed through LFX wrapper components in `shared/components/` — don't reach for raw `<p-*>` components directly in feature module templates if a wrapper exists
