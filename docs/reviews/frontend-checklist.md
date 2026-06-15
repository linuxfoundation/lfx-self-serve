# Frontend Review Checklist

Angular 20 frontend review standards. Each item includes severity and a brief violation/fix example.

---

## 1. Component organization order (SHOULD FIX)

Components must follow the 11-section structure defined in `.claude/rules/component-organization.md` (Section 4). That rule file is canonical; do not maintain the list here.

**Violation:** WritableSignals declared after constructor, or injections mixed with public fields.
**Fix:** Reorder to match the structure in `.claude/rules/component-organization.md`.

---

## 2. PrimeNG wrapper strategy (SHOULD FIX)

No direct `p-*` components in feature module templates. Must use `lfx-*` wrappers.

**Violation:**

```html
<p-button label="Save" /> <p-table [value]="items()">...</p-table>
```

**Fix:**

```html
<lfx-button label="Save" /> <lfx-table [value]="items()">...</lfx-table>
```

Common wrappers: `lfx-button`, `lfx-table`, `lfx-tag`, `lfx-input-text`, `lfx-select`, `lfx-checkbox`, `lfx-textarea`.

---

## 3. No `<p-dialog>` (CRITICAL)

Must use `DialogService.open()` with dynamic components. Never use `<p-dialog>` in templates.

**Violation:**

```html
<p-dialog [(visible)]="showDialog" header="Edit Item">
  <form>...</form>
</p-dialog>
```

**Fix:**

```typescript
private readonly dialogService = inject(DialogService);

openEditDialog(): void {
  this.dialogService.open(EditItemDialogComponent, {
    header: 'Edit Item',
    data: { item: this.selectedItem() },
  });
}
```

---

## 4. No template functions (SHOULD FIX)

Only signal reads `()`, computed values, and pipes allowed in templates. No method calls that execute logic.

**Violation:**

```html
<span>{{ formatDate(item.date) }}</span>
<div [class]="getStatusClass(item.status)"></div>
```

**Fix:**

```html
<span>{{ item.date | date:'MMM d, y' }}</span>
<div [class]="item.statusClass"></div>
```

Use pipes for formatting and computed signals for derived state.

---

## 5. No effect() (SHOULD FIX)

Use `toObservable()` with RxJS pipes instead. Exception: simple logging/debugging only.

**Violation:**

```typescript
effect(() => {
  const term = this.searchTerm();
  this.service.search(term).subscribe((results) => this.results.set(results));
});
```

**Fix:**

```typescript
public results: Signal<Item[]> = this.initResults();

private initResults(): Signal<Item[]> {
  return toSignal(
    toObservable(this.searchTerm).pipe(
      debounceTime(300),
      switchMap(term => this.service.search(term)),
      catchError(() => of([] as Item[]))
    ),
    { initialValue: [] }
  );
}
```

---

## 6. No bare .subscribe() (SHOULD FIX)

Must use `takeUntilDestroyed()`, `take(1)`, `firstValueFrom`, or similar lifecycle management.

**Violation:**

```typescript
this.service.getData().subscribe((data) => this.data.set(data));
```

**Fix:**

```typescript
// Option 1: takeUntilDestroyed (auto-injects DestroyRef in constructor/field context)
this.service
  .getData()
  .pipe(takeUntilDestroyed())
  .subscribe((data) => this.data.set(data));

// Option 2: take(1) for one-shot
this.service
  .getData()
  .pipe(take(1))
  .subscribe((data) => this.data.set(data));

// Option 3: firstValueFrom for async
const data = await firstValueFrom(this.service.getData());
```

Note: `takeUntilDestroyed()` auto-injects `DestroyRef` when called in constructor or field initializer context.

---

## 7. Model signals for two-way binding (SHOULD FIX)

Use `model()` not `signal()` for properties needing `[( )]` two-way binding.

**Violation:**

```typescript
public visible = signal(false);
// Template: [visible]="visible()" (visibleChange)="visible.set($event)"
```

**Fix:**

```typescript
public visible = model(false);
// Template: [(visible)]="visible"
```

---

## 8. Tailwind spacing (SHOULD FIX)

Use `flex + flex-col + gap-*` instead of `space-y-*`. Prefer standard Tailwind spacing over arbitrary values. Use `[class.invisible]` instead of `@if` for small toggle elements.

**Violation:**

```html
<div class="space-y-4">...</div>
<div class="p-[24px] mt-[13px]">...</div>
@if (isVisible()) { <span class="badge">New</span> }
```

**Fix:**

```html
<div class="flex flex-col gap-4">...</div>
<div class="p-6 mt-3">...</div>
<span class="badge" [class.invisible]="!isVisible()">New</span>
```

---

## 9. License headers (SHOULD FIX)

Required on all `.ts`, `.html`, `.scss` source files.

**TypeScript / SCSS:**

```typescript
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
```

**HTML:**

```html
<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->
```

---

## 10. data-testid attributes (SHOULD FIX)

Required on interactive elements (buttons, inputs, links, dialogs). Convention: `[section]-[component]-[element]`.

**Violation:**

```html
<button (click)="save()">Save</button>
```

**Fix:**

```html
<button data-testid="settings-form-save-button" (click)="save()">Save</button>
```

---

## 11. Direct imports (NIT)

Standalone components must be imported directly from their file path, not from barrel index files. However, shared package types ARE imported via subpath entrypoints (`@lfx-one/shared/interfaces`, `@lfx-one/shared/constants`).

Do not import from the root `@lfx-one/shared` barrel; prefer subpath entrypoints.

**Violation:**

```typescript
import { MeetingInterface, ProjectInterface } from '@lfx-one/shared';
```

**Fix:**

```typescript
import { MeetingInterface } from '@lfx-one/shared/interfaces';
import { ProjectInterface } from '@lfx-one/shared/interfaces';
```

---

## 12. Additional rules

| Rule                                                                     | Severity   |
| ------------------------------------------------------------------------ | ---------- |
| No `console.log` — use `console.warn` or `console.error`                 | SHOULD FIX |
| No nested ternaries                                                      | SHOULD FIX |
| Selector prefix must be `lfx-`                                           | SHOULD FIX |
| Use `inject()` for DI — never constructor-based injection                | SHOULD FIX |
| Use `@if`/`@for` template syntax — not `*ngIf`/`*ngFor`                  | SHOULD FIX |
| Use `ReactiveFormsModule` always — never `[(ngModel)]` for forms         | SHOULD FIX |
| Use `yarn` — never `npm` or `npx` in scripts/docs/CI                     | SHOULD FIX |
| Signals cannot use RxJS pipes (TypeScript compile error — rarely manual) | SHOULD FIX |
| Always use `templateUrl`, never inline `template: '…'` strings           | SHOULD FIX |

---

## 13. Frontend service rules (SHOULD FIX)

- Services use `@Injectable({ providedIn: 'root' })`
- Use `inject(HttpClient)` for HTTP — never constructor injection
- GET requests use `catchError(() => of(defaultValue))` to prevent error propagation
- POST/PUT/DELETE use `take(1)` for one-shot subscriptions
- **Every `HttpClient` call targets a real `/api/...` endpoint** that exists in the backend routes — no mock data, placeholder URLs, or fabricated paths. API paths are relative (`/api/...`); the proxy handles routing.

**Violation:**

```typescript
@Injectable()
export class MyService {
  constructor(private http: HttpClient) {}
  getData() {
    return this.http.get<Data[]>('/api/data');
  }
}
```

**Fix:**

```typescript
@Injectable({ providedIn: 'root' })
export class MyService {
  private readonly http = inject(HttpClient);
  getData(): Observable<Data[]> {
    return this.http.get<Data[]>('/api/data').pipe(catchError(() => of([] as Data[])));
  }
}
```

---

## 14. High-recurrence reviewer patterns

These 15 audits cover the patterns most commonly flagged by reviewers across 20+ LFX PRs. They are judgment-based — not auto-fixable. Scope to changed files only. Severity is the reviewer's reaction (CRITICAL = always flagged; DISCUSS = judgment call worth surfacing). Use these in addition to sections 1-13 above; some overlap is intentional (e.g., 14.1 echoes #2 with specific raw-element coverage).

### 14.1 Raw HTML form elements (CRITICAL)

In changed `.html` files, look for raw form elements that must use LFX wrappers:

| Raw element                       | Required wrapper                                  |
| --------------------------------- | ------------------------------------------------- |
| `<input`                          | `lfx-input-text` (or other `lfx-input-*` variant) |
| `<select`                         | `lfx-select`                                      |
| `<textarea`                       | `lfx-textarea`                                    |
| `<div` with `animate-pulse` class | `<p-skeleton>` from PrimeNG                       |

Exceptions: elements inside comments, or `<input type="hidden">`. Note: LFX wrappers require `FormGroup` + `FormControl` — `ngModel` is not supported.

### 14.2 Dead code (CRITICAL for unused providers/imports/unbound outputs; DISCUSS for unused methods)

In changed `.ts` files:

- Unused imports (imported symbols not referenced in the file body).
- Unused providers (`providers: [...]` entries in component metadata where the service is never injected).
- Unused methods (private methods not called anywhere in the file; public service methods not called from any changed file).
- Unused signals (declared but never read in the template or class).

In changed `.html` templates, look for unbound component outputs — a template uses a child component (e.g. `<lfx-votes-table>`) but does not bind its emitted outputs (`viewVote`, `rowClick`, `refresh`). Missing output bindings mean user interactions silently do nothing.

### 14.3 Component responsibility (DISCUSS)

In changed `*.component.ts` files, count `inject()` calls and constructor injections:

- 4+ service injections → flag for discussion. Often means the component is doing too much.
- Multiple independent edit workflows in a single component (separate forms that don't share state) → suggest extracting sub-components.

### 14.4 Loading states (CRITICAL for showing `0` during load; DISCUSS for missing re-fetch reset)

In changed `.html` templates and `.ts` files:

- Stats or counts rendered without loading check — interpolations like `{{ count() }}` or `{{ stats().total }}` without a surrounding `@if (loading())` guard. These show `0` during loading instead of a placeholder.
- Missing loading branch — components that fetch data but have no `@if (loading())` / `@else` pattern.
- Content that jumps — `@for` loops rendering data without a loading skeleton.
- Loading not reset on re-fetch — `loading` signal set to `false` after a fetch completes but never set back to `true` when a new fetch starts (e.g. inside `switchMap` when input changes). Fix: `loading.set(true)` at the start of each `switchMap` callback.

Every data display that starts empty and populates asynchronously needs an explicit loading branch showing `—`, `<p-skeleton>`, or equivalent.

### 14.5 Type safety (CRITICAL for `!` in templates; DISCUSS for `!` in `.ts` and `||` vs `??`)

In changed `.html` templates:

- Non-null assertions (`!`) — `data()!.field` or `item!.property` patterns cause runtime crashes when null/undefined. Use `?.` and `@if (data(); as d)` guards instead.

In changed `.ts` files:

- Non-null assertions (`!`) — in `.ts` files, `!` is also used for definite assignment (`foo!: T`) and may already be runtime-guarded. Report for manual review only.
- Falsy `||` vs nullish `??` — `value || null` treats `0`, `""`, and `false` as falsy, hiding valid zero counts (e.g. `total_members || null` hides `0` members). Use `??` to only coalesce on `null`/`undefined`.

### 14.6 Error handling (CRITICAL for silent or unreachable `catchError`; DISCUSS for inconsistent fallbacks)

In changed `.ts` files:

- Silent `catchError` — `catchError(() => of([]))` or `catchError(() => EMPTY)` without any logging before the fallback. Every `catchError` should log via `logger` or `console.error` at minimum. (See also section 13 — GET requests use `catchError(() => of(defaultValue))`; that pattern still requires logging.)
- Duplicate/layered error handling — when a service method already has `catchError` returning a default (e.g. `of([])`), a component-level `catchError` on the same stream is unreachable dead code. Handle errors in one place.
- Inconsistent fallback values — mixing `EMPTY` and `of([])` in the same service. Pick one pattern.
- Removed error logging — check `git diff` for removed `console.error` or `logger.error` calls that weren't replaced.

### 14.7 Signal pattern compliance (CRITICAL for `BehaviorSubject` misuse; DISCUSS for `ChangeDetectorRef` and `model()`)

In changed `*.component.ts` and `*.service.ts` files:

- `BehaviorSubject` for simple state — should use `signal()` instead. `BehaviorSubject` is only appropriate for complex async streams that need RxJS operators.
- `cdr.detectChanges()` or `ChangeDetectorRef` — often not required in zoneless Angular 20 when using signals, `AsyncPipe`, `toSignal`. May still be needed for non-Angular event sources or advanced `OnPush`. Flag for manual review.
- `model()` for internal state — `model()` creates a two-way bindable input/output on the public API. For internal-only state (dialog visibility, drawer toggles not exposed to parents), use `signal()`. Only use `model()` when the parent component needs two-way binding (see also section 7).
- Signals not initialized inline — per `component-organization.md`, simple `WritableSignal`s must be initialized directly (e.g. `loading = signal(false)`), not in the constructor.

### 14.8 Upstream API alignment (CRITICAL for clearly wrong parameter names; DISCUSS for fields needing upstream verification)

In changed `.ts` files containing API calls:

- Parameter names match upstream. Known divergences:
  - Meetings API uses `limit` for pagination.
  - Votes/Surveys APIs use `page_size` for pagination.
  - Do not mix these up.
- No invented fields — if the code references a field in an API response, verify it exists in the upstream contract.
- No UI for non-existent backend fields — form fields or display elements bound to data the API doesn't actually return.

If the upstream contract cannot be verified from the local codebase, flag for manual verification.

### 14.9 PR description completeness (DISCUSS)

Check the git log and diff for changes that need explicit documentation in the PR description:

- Removed UI elements (deleted components, removed buttons/fields/sections from templates).
- Permission check changes (FGA checks, role guards, auth logic).
- Error handling behavior changes (changed fallback values, modified retry logic, altered error messages).

### 14.10 Accessibility (DISCUSS)

In changed `.html` templates:

- Missing `aria-pressed` on toggle buttons — button groups acting as toggles must have `[attr.aria-pressed]="isActive()"`.
- Nested interactive elements — a clickable `<div (click)>` containing an `<lfx-button>` or `<a>`.
- Focusable elements behind overlay/blur masks — use `[attr.tabindex]="-1"`, `inert`, or conditionally render.
- Missing `aria-label` on icon-only buttons.

### 14.11 Design token compliance (DISCUSS)

In changed `.html` templates, look for hardcoded Tailwind color classes that should use LFX design tokens:

- Hardcoded colors — `bg-blue-50`, `text-gray-300`, `border-blue-100`, etc. Check `tailwind.config.js` for the LFX custom color palette. Raw Tailwind defaults are not design tokens.

### 14.12 N+1 API patterns (DISCUSS)

In changed `.ts` files:

- Per-item fetches — `.map(item => this.http.get('/api/' + item.id))` or `forkJoin(items.map(...))` where a batch endpoint exists.
- Backend equivalent: in Express controllers, `await` inside `for` / `forEach` / `.map()` loops calling `microserviceProxy.proxyRequest()`.

### 14.13 Template / config completeness (CRITICAL for missing switch cases; DISCUSS for partial wiring)

In changed `.html` templates and `.component.ts` files:

- Missing `@switch` cases — if a component defines tabs/routes/modes in a config array, every entry must have a corresponding `@case` in the template. A tab in config without a matching case renders blank content.
- `activeTab` not constrained to visible set — if tabs are conditionally visible, ensure `activeTab` resets to a valid tab when the visible set changes.
- Partial feature wiring — form controls, outputs, or config entries added but not fully connected.

### 14.14 Stale data during navigation (DISCUSS)

In changed `*.component.ts` files:

- One-time initialization that should react to changes — `if (!this.data())` guards that only load data on first render, not when route params change.
- Early returns that skip state reset — guard clauses that exit before resetting `loading` or `saving` signals, leaving the UI stuck.
- `track $index` in `@for` loops — causes unnecessary DOM churn when items reorder. Prefer `track item.uid` or a stable identifier.

### 14.15 Visitor / permission gating (CRITICAL for content flashing during role loading; DISCUSS for blur bypass)

In changed `.html` templates:

- Content visible during role loading — `@if (!isVisitor())` evaluates to `true` while `myRoleLoading()` is still `true` (because `isVisitor()` defaults to `false`). Fix: add `!myRoleLoading()` to the guard.
- Visitor blur bypass — blur overlays that don't prevent keyboard / screen-reader access (see also 14.10).
- Permission changes not documented — if the diff adds/removes/changes `canEdit()`, `isVisitor()`, `hasPMOAccess()` checks, flag for PR description.

---

## DO NOT FLAG

The following are **not violations** in this codebase:

- **Missing `ChangeDetectionStrategy.OnPush`** — not required with zoneless change detection
- **Missing `standalone: true`** — Angular defaults components, directives, and pipes to standalone
- **`provideZonelessChangeDetection()`** — this is stable, NOT experimental
