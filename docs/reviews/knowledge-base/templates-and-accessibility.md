# Templates and accessibility

Patterns CodeRabbit + Copilot flag in Angular templates — ARIA roles, focus management, keyboard parity, semantic HTML, class-binding clobbering, wrong `@for` track keys, missing `lens=` query params, inline-style misuse, PrimeNG primitives used directly instead of LFX wrappers, dynamic labels forced to single-line at narrow viewports, and tooltips attached to non-focusable hosts. Heavily concentrated in `.component.html` files for table rows, custom toggle buttons, and icon-only buttons.

**Read when:** any `.component.html` file changed. Cross-checked in Steps 3-4 of the learnings-review playbook (KB-match gate in Step 3, false-positive filter in Step 4); findings without a quotable pattern below are dropped.

---

## `templates-and-accessibility/nested-interactive-elements` — Important

**Pattern:** an interactive element (`role="button"`, `tabindex="0"`, anchor, button) contains another interactive element. Invalid HTML; breaks screen-reader navigation; keyboard focus order is unpredictable.

**Detect:** in `.component.html`, look for `<tr role="button"` / `<div role="button"` / `<a` that contains a `<button>`, `<a>`, or another `<… tabindex>` child.

**Empirical citation:** PR #706 `apps/lfx-one/src/app/.../foundation-row.component.html:21` — "The foundations row `<tr>` carries `role=\"button\"` and `tabindex=\"0\"` while also containing an actual `<button>` (the chevron) and, when expanded, the inline detail rows contain further `<tr role=\"button\" tabindex=\"0\">` project rows. Nesting interactive elements inside an interactive ancestor is invalid."

**Failure message:** Nested interactive elements — invalid HTML, breaks assistive tech.

**Fix:** flatten the structure. Either (a) make only the outer element interactive and remove the inner button (use an icon-only visual cue), or (b) keep the inner button and remove the outer `role="button"`. Don't have both.

---

## `templates-and-accessibility/icon-only-button-no-aria-label` — Important

**Pattern:** a button whose only visible content is an icon (`<svg>`, `<i class="fa-...">`, `<fa-icon>`) without an `aria-label` attribute. Screen readers will announce "button" with no description.

**Detect:** grep for `<button[^>]*>` that contains a `<svg`, `<i\s+class="(fa|pi)`, or `<fa-icon` without an `aria-label=` attribute on the button itself.

**Empirical citation:** PR #706 multiple chevron / close / toggle buttons missing labels — observed across `foundation-row.component.html` and sibling templates.

**Failure message:** Icon-only button has no accessible name; screen readers will announce only "button".

**Fix:** add `aria-label="<action>"` to the button (e.g., `aria-label="Expand row"`, `aria-label="Close dialog"`).

---

## `templates-and-accessibility/missing-aria-pressed-on-toggle` — Important

**Pattern:** a button representing a binary on/off state (toggle, filter chip, tab, selection) without `[attr.aria-pressed]` bound to the active state. State is invisible to assistive tech.

**Detect:** grep for `<button` elements with class names suggesting toggle behavior (`active`, `selected`, `toggle`, `chip`) without `aria-pressed`, `aria-selected`, or `role="tab"` semantics.

**Empirical citation:** PR #641 `apps/lfx-one/src/app/.../marketing-impact.component.html:66` — CodeRabbit 🟠 Major — "Add proper tab semantics for screen reader and keyboard parity."

**Failure message:** Toggle button missing `aria-pressed` — state inaccessible to assistive tech.

**Fix:** bind `[attr.aria-pressed]="isActive()"` (signal/getter returning boolean). For tab-list patterns, use `role="tab"` + `aria-selected` + the correct ancestor `role="tablist"`.

---

## `templates-and-accessibility/click-without-keydown` — Important

**Pattern:** custom `(click)="..."` on a non-button element (`<div>`, `<span>`, `<tr>`) without a corresponding `(keydown.enter)` / `(keydown.space)` handler. Mouse-only interaction; keyboard users are excluded.

**Detect:** grep for `(click)=` on elements that aren't `<button>` / `<a>` / native form controls. Check for a sibling `(keydown.*)` handler.

**Empirical citation:** Implied by PR #706's nested-interactive findings — when CodeRabbit + Copilot recommend flattening, the keyboard-parity gap is part of the same fix.

**Failure message:** Click handler without keyboard equivalent; keyboard users can't trigger the action.

**Fix:** either (a) use a `<button>` element instead, or (b) add `(keydown.enter)` and `(keydown.space)` handlers calling the same method, plus `tabindex="0"` and an appropriate `role`.

---

## `templates-and-accessibility/class-binding-clobbers-static-class` — Important

**Pattern:** an element has both `[class]="boundExpression"` and `class="static classes"` attributes. Angular replaces (clobbers) the static class string with the bound expression's result — the static classes silently disappear at runtime.

**Detect:** in `.component.html`, find any element with both `[class]=` AND `class=` attributes. Multi-line check; both attributes can be on different lines.

**Empirical citation:** PR #690 `apps/lfx-one/src/app/.../committee-table.component.html:129` — "`[class]` binding on the badge `<span>` overrides the static `class=\"inline-flex …\"` attribute, so the base layout/typography classes will be removed at runtime. Use `ngClass` (or include the base classes in the bound string)." Confirmed at a second site: `committee-dashboard.component.html:68`.

**Failure message:** `[class]` binding clobbers static `class=` on the same element.

**Fix:** use `[ngClass]="..."` which is additive (merges with static class), OR include the static classes in the bound string. Don't have both `[class]` and `class` on the same element.

---

## `templates-and-accessibility/for-track-not-stable-identity` — Important

**Pattern:** `@for (item of items(); track item.id)` is fine if items have a stable `id`. But `track $index` (or `track item.name`) for an array that can reorder breaks Angular's diff and produces wrong DOM updates (animations skip, focus jumps, etc.).

**Detect:** in `.component.html`, find every `@for (... ; track ...)` and check the track expression. Prefer stable identity fields (`id`, `uid`, `key`). `$index` is only safe for arrays that never reorder.

**Empirical citation:** general pattern from CodeRabbit comments across multiple PRs touching new `@for` loops.

**Failure message:** `@for` track key isn't a stable identity — reorder breaks DOM diffing.

**Fix:** use the stable identity field. If items have no natural ID, derive one (synthetic key from content hash) or use `$index` ONLY when you can guarantee no reordering.

---

## `templates-and-accessibility/missing-lens-query-param-on-link` — Important

**Pattern:** a router link or navigation in templates omits the `lens=` query param when navigating to a lens-aware route. Users navigating land on the wrong lens (or get redirected unexpectedly).

**Detect:** find `[routerLink]=` / `router.navigate(...)` calls targeting lens-aware routes (under `/project/:id/` etc.). Check whether `lens=<currentLens>` is in `queryParams`.

**Empirical citation:** PR #701 area — "Missing `lens=` query param" appeared in routing/guard-related Copilot finds.

**Failure message:** Navigation to lens-aware route missing `lens=` query param — wrong lens on landing.

**Fix:** add `queryParams: { lens: this.activeLens() }` to the navigation call, or include it in the routerLink expression. `activeLens` is a `Signal<Lens>` exposed by `LensService` (`apps/lfx-one/src/app/shared/services/lens.service.ts`) — read it by calling `lensService.activeLens()`.

---

## `templates-and-accessibility/style-binding-vs-class-utility` — Nit

**Pattern:** `[style.color]="..."` inline style binding when an equivalent Tailwind utility class exists. Violates the project's "Tailwind first" rule per `.claude/rules/styling.md`.

**Detect:** grep for `\[style\.(color|background|padding|margin|width|height|font-size|font-weight)]=` in `.component.html`.

**Empirical citation:** general pattern; CodeRabbit occasionally surfaces.

**Failure message:** Inline `[style.*]` binding when a Tailwind utility could be used.

**Fix:** use `[ngClass]` or a Tailwind utility class. Reserve `[style.*]` for genuinely dynamic values (computed colors, dynamic dimensions) that can't be expressed with utilities.

---

## `templates-and-accessibility/primeng-bypass-lfx-wrapper` — Important

**Pattern:** an Angular template uses a PrimeNG component directly (e.g., `<p-tabs>`, `<p-button>`, `<p-table>`, `<p-dialog>`) instead of the LFX wrapper component the repo standardises on. Bypasses the wrapper's defaults (styling tokens, accessibility hooks, signal-aware inputs) and breaks the "UI library independence" abstraction documented in `docs/architecture/frontend/component-architecture.md`.

**Detect:** in `.component.html`, grep for `<p-(tabs|tabView|button|table|dialog|drawer|select|menu|chip|tooltip|inputtext|checkbox|radiobutton)[\s>]`. For each match, check whether an LFX wrapper exists under `apps/lfx-one/src/app/shared/components/` for that primitive — if yes, the template must use the wrapper.

**Empirical citation:** H-02 KB coverage audit (2026-05-19) — PRs #326, #335, #356, #357: "Direct p-tabs / PrimeNG bindings bypass LFX wrapper components."

**Failure message:** Template uses a PrimeNG primitive directly instead of its LFX wrapper — bypasses wrapper defaults and breaks UI-library independence.

**Fix:** replace with the LFX wrapper (e.g. `<lfx-button>`, `<lfx-select>`, `<lfx-table>` — see `apps/lfx-one/src/app/shared/components/` for the current set). If a wrapper doesn't exist yet for the primitive you need (e.g. there is no `lfx-tabs` / `lfx-tooltip` today), add one under `shared/components/` and update the import — don't reach into PrimeNG directly from a feature module.

---

## `templates-and-accessibility/no-wrap-truncates-dynamic-label` — Important

**Pattern:** a card subtitle / caption / metric label has `whitespace-nowrap` (or `truncate` without container width allowance) applied to dynamic content. Long names overflow the card on smaller viewports — the text clips or pushes layout sideways. The risk is unpredictable user-provided content (project names, foundation names, account labels) that fit fine in design mocks but break in production.

**Detect:** in `.component.html`, find dynamic text bindings (`{{ ... }}`) inside elements with `whitespace-nowrap` / `truncate` / `text-ellipsis`. For each, verify (a) a sibling tooltip exposes the full string, AND (b) the layout can accommodate wrapping at narrow widths (e.g., `whitespace-normal lg:whitespace-nowrap` for desktop-only nowrap). Static labels are fine — the risk is unpredictable dynamic content.

**Empirical citation:** H-02 KB coverage audit (2026-05-19) — PRs #485, #492, #495: "Long card subtitles forced to single-line and clip on smaller viewports."

**Failure message:** Dynamic label / subtitle forced to single-line — clips or breaks layout on narrow viewports.

**Fix:** allow wrapping by default (`whitespace-normal`), apply `nowrap` only at breakpoints where the container is wide enough (`lg:whitespace-nowrap`). Pair with a tooltip showing the full string when truncation does occur, and use `min-w-0` on flex children to let truncation work without overflowing the parent.

---

## `templates-and-accessibility/tooltip-on-non-focusable-host` — Important

**Pattern:** a tooltip (`pTooltip`, `<lfx-tooltip>`, `[title]`) is attached to a non-interactive, non-focusable host element (`<span>`, `<div>`, `<img>`) without `tabindex="0"`. Keyboard users can't reach the host to trigger the tooltip — only mouse hover works, which excludes keyboard-only and screen-reader users.

**Detect:** in `.component.html`, find every tooltip-bearing attribute (`pTooltip=`, `tooltipPosition=`, `[lfxTooltip]=`, `title=`). For each, verify the host is either (a) a natively-focusable element (`<button>`, `<a href>`, form control), or (b) carries `tabindex="0"` plus a `role` that announces meaning. Host placement also matters — tooltips on icons inside non-focusable wrappers need the wrapper to be the focusable element.

**Empirical citation:** H-02 KB coverage audit (2026-05-19) — PRs #255, #257, #258, #447, #469, #713: "Tooltips attached to hover-only or non-focusable spans/divs."

**Failure message:** Tooltip on non-focusable host — keyboard users can't trigger it.

**Fix:** move the tooltip to a focusable element (a `<button>` containing the icon, an `<a>` link). If the host genuinely must be a `<span>` / `<div>`, add `tabindex="0"` plus an appropriate `role` and matching `aria-label`. Bind `(focus)` / `(blur)` so keyboard focus shows the tooltip the same way hover does.
