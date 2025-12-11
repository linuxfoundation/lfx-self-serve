# Angular Patterns

## ⚡ Zoneless Change Detection

Angular 19 introduces experimental zoneless change detection, which this application uses for improved performance.

### Configuration

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
    provideAnimationsAsync(),
    // ... other providers
  ],
};
```

### Key Benefits

- **No Zone.js dependency**: Reduces bundle size and improves startup performance
- **Better performance**: Manual change detection triggering when needed
- **Signal-first**: Encourages use of Angular Signals for reactive programming
- **Future-ready**: Prepares codebase for Angular's direction

### Implications for Development

1. **Use Angular Signals** for state management instead of RxJS for simple data
2. **Manual change detection** may be needed for some third-party integrations
3. **Testing adjustments** may be required for components that rely on automatic change detection
4. **Event handling** works as expected with Angular's event system

## 🎯 Angular Signals

Angular Signals are the preferred way to manage state in this application.

### Component Patterns

```typescript
@Component({
  selector: 'lfx-example',
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    @if (loading()) {
      <div>Loading...</div>
    } @else if (error()) {
      <div>Error: {{ error() }}</div>
    } @else {
      @for (item of data(); track item.id) {
        <div>{{ item.name }}</div>
      }
    }
  `,
})
export class ExampleComponent {
  private readonly service = inject(DataService);

  // Access reactive signals from service
  public readonly data = this.service.data;
  public readonly loading = this.service.loading;
  public readonly error = this.service.error;
}
```

### Service Patterns

```typescript
@Injectable({ providedIn: 'root' })
export class DataService {
  // Private state signals
  private readonly dataSignal = signal<Data[]>([]);
  private readonly loadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);

  // Public readonly signals
  public readonly data = this.dataSignal.asReadonly();
  public readonly loading = this.loadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();

  // Computed signals for derived state
  public readonly activeData = computed(() => this.dataSignal().filter((item) => item.is_active));
}
```

## 🌐 Server-Side Rendering (SSR)

### SSR Configuration

```typescript
// app.config.server.ts
export const config = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering(), provideServerRouting(serverRoutes)],
});
```

### Server Routes

```typescript
// app.routes.server.ts
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
```

### SSR Benefits

- **Improved SEO**: Pre-rendered content for search engines
- **Faster initial load**: Content visible before JavaScript loads
- **Better UX**: Reduced time to first contentful paint
- **Progressive enhancement**: Works without JavaScript enabled

## 🔧 Standalone Components

All components use Angular's standalone component pattern:

```typescript
@Component({
  selector: 'lfx-example',
  imports: [CommonModule, ReactiveFormsModule, ButtonModule],
  template: `<!-- template here -->`,
})
export class ExampleComponent {
  // Component implementation
}
```

### Benefits

- **Explicit dependencies**: Clear import requirements
- **Tree-shakable**: Only imported code is bundled
- **Modular**: Components are self-contained
- **Future-ready**: Angular's recommended approach

## 📝 Template Syntax

Modern Angular template syntax used throughout:

```html
<!-- Control flow -->
@if (condition) {
<div>Content</div>
} @else {
<div>Alternative</div>
}

<!-- For loops with track -->
@for (item of items(); track item.id) {
<div>{{ item.name }}</div>
}

<!-- Signal interpolation -->
{{ signalValue() }}
```

## 🔄 Data Transformation Best Practices

### Use Pipes Instead of Methods

For data transformation in templates, always use Angular pipes instead of component methods:

```typescript
// ❌ BAD: Using methods in templates
@Component({
  template: `<span>{{ formatDate(item.created_at) }}</span>`,
})
export class BadComponent {
  formatDate(date: string): string {
    return new Date(date).toLocaleDateString();
  }
}

// ✅ GOOD: Using pipes in templates
@Component({
  template: `<span>{{ item.created_at | date: 'MMM d, y' }}</span>`,
})
export class GoodComponent {
  // No method needed - use Angular's built-in date pipe
}
```

### Benefits of Using Pipes

1. **Performance**: Pipes are pure by default and cached - they only re-execute when inputs change
2. **Reusability**: Pipes can be shared across components
3. **Testability**: Easier to unit test pipes in isolation
4. **Separation of Concerns**: Keeps components focused on logic, not formatting
5. **Change Detection**: Methods are called on every change detection cycle, pipes only when needed

### Common Built-in Pipes

```html
<!-- Date formatting -->
{{ dateValue | date: 'MMM d, y' }} {{ dateValue | date: 'MMM d, yyyy @ h:mm a' }}

<!-- Number formatting -->
{{ numberValue | number: '1.2-2' }} {{ price | currency: 'USD' }}

<!-- Text transformation -->
{{ text | uppercase }} {{ text | lowercase }} {{ text | titlecase }}

<!-- Array/Object manipulation -->
{{ items | slice: 0:10 }} {{ object | json }}
```

## 🎨 Component Input/Output Patterns

### Input Signals

```typescript
export class ExampleComponent {
  // Required inputs
  public readonly title = input.required<string>();
  public readonly description = input.required<string>();

  // Optional inputs with defaults
  public readonly isActive = input<boolean>(false);
  public readonly size = input<'small' | 'large'>('small');
}
```

### Output Signals

```typescript
export class ExampleComponent {
  // Output events
  public readonly onClick = output<Event>();
  public readonly valueChange = output<string>();

  // Event handlers
  public handleClick(event: Event): void {
    this.onClick.emit(event);
  }
}
```

## 🔄 Change Detection Strategy

With zoneless change detection:

1. **Signals automatically trigger updates** when values change
2. **Event handlers** trigger change detection
3. **Async operations** may need manual triggering
4. **Third-party libraries** may require integration adjustments

## 📊 Performance Considerations

- **Use signals** for all reactive state
- **Avoid RxJS** for simple data flows
- **Leverage computed signals** for derived data
- **Use track functions** in `@for` loops
- **Minimize DOM manipulations** outside Angular
