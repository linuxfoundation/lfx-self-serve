# Frontend Review Checklist

Angular 20 frontend review standards. Each item includes severity and a brief violation/fix example.

---

## 1. Component organization order (SHOULD FIX)

Components must follow this 11-section structure:

1. Private injections (with `readonly`)
2. Public fields from inputs/dialog data (with `readonly`)
3. Forms
4. Model signals (`model()`)
5. Simple WritableSignals (direct initialization)
6. Complex computed/toSignal signals (via private init functions)
7. Constructor
8. Public methods
9. Protected methods
10. Private initializer functions (grouped together)
11. Other private helper methods

**Violation:** WritableSignals declared after constructor, or injections mixed with public fields.
**Fix:** Reorder to match the structure above.

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

## DO NOT FLAG

The following are **not violations** in this codebase:

- **Missing `ChangeDetectionStrategy.OnPush`** — not required with zoneless change detection
- **Missing `standalone: true`** — Angular defaults components, directives, and pipes to standalone
- **`provideZonelessChangeDetection()`** — this is stable, NOT experimental
