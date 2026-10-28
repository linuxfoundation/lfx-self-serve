# Uikit

A PrimeNG-free component library for LFX One, inspired by the Insights uikit. The PrimeNG wrappers in `shared/components/` stay as they are; new generic UI primitives can be built here from Angular and Tailwind alone.

## Conventions

- **Selector prefix:** `lfx-ui-` (enforced by an ESLint override for this folder), e.g. `lfx-ui-button`.
- **Class names:** `Ui*Component` (`UiButtonComponent`), so they never collide with the wrapper classes.
- **Angular:** standalone, signal `input()` / `output()`, `model()` for two-way values, `ChangeDetectionStrategy.OnPush`. The app is zoneless.
- **Styling:** Tailwind with the `lfxColors` scales only, no hex values. Design values come from the design system buttons and tabs.
- **No PrimeNG** imports anywhere in this folder.
- **Overlays** (menus, popovers, dialogs) will build on `@angular/cdk`.
- **Types:** shared interfaces such as `UiTabItem` live in `@lfx-one/shared/interfaces`.
- **Every component has** a `*.stories.ts` (JSDoc on every input and output feeds the autodocs) and a `*.component.spec.ts`.

## Components

| Selector              | Class                    | Purpose                                                                                                                    |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `lfx-ui-button`       | `UiButtonComponent`      | Eight variants, three sizes, icon-only, leading and trailing icon, disabled, full width; renders a button or a router link |
| `lfx-ui-tabs`         | `UiTabsComponent`        | Underline tabs with optional counts and arrow-key navigation; `[(value)]`                                                  |
| `lfx-ui-search-input` | `UiSearchInputComponent` | Pill search field, 34px tall, 300px minimum width; `[(value)]`                                                             |
| `lfx-ui-badge`        | `UiBadgeComponent`       | Count badge, neutral or accent tone                                                                                        |

## Storybook

Stories load from `shared/uikit/**/*.stories.ts` only. Config is in `apps/lfx-one/.storybook/`.

```bash
yarn storybook          # dev server on http://localhost:6006
yarn build-storybook    # static build into apps/lfx-one/storybook-static
```

Storybook is not part of CI yet.
