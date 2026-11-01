# Uikit

A PrimeNG-free component library for LFX One, inspired by the Insights uikit. The PrimeNG wrappers in `shared/components/` stay as they are; new generic UI primitives can be built here from Angular and Tailwind alone.

## Conventions

- **Selector prefix:** `lfx-ui-` (enforced by an ESLint override for this folder), e.g. `lfx-ui-button`.
- **Class names:** `Ui*Component` (`UiButtonComponent`), so they never collide with the wrapper classes.
- **Angular:** standalone, signal `input()` / `output()`, `model()` for two-way values, `ChangeDetectionStrategy.OnPush`. The app is zoneless.
- **Styling:** Tailwind only, no hex values. New and realigned components use the LFX UI Library `ui-*` roles below; feature code outside the uikit keeps using `lfxColors` (`blue`, `gray`, ...), but no uikit component still does.
- **No PrimeNG** imports anywhere in this folder.
- **Overlays** build on `@angular/cdk`.
- **Modal** deliberately omits `aria-modal` (CDK default): overlays stay exposed to assistive technology, while the page behind still gets `aria-hidden`.
- **Stacking:** CDK overlays sit at z-index 10000, above PrimeNG's 1100 modal layer and the person drawer's fixed 9999. A PrimeNG overlay panel opened from inside a uikit modal renders below it unless it is appended to its own element.
- **Types:** shared interfaces such as `UiTabItem` live in `@lfx-one/shared/interfaces`.
- **Compound components** (a menu and its items, groups and separators) share one spec and one stories file, named after the parent.
- **Form controls:** register with `NG_VALUE_ACCESSOR` and `forwardRef`, as in `lfx-ui-checkbox`; that is the standard for new controls. The `NgControl`-based controls (input, textarea, slider, calendar, select, combobox, multi-select) convert in a dedicated follow-up PR (tracked on #4661), not in unrelated fixes.
- **Every component has** a `*.stories.ts` (JSDoc on every input and output feeds the autodocs) and a `*.component.spec.ts`.

## Components

| Selector                | Class                      | Purpose                                                                                                                                                                |
| ----------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lfx-ui-button`         | `UiButtonComponent`        | Eight variants, three sizes, icon-only circle, loading, forwards `lfxUiTooltip`, `menu` trigger; button or router link                                                 |
| `lfx-ui-tabs`           | `UiTabsComponent`          | Underline or secondary-pill tabs, default or small, with counts, icons and disabled tabs with a reason; arrows, Home, End; `[(value)]`                                 |
| `lfx-ui-search-input`   | `UiSearchInputComponent`   | Pill search field on `lfx-ui-input`: search icon, clear button, 32px tall, 300px minimum width; `[(value)]`                                                            |
| `lfx-ui-badge`          | `UiBadgeComponent`         | Pill label: six tones, subtle, solid or outline, 20 or 24px, optional leading icon and status dot                                                                      |
| `lfx-ui-status-dot`     | `UiStatusDotComponent`     | Six run states as a 10px dot and a word; queued and building pulse; dot-only mode with `role="img"`                                                                    |
| `lfx-ui-skeleton`       | `UiSkeletonComponent`      | Shimmering line, pill or circle placeholder with any width and height; `aria-hidden`                                                                                   |
| `lfx-ui-spinner`        | `UiSpinnerComponent`       | Twelve-bar spinner, 12 to 32px, neutral or current-colour tone; `role="status"` with a label                                                                           |
| `lfx-ui-note`           | `UiNoteComponent`          | Inline message, six variants, optional fill, small size, label and one action slot; `role="note"`, `alert` with `announce`                                             |
| `lfx-ui-description`    | `UiDescriptionComponent`   | Title and value as a definition list; right-aligned for numbers, ellipsis for long values, optional help icon                                                          |
| `lfx-ui-error`          | `UiErrorComponent`         | Red error message with icon, optional medium-weight label and link; four sizes; `role="alert"` unless `announce` is off                                                |
| `lfx-ui-keyboard-input` | `UiKeyboardInputComponent` | Key or shortcut as one `<kbd>` per key, 24 or 20px; `[keys]`                                                                                                           |
| `lfx-ui-gauge`          | `UiGaugeComponent`         | Circular percentage, 20 to 128px; level colours at 67 and 34 or accent; indeterminate; `role="progressbar"`                                                            |
| `lfx-ui-progress`       | `UiProgressComponent`      | 10px bar from `value / max`; accent, success, warning, error or secondary; `role="progressbar"` with a label                                                           |
| `lfx-ui-avatar`         | `UiAvatarComponent`        | Photo, initials, icon or placeholder circle; tints, provider badge, image fallback; `lfx-ui-avatar-group` stacks them with +N                                          |
| `lfx-ui-menu`           | `UiMenuComponent`          | Menu panel on CDK Menu: `role="menu"`, arrows, Home, End, type-ahead, Escape returns focus; open it with `lfx-ui-button [menu]`; flips at the window edge              |
| `lfx-ui-menu-item`      | `UiMenuItemComponent`      | Menu row, 40px: default or danger, leading and trailing icon, shortcut hint, disabled (`aria-disabled`) with a reason tooltip; emits `triggered`                       |
| `lfx-ui-menu-group`     | `UiMenuGroupComponent`     | Labelled `role="group"` of menu items with a 12px heading                                                                                                              |
| `lfx-ui-menu-separator` | `UiMenuSeparatorComponent` | Full-bleed 1px rule between menu groups                                                                                                                                |
| `lfx-ui-modal`          | `UiModalComponent`         | Modal layout: title, subtitle, body, inset band and actions footer slots; 540px or 420px, sticky title, single-action footer                                           |
| `UiModalService`        | `UiModalService`           | Opens a component or template on CDK Dialog: focus trap, focus return, scroll lock, `ui-overlay` backdrop, split Escape and backdrop close                             |
| `lfxUiTooltip`          | `UiTooltipDirective`       | Attribute directive: hover and keyboard-focus tooltip in a CDK overlay, plain or rich, flips sides, hoverable, Escape closes, spoken description; SSR-safe             |
| `lfx-ui-checkbox`       | `UiCheckboxComponent`      | Native 16px checkbox: checked, indeterminate, disabled, label; `[(checked)]` and reactive forms                                                                        |
| `lfx-ui-radio-group`    | `UiRadioGroupComponent`    | Fieldset of native radios (`lfx-ui-radio` options); arrow keys, `[(value)]` and reactive forms                                                                         |
| `lfx-ui-toggle`         | `UiToggleComponent`        | On/off switch (`role="switch"`): three sizes, accent, warning or danger; `[(checked)]` and reactive forms                                                              |
| `lfx-ui-loading-dots`   | `UiLoadingDotsComponent`   | Three pulsing dots, 4, 5 or 7px, current colour; hidden beside visible text, `role="status"` when given a `label`                                                      |
| `lfx-ui-show-more`      | `UiShowMoreComponent`      | Small button between two rules: "Show 12 More" then "Show Less"; `[(expanded)]`, `aria-expanded`, `aria-controls`; `noBorder`                                          |
| `lfx-ui-input`          | `UiInputComponent`         | Text field: label, hint, error, prefix or suffix, trailing `lfxUiInputAction` slot, three sizes, rounded; `[(value)]` and forms; `aria-describedby`                    |
| `lfx-ui-scroller`       | `UiScrollerComponent`      | Scroll rail or list with edge fades that appear as content clips; optional prev and next buttons; horizontal, vertical, both                                           |
| `lfx-ui-project-banner` | `UiProjectBannerComponent` | Full-width 48px notice, five variants, one sentence and one `banner-action` button; `role="status"`, `alert` on error with `announce`                                  |
| `lfx-ui-slider`         | `UiSliderComponent`        | Native range with label and live value; min, max, step, value text; `[(value)]` and forms                                                                              |
| `lfx-ui-table`          | `UiTableComponent`         | Data table from `columns` and `rows`: header, 48px rows, footer, bordered, striped, interactive, sortable headers, empty row, custom cells via `lfxUiTableCell`        |
| `lfx-ui-calendar`       | `UiCalendarComponent`      | Inline month grid, one date; arrow, Home, End and Page keys; disabled dates; `[(value)]` and forms                                                                     |
| `lfx-ui-collapse`       | `UiCollapseComponent`      | Accordion group; `lfx-ui-collapse-item` (`UiCollapseItemComponent`) holds any content; `[(open)]`, exclusive, small                                                    |
| `lfx-ui-switch`         | `UiSwitchComponent`        | Segmented control, 2 to 4 views: radiogroup of `lfx-ui-switch-option` radios, three sizes, icon-only with tooltip; `[(value)]`, forms                                  |
| `lfx-ui-choicebox`      | `UiChoiceboxComponent`     | Large radio or checkbox tile with title, description and badge; `lfx-ui-choicebox-group` holds them: `[(value)]` or `[(values)]`, forms                                |
| `lfx-ui-textarea`       | `UiTextareaComponent`      | Multi-line field: label, hint, error, 80px minimum, vertical resize, `maxlength`; `[(value)]` and forms                                                                |
| `lfx-ui-empty-state`    | `UiEmptyStateComponent`    | Icon tile or your own art, title and one sentence, with `empty-state-action` buttons below; title is a heading at a level you set                                      |
| `lfx-ui-toast`          | `UiToastComponent`         | Message toast: default, success, warning, error; up to two actions, dismiss button, 5s or 8s auto-dismiss that pauses on hover and focus; `role="status"` or `"alert"` |
| `lfx-ui-split-button`   | `UiSplitButtonComponent`   | Main action joined to a chevron that opens an `lfx-ui-menu`: primary or secondary, three sizes; named, `aria-haspopup`, `aria-expanded`                                |
| `UiToastService`        | `UiToastService`           | Bottom-right stack in a CDK overlay, newest on top, kept as a polite live region; `show()` returns a handle, `dismissAll()`                                            |
| `lfxUiContextMenu`      | `UiContextMenuDirective`   | Opens a `lfx-ui-menu` on right-click, touch long-press, Shift+F10 or the context menu key; flips inside the window; innermost host wins                                |
| `lfx-ui-select`         | `UiSelectComponent`        | Select-only combobox on CDK: projected `lfx-ui-option` rows with any content, groups, separators, prefix, header and value slots; `[(value)]`, forms                   |
| `lfx-ui-combobox`       | `UiComboboxComponent`      | Text field that filters the same `lfx-ui-option` rows as you type, bold match, empty state; picks from the list only; `[(value)]`, forms                               |
| `lfx-ui-command-menu`   | `UiCommandMenuComponent`   | Command palette in a modal via `UiCommandMenuService`: search, groups, shortcut hints, empty state; combobox and listbox                                               |
| `lfx-ui-multi-select`   | `UiMultiSelectComponent`   | Several values from the same `lfx-ui-option` rows: checkbox rows, Only action, count in the trigger; `[(values)]` and forms with `string[]`                            |
| `lfxUiPopover`          | `UiPopoverDirective`       | Non-modal dialog panel in the Menu material from any content: `aria-haspopup`, `aria-expanded`, Escape and outside click close; open it from `lfx-ui-button [popover]` |

## Design tokens

The LFX UI Library tokens come from `scripts/ui-tokens/tokens.json` (canonical, copied from the library). `yarn ui:tokens` (from `apps/lfx-one`) regenerates `src/styles/ui-tokens.css`, which `src/styles.scss` loads; a unit spec fails when the two drift. Do not edit the CSS by hand.

- **CSS variables:** every token is a `--ui-*` variable: roles (`--ui-neutral-900`), primitives (`--ui-azure-500`), `--ui-shadow-*`, `--ui-radius-*`, `--ui-height-*`, `--ui-width-*`, `--ui-z-*`, `--ui-breakpoint-*`, `--ui-opacity-*`, `--ui-duration-*`, `--ui-ease*`, `--ui-font-*`, `--ui-spacing-*`. The names carry an extra `--ui-` prefix relative to the library's `bundle.css` (`--shadow-menu` there is `--ui-shadow-menu` here), so they cannot collide with app CSS. Values are on `:root` and `[data-theme='light']`; `[data-theme='dark']` overrides the themed ones. The app has no theme switch yet, so it always renders light.
- **Tailwind utilities** (v3, `tailwind.config.js`) read those variables, so they follow the theme. Existing classes (`bg-blue-500`, `text-gray-700`, `rounded-md`, `shadow-md`, `text-sm`) are unchanged.
- **White and black:** on-colour ink is `text-ui-white` (also `bg-ui-white`, `stroke-ui-white` and the `ui-black` equivalents), which read `--ui-white` / `--ui-black`. The bare `text-white` is the app's `lfxColors.white`, not a library token.
- **Exact px:** the app root font is 14px, so rem would scale. Library sizes are px values, not Tailwind's rem scale (`h-10` is 35px here; `h-ui-medium` is 40px).
- **No opacity modifier:** colours are CSS variables, so `bg-ui-accent-500/50` does not work. Use the matching `ui-*-alpha` or lower step (`bg-ui-accent-100`).
- **Primitives** other than white and black (`azure`, `slate`, ...) are variables only. Components use the `ui-*` roles, except the hover and active colour mixes on `--ui-slate-900` in Button, SplitButton and Toast, which copy the library's `bundle.css` until it ships mix tokens. The primitives are for charts, avatars and illustrations (`var(--ui-azure-500)`).
- **Colour literals:** a few shadows and masks use literal colours, because the library ships no token for them yet:
  - Slider thumb lift: `rgba(15, 23, 43, 0.16)` (the `--ui-slate-900` ink) for the 2px drop, since `shadow-small` is visibly heavier.
  - Toggle thumb shadow: `rgba(15, 23, 43, 0.2)` and `0.1` for its two layers, copied from the library.
  - Toast hover: white at 16% on success and error toasts, which have no white-alpha token.
  - Tooltip key ring: white at 25% around the shortcut keys.
  - Scroller mask: `#000` is only the mask's alpha stop, not a colour.

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

Type-role classes set the library's cv11/ss01, so uikit text and content projected into uikit containers (modal body, table cells, collapse panels) get them; the app body is unchanged.

Use `duration-ui-*` / `ease-ui-*` instead of arbitrary `duration-[150ms]` / `ease-[cubic-bezier(...)]` values, and keep `prefers-reduced-motion` gating (`motion-safe:` / `motion-reduce:`).

Review them visually in Storybook under Foundations/Tokens.

## Storybook

Stories load from `shared/uikit/**/*.stories.ts` only; Foundations/Tokens shows the colour roles, shadows, radii, heights, type roles and motion. Config is in `apps/lfx-one/.storybook/`.

```bash
yarn storybook          # dev server on http://localhost:6006
yarn build-storybook    # static build into apps/lfx-one/storybook-static
```

Autodocs read the JSDoc on each input through Compodoc, which `build-storybook` runs. Storybook is not part of CI yet.
