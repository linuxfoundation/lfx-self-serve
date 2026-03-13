# Frontend Component Reference

## Placement

Determine the component category and place it accordingly:

| Category                        | Location                                        |
| ------------------------------- | ----------------------------------------------- |
| Route/page component            | `modules/<module>/<component-name>/`            |
| Module-specific component       | `modules/<module>/components/<component-name>/` |
| Shared component (cross-module) | `shared/components/<component-name>/`           |
| PrimeNG wrapper component       | `shared/components/<component-name>/`           |

Check `docs/architecture/frontend/component-architecture.md` for detailed placement guidelines.

A new module can be created if the feature represents a distinct domain, but prefer existing modules when the feature fits.

## Files

Generate three files (`.component.ts`, `.component.html`, `.component.scss`), each with the license header.

## Class Structure (from CLAUDE.md)

1. Private injections (`inject()`, `readonly`)
2. Public fields from inputs/dialog data
3. Forms
4. Model signals (`model()`)
5. WritableSignals (`signal()`)
6. Computed/toSignal signals (via private init functions)
7. Constructor
8. Public methods
9. Protected methods
10. Private initializer functions
11. Private helper methods

## Key Rules

- Standalone components with direct imports (no barrel exports)
- Signals: `signal()`, `input()`, `output()`, `computed()`, `model()` — never constructor DI
- Templates: `@if`/`@for` syntax, `data-testid` attributes, `flex + flex-col + gap-*` (never `space-y-*`)
- Do not nest ternary expressions
- For PrimeNG wrappers, follow the wrapper strategy in the component architecture doc

## Example Pattern

```typescript
@Component({
  selector: 'lfx-my-component',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './my-component.component.html',
  styleUrl: './my-component.component.scss',
})
export class MyComponentComponent {
  // 1. Private injections
  private readonly myService = inject(MyService);

  // 2. Public fields from inputs
  public readonly itemId = input.required<string>();

  // 4. Model signals
  public visible = model(false);

  // 5. WritableSignals
  public loading = signal(false);

  // 6. Computed/toSignal
  public item: Signal<MyItem | null> = this.initItem();

  // 8. Public methods
  public onSave(): void {
    // ...
  }

  // 10. Private initializer functions
  private initItem(): Signal<MyItem | null> {
    return toSignal(
      toObservable(this.itemId).pipe(
        filter((id) => !!id),
        switchMap((id) => this.myService.getItem(id))
      ),
      { initialValue: null }
    );
  }
}
```

## Template Rules

```html
<!-- Use @if / @for -->
@if (loading()) {
<lfx-spinner />
} @else {
<div class="flex flex-col gap-4" data-testid="my-section">
  @for (item of items(); track item.id) {
  <div data-testid="item-card">{{ item.name }}</div>
  }
</div>
}
```

## Checklist

- [ ] Component is standalone with direct imports
- [ ] Correct placement per category table
- [ ] All three files created (`.ts`, `.html`, `.scss`) with license headers
- [ ] Class structure follows the 11-section order
- [ ] Uses `@if`/`@for` (not `*ngIf`/`*ngFor`)
- [ ] Uses `flex + gap-*` (not `space-y-*`)
- [ ] Has `data-testid` attributes on key elements
- [ ] Selector prefixed with `lfx-`
- [ ] No nested ternary expressions
