# Uikit

A PrimeNG-free component library for LFX One, inspired by the Insights uikit. The PrimeNG wrappers in `shared/components/` stay as they are; new generic UI primitives can be built here from Angular and Tailwind alone.

## Conventions

- **Selector prefix:** `lfx-ui-` (enforced by an ESLint override for this folder), e.g. `lfx-ui-button`.
- **Class names:** `Ui*Component` (`UiButtonComponent`), so they never collide with the wrapper classes.
- **Angular:** standalone, signal `input()` / `output()`, `model()` for two-way values, `ChangeDetectionStrategy.OnPush`. The app is zoneless.
- **Styling:** Tailwind only, no hex values. New and realigned components use the LFX UI Library `ui-*` roles below; feature code outside the uikit keeps using `lfxColors` (`blue`, `gray`, ...). Button, tabs and search-input still use `lfxColors` until they are realigned.
- **No PrimeNG** imports anywhere in this folder.
- **Overlays** build on `@angular/cdk`.
- **Stacking:** CDK overlays sit at z-index 1200, above PrimeNG's 1100 modal layer. A PrimeNG overlay panel opened from inside a uikit modal renders below it unless it is appended to its own element.
- **Types:** shared interfaces such as `UiTabItem` live in `@lfx-one/shared/interfaces`.
- **Every component has** a `*.stories.ts` (JSDoc on every input and output feeds the autodocs) and a `*.component.spec.ts`.

## Components

| Selector                | Class                      | Purpose                                                                                                                                                                     |
| ----------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lfx-ui-button`         | `UiButtonComponent`        | Eight variants, three sizes, icon-only, leading and trailing icon, disabled, full width; renders a button or a router link                                                  |
| `lfx-ui-tabs`           | `UiTabsComponent`          | Underline tabs with optional counts and arrow-key navigation; `[(value)]`                                                                                                   |
| `lfx-ui-search-input`   | `UiSearchInputComponent`   | Pill search field, 34px tall, 300px minimum width; `[(value)]`                                                                                                              |
| `lfx-ui-badge`          | `UiBadgeComponent`         | Pill label: six tones, subtle, solid or outline, 20 or 24px, optional leading icon and status dot                                                                           |
| `lfx-ui-status-dot`     | `UiStatusDotComponent`     | Six run states as a 10px dot and a word; queued and building pulse; dot-only mode with `role="img"`                                                                         |
| `lfx-ui-skeleton`       | `UiSkeletonComponent`      | Shimmering line, pill or circle placeholder with any width and height; `aria-hidden`                                                                                        |
| `lfx-ui-spinner`        | `UiSpinnerComponent`       | Twelve-bar spinner, 12 to 32px, neutral or current-colour tone; `role="status"` with a label                                                                                |
| `lfx-ui-note`           | `UiNoteComponent`          | Inline message, six variants, optional fill, small size, label and one action slot; `role="note"` or `alert`                                                                |
| `lfx-ui-description`    | `UiDescriptionComponent`   | Title and value as a definition list; right-aligned for numbers, ellipsis for long values, optional help icon                                                               |
| `lfx-ui-error`          | `UiErrorComponent`         | Red error message with icon, optional medium-weight label and link; three sizes; `role="alert"` unless `announce` is off                                                    |
| `lfx-ui-keyboard-input` | `UiKeyboardInputComponent` | Key or shortcut as one `<kbd>` per key, 24 or 20px; `[keys]`                                                                                                                |
| `lfx-ui-gauge`          | `UiGaugeComponent`         | Circular percentage, 20 to 128px; level colours at 67 and 34 or accent; indeterminate; `role="progressbar"`                                                                 |
| `lfx-ui-progress`       | `UiProgressComponent`      | 10px bar from `value / max`; accent, success, warning, error or secondary; `role="progressbar"` with a label                                                                |
| `lfx-ui-avatar`         | `UiAvatarComponent`        | Photo, initials, icon or placeholder circle; tints, provider badge, image fallback; `lfx-ui-avatar-group` stacks them with +N                                               |
| `lfx-ui-menu`           | `UiMenuComponent`          | Menu panel on CDK Menu: `role="menu"`, arrows, Home, End, type-ahead, Escape returns focus; open it with `cdkMenuTriggerFor` from any button; flips at the window edge      |
| `lfx-ui-menu-item`      | `UiMenuItemComponent`      | Menu row, 40px: default or danger, leading and trailing icon, shortcut hint, disabled (`aria-disabled`); emits `triggered`                                                  |
| `lfx-ui-menu-group`     | `UiMenuGroupComponent`     | Labelled `role="group"` of menu items with a 12px heading                                                                                                                   |
| `lfx-ui-menu-separator` | `UiMenuSeparatorComponent` | Full-bleed 1px rule between menu groups                                                                                                                                     |
| `lfx-ui-modal`          | `UiModalComponent`         | Modal layout: title, subtitle, body, inset band and actions footer slots; 540px or 420px, sticky title, single-action footer                                                |
| `UiModalService`        | `UiModalService`           | Opens a component or template on CDK Dialog: focus trap, focus returns, scroll lock, `ui-overlay` backdrop, Escape and backdrop close each configurable, `alertdialog` role |

## Design tokens

The LFX UI Library tokens come from `scripts/ui-tokens/tokens.json` (canonical, copied from the library). `yarn ui:tokens` (from `apps/lfx-one`) regenerates `src/styles/ui-tokens.css`, which `src/styles.scss` loads; a unit spec fails when the two drift. Do not edit the CSS by hand.

- **CSS variables:** every token is a `--ui-*` variable: roles (`--ui-neutral-900`), primitives (`--ui-azure-500`), `--ui-shadow-*`, `--ui-radius-*`, `--ui-height-*`, `--ui-width-*`, `--ui-z-*`, `--ui-breakpoint-*`, `--ui-opacity-*`, `--ui-duration-*`, `--ui-ease*`, `--ui-font-*`, `--ui-spacing-*`. The names carry an extra `--ui-` prefix relative to the library's `bundle.css` (`--shadow-menu` there is `--ui-shadow-menu` here), so they cannot collide with app CSS. Values are on `:root` and `[data-theme='light']`; `[data-theme='dark']` overrides the themed ones. The app has no theme switch yet, so it always renders light.
- **Tailwind utilities** (v3, `tailwind.config.js`) read those variables, so they follow the theme. Existing classes (`bg-blue-500`, `text-gray-700`, `rounded-md`, `shadow-md`, `text-sm`) are unchanged.
- **Exact px:** the app root font is 14px, so rem would scale. Library sizes are px values, not Tailwind's rem scale (`h-10` is 35px here; `h-ui-medium` is 40px).
- **No opacity modifier:** colours are CSS variables, so `bg-ui-accent-500/50` does not work. Use the matching `ui-*-alpha` or lower step (`bg-ui-accent-100`).
- **Primitives** (`azure`, `slate`, ...) are variables only. Components use the `ui-*` roles; the primitives are for charts, avatars and illustrations (`var(--ui-azure-500)`).

| Need                                                         | Utility                                                                                                                                                | Variable                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Backgrounds                                                  | `bg-ui-background-100`, `bg-ui-background-200`                                                                                                         | `--ui-background-100/200`         |
| Role scales (50-900)                                         | `bg-ui-neutral-50`, `text-ui-neutral-600`, `border-ui-accent-200`, `text-ui-danger-700`; also `success`, `warning`, `feature`                          | `--ui-<role>-<step>`              |
| Translucent neutrals                                         | `bg-ui-neutral-alpha-100`, `border-ui-neutral-alpha-200`                                                                                               | `--ui-neutral-alpha-<step>`       |
| Focus, scrim                                                 | `ring-ui-focus`, `bg-ui-overlay`                                                                                                                       | `--ui-focus`, `--ui-overlay`      |
| Shadows                                                      | `shadow-border`, `shadow-small`, `shadow-medium`, `shadow-large`, `shadow-tooltip`, `shadow-menu`, `shadow-modal`, `shadow-fullscreen`, `shadow-focus` | `--ui-shadow-*`                   |
| Edge ring                                                    | `edge`, `edge-hover` (1px translucent ring instead of a border)                                                                                        | `--ui-neutral-alpha-200/300`      |
| Radii                                                        | `rounded-ui-xs` 6, `rounded-ui-sm` 12, `rounded-ui-md` 16, `rounded-ui-lg` 20, `rounded-ui-full` 9999                                                  | `--ui-radius-*`                   |
| Control heights                                              | `h-ui-tiny` 24, `h-ui-small` 32, `h-ui-medium` 40, `h-ui-large` 48, `h-ui-menu-item` 40, `h-ui-row` 48                                                 | `--ui-height-*`                   |
| Motion durations                                             | `duration-ui-fast` 120ms, `duration-ui-base` 150ms, `duration-ui-slow` 250ms                                                                           | `--ui-duration-*`                 |
| Motion easing                                                | `ease-ui` (spring), `ease-ui-standard`                                                                                                                 | `--ui-ease`, `--ui-ease-standard` |
| Type size and line height                                    | `text-label-14`, `text-copy-14`, `text-button-14`, `text-heading-24`, ...                                                                              | `--ui-font-*`                     |
| Full type role (family, size, line height, weight, tracking) | `label-14`, `copy-14`, `button-14`, `heading-24`, `label-14-mono`, ...                                                                                 | `--ui-font-sans/display/mono`     |

The `ui` prefix on colours, radii and heights avoids collisions with Tailwind's own `neutral`, `red`, `amber`, `sm`/`md` and `h-*` names. Pair `text-heading-24` with `font-display font-light` or use the `heading-24` class, which sets both. Focus: `focus-visible:shadow-focus focus-visible:outline-none`.

Use `duration-ui-*` / `ease-ui-*` instead of arbitrary `duration-[150ms]` / `ease-[cubic-bezier(...)]` values, and keep `prefers-reduced-motion` gating (`motion-safe:` / `motion-reduce:`).

Review them visually in Storybook under Foundations/Tokens.

## Storybook

Stories load from `shared/uikit/**/*.stories.ts` only; Foundations/Tokens shows the colour roles, shadows, radii, heights, type roles and motion. Config is in `apps/lfx-one/.storybook/`.

```bash
yarn storybook          # dev server on http://localhost:6006
yarn build-storybook    # static build into apps/lfx-one/storybook-static
```

Autodocs read the JSDoc on each input through Compodoc, which `build-storybook` runs. Storybook is not part of CI yet.
