# Self Serve Frontend Code Generation

Use this reference with `/self-serve-dev` when building or modifying Self Serve Angular
components, services, templates, drawers, pagination UI, and styling. If this
reference conflicts with `CLAUDE.md`, `.claude/rules/`, or
`docs/architecture/frontend/`, the more specific repo-local source wins.

Generate Angular 20 frontend code that is PR-ready. Use these conventions for components, services, drawers, pagination, and templates.

**Prerequisites:** Backend endpoints must already exist. No mock data, no placeholder APIs.

## Input Validation

Before generating any code, verify the task context includes:

| Required                                  | If Missing                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| Specific task (what to build/modify)      | Stop and ask — do not guess                                                       |
| Which module (committees, meetings, etc.) | Infer from context or ask                                                         |
| Type definitions being used               | Must be found in this repo or in the owning upstream contract before writing code |

## Read Before Generating — MANDATORY

Before writing ANY code, you MUST:

1. **Read `.claude/skills/self-serve-dev/SKILL.md`** — it defines the active Self Serve workflow
2. **Read the target file** (if modifying) — understand what's already there
3. **Read one example file** in the same module — match the exact current patterns
4. **Read the relevant interface/type file** — ensure types match

Do NOT generate code from memory alone. The codebase may have evolved since your training data.

## License Header

Every new `.ts`, `.html`, and `.scss` file MUST start with the appropriate license header:

**TypeScript (`.ts`):**

```typescript
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
```

**HTML (`.html`):**

```html
<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->
```

**SCSS (`.scss`):**

```scss
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
```

## Completion Report

When you finish, output a clear summary so the `/self-serve-dev` workflow and the user can see what happened:

```text
═══════════════════════════════════════════
Self Serve frontend pattern review complete
═══════════════════════════════════════════
Files created:
  - (none)

Files modified:
  - member-form.component.ts — added bio FormControl, TextareaComponent import
  - member-form.component.html — added bio textarea field
  - member-card.component.html — added bio display section

Validation:
  - Ran: yarn format
  - Result: ✓ passed / ✗ failed with: <error>

Notes:
  - Bio field uses lfx-textarea with 500 char max, 3 rows
  - Follows linkedin_profile field pattern

Errors:
  - (none)
═══════════════════════════════════════════
```

**Always include the Validation section.** Run `yarn format` after modifying files. Report the result.

## 1. Component Generation

### Placement Decision

| Category                  | Location                                        |
| ------------------------- | ----------------------------------------------- |
| Route/page component      | `modules/<module>/<component-name>/`            |
| Module-specific component | `modules/<module>/components/<component-name>/` |
| Shared (cross-module)     | `shared/components/<component-name>/`           |
| PrimeNG wrapper           | `shared/components/<component-name>/`           |

### Files to Generate

Every component creates three files, each with the license header:

- `<name>.component.ts`
- `<name>.component.html`
- `<name>.component.scss`

### Component Class Structure

The 11-section ordering is canonical in `.claude/rules/component-organization.md` (Section 4 - structure order; Sections 1-3 cover signal initialization patterns). Read that rule before generating; the skeleton below is illustrative only.

```typescript
@Component({
  selector: 'lfx-my-component',
  standalone: true,
  imports: [CommonModule, ButtonModule],  // Direct imports, no barrel exports
  templateUrl: './my-component.component.html',
  styleUrl: './my-component.component.scss',
})
export class MyComponentComponent {
  // 1. Private injections (readonly)   |  See component-organization.md Section 4
  private readonly myService = inject(MyService);

  // 2-3. Public input fields, Forms
  public readonly itemId = input.required<string>();
  public readonly form = new FormGroup({ ... });

  // 4-6. Model signals, WritableSignals, computed/toSignal via init functions
  public visible = model(false);
  public loading = signal(false);
  public filteredItems: Signal<Item[]> = this.initFilteredItems();

  // 7-9. Constructor (rare), public methods, protected methods
  public onSave(): void { ... }

  // 10-11. Private init functions (grouped), other private helpers
  private initFilteredItems(): Signal<Item[]> {
    return computed(() => {
      const term = this.searchTerm().toLowerCase();
      return this.items().filter(item => item.name.toLowerCase().includes(term));
    });
  }
}
```

### Signal Types Quick Reference

| Signal Type        | Usage                      | Example                                       |
| ------------------ | -------------------------- | --------------------------------------------- |
| `signal()`         | Simple writable state      | `loading = signal(false)`                     |
| `input()`          | Parent -> child data       | `label = input<string>('Default')`            |
| `input.required()` | Required parent -> child   | `itemId = input.required<string>()`           |
| `output()`         | Child -> parent events     | `saved = output<Item>()`                      |
| `computed()`       | Derived from other signals | `total = computed(() => this.items().length)` |
| `model()`          | Two-way binding            | `visible = model(false)`                      |
| `toSignal()`       | Observable -> signal       | `data = toSignal(obs$, { initialValue: [] })` |

### Template Rules

```html
<!-- Use @if / @for (not *ngIf / *ngFor) -->
@if (loading()) {
<lfx-spinner />
} @else {
<div class="flex flex-col gap-4" data-testid="items-section">
  @for (item of items(); track item.id) {
  <div data-testid="item-card">{{ item.name }}</div>
  }
</div>
}
```

- **Layout:** `flex + flex-col + gap-*` — never `space-y-*`
- **Test IDs:** `data-testid="[section]-[component]-[element]"` on all key elements
- **No nested ternaries** in templates or TypeScript
- **Pipes for transforms** — never methods in templates (performance + caching)

### PrimeNG Wrapper Pattern

All PrimeNG components are wrapped for UI library independence:

```typescript
@Component({
  selector: 'lfx-my-wrapper',
  standalone: true,
  imports: [PrimeNgModule],
  template: `
    <p-component [options]="options()">
      <ng-content />
    </p-component>
  `,
})
export class LfxMyWrapperComponent {
  // CRITICAL: descendants: false prevents grabbing nested content
  @ContentChild(SomeDirective, { descendants: false })
  public template?: SomeDirective;
}
```

- Prefix wrappers with `lfx-`
- Use `descendants: false` on `@ContentChild` — this is critical
- Use template projection (`<ng-content />`) to pass through content

### Common Anti-Patterns — DO NOT DO THESE

| Anti-Pattern                            | Correct Pattern                                 |
| --------------------------------------- | ----------------------------------------------- |
| `*ngIf="condition"`                     | `@if (condition()) { ... }`                     |
| `*ngFor="let item of items"`            | `@for (item of items(); track item.id) { ... }` |
| `class="space-y-4"`                     | `class="flex flex-col gap-4"`                   |
| `{{ getLabel() }}` (method in template) | `{{ label \| myPipe }}` (use pipe)              |
| `constructor(private svc: MyService)`   | `private readonly svc = inject(MyService);`     |
| `@Input() name: string`                 | `public readonly name = input<string>()`        |
| `@Output() save = new EventEmitter()`   | `public save = output<Item>()`                  |
| Importing from barrel `index.ts`        | Direct import from the component file           |
| `condition ? (a ? b : c) : d`           | Break into computed signals or @if blocks       |

## 2. Service Generation

**Location:** `apps/lfx-one/src/app/shared/services/<name>.service.ts`

### Service Pattern

```typescript
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, of, take } from 'rxjs';
import { MyItem } from '@lfx-one/shared/interfaces';

@Injectable({ providedIn: 'root' })
export class MyService {
  private readonly http = inject(HttpClient);

  // Shared state (when multiple components need the same data)
  public items = signal<MyItem[]>([]);

  // GET — catchError with sensible default
  public getItems() {
    return this.http.get<MyItem[]>('/api/items').pipe(catchError(() => of([] as MyItem[])));
  }

  // GET with params
  public getItemsByProject(projectUid: string, pageSize?: number, pageToken?: string) {
    let params = new HttpParams().set('parent', `project:${projectUid}`);
    if (pageSize) params = params.set('page_size', pageSize.toString());
    if (pageToken) params = params.set('page_token', pageToken);
    return this.http
      .get<PaginatedResponse<MyItem>>('/api/items', { params })
      .pipe(catchError(() => of({ data: [], page_token: undefined } as PaginatedResponse<MyItem>)));
  }

  // POST/PUT/DELETE — take(1), let errors propagate
  public createItem(payload: Partial<MyItem>) {
    return this.http.post<MyItem>('/api/items', payload).pipe(take(1));
  }
}
```

### Service Rules

- `@Injectable({ providedIn: 'root' })` — always tree-shakeable
- `inject(HttpClient)` — never constructor-based DI
- GET: `catchError(() => of(default))` for graceful degradation
- POST/PUT/DELETE: `take(1)` and let errors propagate
- Interfaces from `@lfx-one/shared/interfaces` — never define locally
- API paths are relative: `/api/<resource>`

## 3. Drawer Pattern

Drawers are slide-in detail panels.

### Visibility

```typescript
public readonly visible = model<boolean>(false);

protected onClose(): void {
  this.visible.set(false);
}
```

### Lazy Data Loading

Load data only when the drawer opens:

```typescript
private initDrawerData(): Signal<DrawerData> {
  return toSignal(
    toObservable(this.visible).pipe(
      skip(1),  // Skip initial false — prevents API call on init
      switchMap(isVisible => {
        if (!isVisible) {
          this.drawerLoading.set(false);
          return of(DEFAULT_VALUE);
        }
        this.drawerLoading.set(true);

        return forkJoin({
          monthly: this.service.getMonthly(accountId),
          distribution: this.service.getDistribution(accountId),
        }).pipe(
          tap(() => this.drawerLoading.set(false)),
          catchError(() => {
            this.drawerLoading.set(false);
            return of(DEFAULT_VALUE);
          })
        );
      })
    ),
    { initialValue: DEFAULT_VALUE }
  );
}
```

### Drawer Template

```html
<p-drawer
  [(visible)]="visible"
  position="right"
  [modal]="true"
  [showCloseIcon]="false"
  styleClass="xl:w-[45%] lg:w-[55%] md:w-[70%] sm:w-[90%] w-full"
  data-testid="my-drawer">
  <ng-template #header>
    <div class="flex items-start justify-between gap-4 w-full">
      <div class="flex flex-col gap-1 flex-1">
        <h2 class="text-lg font-semibold text-gray-900">Title</h2>
      </div>
      <button type="button" (click)="onClose()" class="p-1 text-gray-400 hover:text-gray-600" aria-label="Close panel">
        <i class="fa-light fa-xmark text-xl"></i>
      </button>
    </div>
  </ng-template>

  <div class="flex flex-col gap-6 pb-2">
    @if (drawerLoading()) {
    <div class="flex items-center justify-center py-12">
      <i class="fa-light fa-spinner-third fa-spin text-2xl text-gray-400"></i>
    </div>
    } @else if (hasData()) {
    <!-- Content sections -->
    } @else {
    <div class="text-center py-8 border border-slate-200 rounded-lg">
      <p class="text-sm text-gray-500">No data available</p>
    </div>
    }
  </div>
</p-drawer>
```

## 4. Pagination UI

### Infinite Scroll (Scrollable Lists)

```typescript
private pageToken = signal<string | undefined>(undefined);
public loadingMore = signal(false);
public hasMore = computed(() => !!this.pageToken());

private initItems(): Signal<Item[]> {
  const firstPage$ = combineLatest([project$, filter$]).pipe(
    switchMap(([project, filter]) => {
      this.loading.set(true);
      return this.service.getItems(project.uid, 50).pipe(
        map((r): PageResult<Item> => ({ ...r, reset: true })),
        finalize(() => this.loading.set(false))
      );
    })
  );

  const nextPage$ = this.loadMore$.pipe(
    switchMap(pageToken => {
      this.loadingMore.set(true);
      return this.service.getItems(project.uid, 50, pageToken).pipe(
        map((r): PageResult<Item> => ({ ...r, reset: false })),
        finalize(() => this.loadingMore.set(false))
      );
    })
  );

  return toSignal(
    merge(firstPage$, nextPage$).pipe(
      tap(response => this.pageToken.set(response.page_token)),
      scan((acc, response) => response.reset ? response.data : [...acc, ...response.data], [])
    ),
    { initialValue: [] }
  );
}
```

## 5. Styling Quick Reference

- **CSS Layers:** `@layer tailwind-base, primeng, tailwind-utilities`
- **Utility-first:** Use Tailwind classes, avoid custom CSS unless necessary
- **LFX Colors:** Import from `@lfx-one/shared/constants` (`lfxColors`)
- **Icons:** Font Awesome Pro — `fa-light` default, `fa-solid` for emphasis
- **Layout:** `flex + flex-col + gap-*` — never `space-y-*`
- **Responsive:** Mobile-first breakpoints (`sm:`, `md:`, `lg:`, `xl:`)

## 6. Checklists

### Component Checklist

- [ ] Standalone with direct imports (no barrel exports)
- [ ] Correct placement per category table
- [ ] Three files (`.ts`, `.html`, `.scss`) with license headers
- [ ] Class structure follows 11-section order
- [ ] Selector prefixed with `lfx-`
- [ ] Uses `@if`/`@for` (not `*ngIf`/`*ngFor`)
- [ ] Uses `flex + gap-*` (not `space-y-*`)
- [ ] Has `data-testid` attributes on key elements
- [ ] No nested ternary expressions
- [ ] Pipes for template transforms (never methods)

### Service Checklist

- [ ] `@Injectable({ providedIn: 'root' })`
- [ ] `inject(HttpClient)` (not constructor DI)
- [ ] GET requests have `catchError` with sensible default
- [ ] POST/PUT/DELETE use `take(1)`
- [ ] Interfaces from `@lfx-one/shared/interfaces`
- [ ] API paths are relative (`/api/...`)
- [ ] No mock data or placeholder URLs
- [ ] File has license header

## Scope Boundaries

**This reference covers:**

- Generate/modify Angular components, services, templates, styles
- Follow all frontend conventions (signals, standalone, PrimeNG wrappers)
- Run `yarn format` after changes

**This reference does not cover:**

- Generate backend code; route service implementation work to the owning backend repo.
- Modify shared API or service contracts without reading the owning contract docs.
- Make architectural decisions without following the repo's architecture docs and code-owner guidance.
- Modify routing or build config (`app.routes.ts` for route registration, the hook-protected `apps/lfx-one/angular.json`) — flag for code owner
