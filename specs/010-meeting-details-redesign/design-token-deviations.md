# Design token deviations — meeting details V2

**Issue**: [E0-05 / #1769](https://github.com/linuxfoundation/lfx-self-serve/issues/1769) ·
**Token layer**: [`apps/lfx-one/src/app/modules/meetings/meeting-details-v2/meeting-details-v2.tokens.scss`](../../apps/lfx-one/src/app/modules/meetings/meeting-details-v2/meeting-details-v2.tokens.scss)

The V2 prototype's look and feel differs from the current app **on purpose**. This document
records exactly where, so the divergence is a deliberate, reviewable list rather than an
accident that accumulates component by component.

## Rules the token layer enforces

1. **Every** colour, radius and shadow in the V2 tree resolves through a `--md-*` custom
   property. No component writes a raw hex, an `rgb()`/`rgba()` literal, or an arbitrary
   Tailwind colour value such as `bg-[#0d69f5]`.
2. Tokens are named by **role**, not hue — `--md-status-good`, never `--md-green-500`. The
   palette can be swapped without renaming a token or touching a consumer.
3. The whole layer lives under a single container class, `.meeting-details-v2`. Nothing is
   added to global styles and `:root` is not redefined, so V1 and the rest of the app are
   untouched and the layer reverts by deleting the file and its `@use`.
4. Literal colour values appear in the token file and nowhere else. That file is the
   definition boundary; the repo-wide "no hard-coded hex" rule is satisfied by every
   consumer resolving `var(--md-*)`.

## Deviation table

`lfxColors` references are to `packages/shared/src/constants/colors.constants.ts`.
"Adopt upstream?" says whether the intent is to converge on the `lfxColors` value later or
to keep the V2 value and push it upstream instead.

### Surfaces

| Token                | V2 value  | Nearest `lfxColors` | Difference                                     | Adopt upstream?                           |
| -------------------- | --------- | ------------------- | ---------------------------------------------- | ----------------------------------------- |
| `--md-surface-page`  | `#ffffff` | `white` `#FFFFFF`   | none                                           | n/a — exact match                         |
| `--md-surface-card`  | `#ffffff` | `white` `#FFFFFF`   | none                                           | n/a — exact match                         |
| `--md-surface-hover` | `#f6f7f9` | `gray.50` `#F8FAFC` | V2 hover is neutral; `gray.50` is cooler/bluer | Yes — converge on `gray.50` once verified |

### Edges

| Token                | V2 value  | Nearest `lfxColors`  | Difference                                | Adopt upstream?              |
| -------------------- | --------- | -------------------- | ----------------------------------------- | ---------------------------- |
| `--md-border`        | `#e6e8eb` | `gray.200` `#E2E8F0` | V2 is warmer and marginally lighter       | Yes — converge on `gray.200` |
| `--md-border-strong` | `#d5d8dd` | `gray.300` `#CAD5E2` | V2 is warmer and lighter                  | Yes — converge on `gray.300` |
| `--md-divider`       | `#eef0f2` | `gray.100` `#F1F5F9` | V2 is warmer                              | Yes — converge on `gray.100` |
| `--md-dot`           | `#c7cbd1` | `gray.300` `#CAD5E2` | V2 is warmer; used only for timeline dots | Yes — converge on `gray.300` |

### Text hierarchy

Contrast is measured against `--md-surface-card` (`#ffffff`). WCAG AA wants 4.5:1 for normal
text.

| Token               | V2 value  | Contrast | Nearest `lfxColors`                                 | Difference                                           | Adopt upstream?                             |
| ------------------- | --------- | -------- | --------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `--md-text-heading` | `#0f1419` | 18.7:1   | `gray.900` `#0F172B`                                | V2 is a neutral near-black; `gray.900` is blue-black | Yes — converge on `gray.900`                |
| `--md-text-body`    | `#374151` | 10.3:1   | between `gray.700` `#314158` / `gray.600` `#45556C` | V2 sits between two scale steps                      | Yes — pick `gray.700` after a contrast pass |
| `--md-text-muted`   | `#6b7280` | 4.83:1   | `gray.500` `#62748E`                                | V2 is neutral; `gray.500` is noticeably blue         | Yes — converge on `gray.500`                |

Three tiers, not four. The prototype's faintest ink measures 2.54:1 on white — below AA, and
below even the 3:1 large-text floor. A white surface cannot carry four AA-compliant text
tiers: the band between `--md-text-muted` (4.83:1) and the 4.5:1 floor is too narrow to read
as a distinct step. So the faintest tier is **not a text token**. It is recorded below under
Non-text ink and named `--md-glyph-faint`, so a component reaching for it as copy reads wrong
at the call site.

### Non-text ink

| Token              | V2 value  | Contrast | Nearest `lfxColors`  | Difference                                   | Adopt upstream?              |
| ------------------ | --------- | -------- | -------------------- | -------------------------------------------- | ---------------------------- |
| `--md-glyph-faint` | `#9ca3af` | 2.54:1   | `gray.400` `#90A1B9` | V2 is neutral; `gray.400` is noticeably blue | Yes — converge on `gray.400` |

Disabled glyphs, placeholder iconography, hairline rules. Never copy.

### Accent / CTA

| Token             | V2 value               | Contrast | Nearest `lfxColors`  | Difference                                                       | Adopt upstream?                                                  |
| ----------------- | ---------------------- | -------- | -------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `--md-accent`     | `#0d69f5`              | 4.82:1   | `blue.500` `#009AFF` | `blue.500` is markedly cyan; the prototype uses a true blue      | **No** — this is the deliberate brand divergence; raise upstream |
| `--md-accent-ink` | `#1558c0`              | 6.59:1   | `blue.700` `#0061A3` | follows `--md-accent`; used for text/icons on accent backgrounds | **No** — follows whatever `--md-accent` resolves to              |
| `--md-accent-bg`  | `rgb(13 105 245 / 9%)` | —        | —                    | derived from `--md-accent`                                       | n/a — derived                                                    |

`--md-accent` is darkened from the prototype's `#0f6fff`, which measured 4.43:1 and missed AA
for link and CTA text. Text placed **on** `--md-accent-bg` must use `--md-accent-ink`: the
accent on its own 9% tint is only 4.27:1.

### Status

Status hues are used as chip text on their own tinted background, so contrast is measured
there — the stricter of the two surfaces — with the value on `--md-surface-card` alongside.

| Token                 | V2 value               | On chip | On card | Nearest `lfxColors`     | Difference                                                | Adopt upstream?                       |
| --------------------- | ---------------------- | ------- | ------- | ----------------------- | --------------------------------------------------------- | ------------------------------------- |
| `--md-status-good`    | `#157347`              | 5.10:1  | 5.87:1  | `emerald.600` `#009966` | V2 is less saturated and darker                           | Yes — converge on `emerald.600`       |
| `--md-status-good-bg` | `rgb(21 115 71 / 10%)` | —       | —       | —                       | derived                                                   | n/a — derived                         |
| `--md-status-warn`    | `#945e10`              | 4.62:1  | 5.43:1  | `amber.700` `#BB4D00`   | `amber.700` is far more orange; V2 reads as ochre         | **No** — hue; keep V2, raise upstream |
| `--md-status-warn-bg` | `rgb(148 94 16 / 12%)` | —       | —       | —                       | derived                                                   | n/a — derived                         |
| `--md-status-live`    | `#c4342b`              | 4.67:1  | 5.42:1  | `red.600` `#E7000B`     | `red.600` is a pure red; V2 is softer and slightly orange | Yes — converge on `red.600`           |
| `--md-status-live-bg` | `rgb(196 52 43 / 10%)` | —       | —       | —                       | derived                                                   | n/a — derived                         |

All three hues are darkened from the prototype, which measured roughly 3.6:1 on-chip across
good, warn and live — every status chip would have failed AA. The divergence from `lfxColors`
that survives is **`--md-status-warn`, and the reason is hue, not contrast**: `amber.700`
measures 5.03:1 on white and passes comfortably, it simply reads as orange where the design
wants ochre.

### Radii and elevation

`lfxColors` covers colour only, so these have no upstream equivalent. They are listed
because acceptance requires every radius and shadow to resolve through a token.

| Token                | V2 value                            | Used for                               |
| -------------------- | ----------------------------------- | -------------------------------------- |
| `--md-radius-xs`     | `3px`                               | progress bars, rails, hairline chips   |
| `--md-radius-md`     | `8px`                               | buttons, inputs, small tiles           |
| `--md-radius-lg`     | `10px`                              | cards, panels                          |
| `--md-radius-chip`   | `13px`                              | pill chips (26px tall)                 |
| `--md-radius-circle` | `50%`                               | avatars, status dots                   |
| `--md-shadow-color`  | `rgb(15 20 25 / 9%)`                | derived from `--md-text-heading`       |
| `--md-shadow-pop`    | `0 6px 18px var(--md-shadow-color)` | hover/raised cards and tiles           |
| `--md-shadow-focus`  | `0 0 0 3px var(--md-accent)`        | focus ring — 4.82:1 light, 6.25:1 dark |

## Dark values

The prototype carries a `[data-theme="dark"]` block. Those values are reproduced under
`:host-context(.dark-mode) .meeting-details-v2`, matching the `darkModeSelector: '.dark-mode'`
that PrimeNG is already configured with. The app ships no control that sets that class, so the block is
**inert today**; it exists so the prototype's dark contract is recorded rather than lost, and
so V2 does not have to be re-derived when a toggle lands. The prototype does not override the
elevation colour in dark, and neither does this layer.

The `:host-context` form is required, not stylistic. Angular's emulated encapsulation scopes
every compound in a selector, so a plain `.dark-mode .meeting-details-v2` would compile to
`.dark-mode[_ngcontent-x] .meeting-details-v2[_ngcontent-x]` — and `.dark-mode` sits on the
document root, which never carries that attribute. It would match nothing, permanently, and
the failure would look like "the toggle hasn't shipped yet". `:host-context` is the one
construct whose ancestor part is deliberately left unscoped.

Every dark value clears AA on the dark surfaces without adjustment.

## Convergence path

The divergences above are not meant to be permanent. The neutral scales — surfaces, edges and
text — differ from `lfxColors` only in temperature: the prototype's greys are neutral where
`lfxColors`' are blue-tinted. Those are the cheap ones, and the plan is to converge them onto
the named `gray.*` steps once the V2 tree is built and a single before/after pass can confirm
the shift reads correctly across every state, rather than doing it token by token while the
design is still moving. `--md-status-good` and `--md-status-live` converge the same way. What
is left after that is a short, defensible list: `--md-accent`, which is the deliberate brand
divergence the redesign exists to prove out, and `--md-status-warn`, where `amber.700` reads
as orange rather than the ochre the design calls for. Both belong upstream in
`@linuxfoundation/lfx-ui-core` as a proposal, not in a per-page override — so the end state is
that this file shrinks to radii and elevation, and its colour tokens become thin aliases of
`lfxColors`. Because every consumer already resolves `var(--md-*)`, each of those steps is an
edit to this one file and nothing else.

One caveat on convergence: several V2 values are darker than the prototype's because the
prototype's own values failed WCAG AA — the three status hues, and the accent. Converging a
token onto its `lfxColors` step must re-measure, not just substitute. The step that is nearest
in hue is not automatically the one that passes.
