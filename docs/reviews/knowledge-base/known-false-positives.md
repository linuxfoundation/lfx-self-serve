# Known false positives — applied LAST in the knowledge-base review pass

Findings that match any pattern below MUST be dropped, regardless of which source (rule file, checklist, pattern file) originally produced them. This list is the floor — even a quotable pattern doesn't survive if it matches a known false positive.

Applied by the `/lfx-self-serve-learnings-review` skill (Step 4) to its own findings. The general and security reviewers of the pre-PR round do not read this file; a false positive they raise is rebutted in place, not filtered here.

---

## Angular / framework version drift

### `ChangeDetectionStrategy.OnPush` flags

**Pattern matched:** any finding stating that a component is missing `changeDetection: ChangeDetectionStrategy.OnPush`.

**Why false:** the app uses **stable zoneless change detection** (`provideZonelessChangeDetection()` in `app.config.ts`). `OnPush` is irrelevant under zoneless — the runtime is already not doing zone-based change detection.

**Source:** `docs/architecture/frontend/angular-patterns.md`.

### `standalone: true` flags

**Pattern matched:** any finding stating that a component / directive / pipe is missing `standalone: true`.

**Why false:** Angular 20+ makes `standalone: true` **the default**. Adding it is redundant; flagging its absence is wrong.

### `provideZonelessChangeDetection()` marked experimental

**Pattern matched:** any finding stating `provideZonelessChangeDetection()` is experimental, in developer preview, or unstable.

**Why false:** zoneless change detection became **stable in Angular 20**. Not experimental. Not preview.

### `[class]` binding "clobbers" a static `class` attribute

**Pattern matched:** any finding stating that an element with both `class="static classes"` and `[class]="boundExpression"` loses the static classes at runtime — i.e. that the binding "clobbers" or "overrides" the static attribute.

**Why false:** under Angular Ivy, a static `class` attribute and a `[class]` property binding on the same element are **merged**, not clobbered. Verified empirically (#1784, 2026-08-22): rendering `<div class="static-a static-b" [class]="dyn">` in this repo's own TestBed on Angular 20.3.15 produced `class="static-a static-b dynamic-c"` — both static and bound classes present. That check is now a committed regression spec (initial render and the update path both covered) — `apps/lfx-one/src/app/shared/utils/angular-class-binding-merge.spec.ts` — so a future Angular upgrade that ever changed this behavior fails CI instead of silently invalidating this entry. The repo already relies on this merge behavior in multiple places (e.g. `stat-card-grid.component.html`, `public-foundation-groups.component.html`, `public-project-groups.component.html`), so `[class]` (Angular's own recommended binding for a single dynamic class expression) is the established convention here, not a bug to "fix" by switching to `[ngClass]`.

**Note:** this superseded a same-named "Important" entry that used to live in `templates-and-accessibility.md` (citing PR #690), asserting the opposite. That entry was itself the false positive and has been removed — do not re-add it without first re-verifying against the current Angular version, since Ivy's merge behavior is what actually governs this, not framework lore from pre-Ivy Angular.

---

## Already-covered-by-tooling

### Prettier line-length / formatting on `.md` files

**Pattern matched:** prettier line-length, trailing-whitespace, or formatting nits on `*.md` files.

**Why false:** formatting is already enforced by pre-commit / CI and by `/preflight`'s formatting step. Surfacing the same formatting-only issue in a review is duplicate signal.

### License-header complaints on a file that has one

**Pattern matched:** finding states a `.ts` / `.html` / `.scss` is missing the MIT license header, when `head -2 <file>` confirms it's present.

**Why false:** `check-headers.sh` and the pre-commit hook already enforce this. If they pass, the file has the header — CodeRabbit/Copilot misread it.

---

## Review-automation quirks

### CodeRabbit `🏁 Script executed:` reconnaissance dumps

**Pattern matched:** any text quoting a CodeRabbit `🏁 Script executed:` block (typically a `wc` or `grep` CodeRabbit ran to verify its claim).

**Why false:** this is internal CodeRabbit reasoning, not a finding. If we quote it in our report, we're surfacing noise.

### CodeRabbit per-doc copy-editing suggestions

**Pattern matched:** suggestions to reword Helm chart descriptions, README phrasing, changelog entries, etc., when the change is purely cosmetic.

**Why false:** out of scope for the PR. The bots flag copy-editing on `Chart.yaml` / `README.md` because they touch every file; reviewers don't act on it.

### Copilot "Consider extracting helper function" for single-use helpers

**Pattern matched:** suggestion to extract a 3-5 line block into a named helper, when the block is used exactly once and inlining is clearer.

**Why false:** premature abstraction. CLAUDE.md explicitly says "three similar lines is better than a premature abstraction" — single-use extraction violates this.

### `PORT=4200` in `.env.example` flagged as wrong port

**Pattern matched:** any finding stating that `PORT=4200` (or related `PCC_BASE_URL=http://localhost:4200`) in `apps/lfx-one/.env.example` is incorrect because the deployment uses port 4000.

**Why false:** in this repo, port 4200 is intentional for local development — the Angular dev server runs on 4200. The 4200→4000 port change only applies to deployment / production (`apps/lfx-one/ecosystem.config.js` PM2 config; deployed values live in the `lfx-v2-argocd` repo). CodeRabbit learned this in PR #261.

**Source:** PR #261 CodeRabbit learning timestamp `2026-03-06T18:57:30.153Z`.

### "Add Copilot custom instructions" promotional CTA

**Pattern matched:** the trailing "Improve your code reviews — add custom instructions" text Copilot appends to every PR summary.

**Why false:** promotional, not a finding.

---

## Deep imports from non-Angular runtimes

### Deep `@lfx-one/shared/utils/*.utils.ts` import instead of the `utils` barrel

**Pattern matched:** any finding stating that code should import from the `@lfx-one/shared/utils` category barrel instead of a specific `*.utils.ts` file, when the importing code is outside Angular's own runtime — e.g. `apps/lfx-one/e2e/**` (Playwright specs/helpers run under plain Node/tsx) or a standalone Node script.

**Why false:** `utils/form.utils.ts` and `utils/vote.utils.ts` both statically import `@angular/forms`, which pulls in `@angular/common`'s `PlatformLocation` and throws (`getCompilerFacade` JIT-compile failure) the moment anything imports them outside a runtime that has `@angular/compiler` loaded — Angular's own build/dev-server pipeline always has it, but Playwright's plain Node runtime does not. Importing the barrel from `apps/lfx-one/e2e/**` breaks even when the needed symbol has nothing to do with forms, because the barrel re-exports `form.utils.ts` unconditionally (verified, GH-2381: `yarn playwright test --list` aborted collection for the entire ~104-file suite with `errors: 4` from a single barrel import at `apps/lfx-one/e2e/helpers/formation-api-mock.helper.ts:5`). This is documented as a second sanctioned deep-import case in `docs/architecture/shared/package-architecture.md` § "Non-Angular runtimes must avoid the `utils` barrel", alongside the existing "barrel doesn't re-export it" case — the fix here is _not_ "add the symbol to `index.ts`," since it's already exported there; the barrel itself is what throws. Five pre-existing e2e files already deep-import this way: `org-roi-summary.spec.ts`, `org-roi-projects.spec.ts`, `org-roi-project-detail.spec.ts`, `past-meeting-ai-summary-visibility.spec.ts`, `helpers/committee-engagement.helper.ts`.

**Source:** `docs/architecture/shared/package-architecture.md` § Non-Angular runtimes must avoid the `utils` barrel; `.claude/rules/development-rules.md` § Testing.

---

## PR-description-vs-UI-text "drift" when UI is canonical

**Pattern matched:** finding stating the PR description and the UI text disagree on a label/heading.

**Why false (conditional):** only false when the UI text is the source of truth (design-led PRs where the implementation is canonical and the PR description was written first). When the UI accidentally diverges from a spec the PR cites, the finding IS valid. Author has to make the call — but the default for this codebase is "UI text is canonical for landed PRs," so default to dropping.

---

## How to add a new entry

When you encounter a finding from CodeRabbit + Copilot the team has explicitly decided is not relevant for this codebase:

1. Add an entry here with **Pattern matched**, **Why false**, and (where applicable) **Source**.
2. If the pattern was previously in a `<file>.md`, remove it from there too — don't have a pattern in both files.
3. If the pattern is something the CodeRabbit + Copilot will surface forever (e.g., zoneless OnPush flags from Copilot), that's permanent. If it's a one-time misread, no need to add it.

This file should accumulate slowly. If it grows past ~50 entries, that's a signal we're being too permissive — re-audit.
