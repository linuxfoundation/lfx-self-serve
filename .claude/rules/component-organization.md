---
description: Angular component organization pattern — signal initialization, structure order, model signals
globs: '**/*.component.ts'
---

# Component Organization Pattern

When creating Angular components with signals and computed values, follow this structure:

## 1. WritableSignals - Initialize directly for simple values

Simple WritableSignals with basic initial values should be initialized inline:

```typescript
export class MyComponent {
  // Simple WritableSignals - initialize directly
  public loading = signal(false);
  public count = signal(0);
  public name = signal('');
  public items = signal<string[]>([]);
}
```

## 2. Model Signals - Use for two-way binding

For properties that require two-way binding (e.g., dialog visibility, form values), use `model()` instead of `signal()`:

```typescript
import { model } from '@angular/core';

export class MyComponent {
  // Two-way binding properties - use model()
  public visible = model(false);
  public selectedValue = model<string>('');
}
```

In templates, model signals can use the `[(ngModel)]`-style two-way binding syntax:

```html
<!-- Two-way binding with model() - cleaner syntax -->
<p-dialog [(visible)]="visible">...</p-dialog>

<!-- Regular signals would require split binding -->
<p-dialog [visible]="visible()" (visibleChange)="visible.set($event)">...</p-dialog>
```

## 3. Computed/toSignal - Use private init functions for complex logic

Computed signals and toSignal conversions with complex logic should use private initializer functions:

```typescript
export class MyComponent {
  // Simple WritableSignals - direct initialization
  public loading = signal(false);
  public searchTerm = signal('');

  // Complex computed/toSignal - use private init functions
  public filteredItems: Signal<Item[]> = this.initFilteredItems();
  public dataFromServer: Signal<Data[]> = this.initDataFromServer();

  // Private initializer functions at the bottom of the class
  private initFilteredItems(): Signal<Item[]> {
    return computed(() => {
      const term = this.searchTerm().toLowerCase();
      return this.items().filter((item) => item.name.toLowerCase().includes(term));
    });
  }

  private initDataFromServer(): Signal<Data[]> {
    return toSignal(
      toObservable(this.event).pipe(
        filter((event) => !!event?.id),
        switchMap((event) => this.service.getData(event.id)),
        catchError(() => of([] as Data[]))
      ),
      { initialValue: [] as Data[] }
    );
  }
}
```

## 4. Component structure order

1. Private injections (with `readonly`)
2. Public fields from inputs/dialog data (with `readonly`)
3. Forms
4. Model signals for two-way binding (`model()`)
5. Simple WritableSignals (direct initialization)
6. Complex computed/toSignal signals (via private init functions)
7. Constructor
8. Public methods
9. Protected methods
10. Private initializer functions (grouped together)
11. Other private helper methods

## 5. Interfaces belong in the shared package

All interfaces, even component-specific ones, should be defined in `@lfx-one/shared/interfaces`. This ensures:

- Consistent type definitions across the codebase
- Reusability if the interface is needed elsewhere later
- Clear separation of type definitions from implementation

```typescript
// Don't define interfaces locally in components
interface RelativeDateInfo {
  text: string;
  color: string;
}

// Import from shared package
import { RelativeDateInfo } from '@lfx-one/shared/interfaces';
```
