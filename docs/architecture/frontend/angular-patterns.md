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
  selector: "lfx-example",
  standalone: true,
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
  protected readonly data = this.service.data;
  protected readonly loading = this.service.loading;
  protected readonly error = this.service.error;
}
```

### Service Patterns

```typescript
@Injectable({ providedIn: "root" })
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
  public readonly activeData = computed(() =>
    this.dataSignal().filter((item) => item.is_active),
  );
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
    path: "**",
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
  selector: "lfx-example",
  standalone: true,
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

## 🎨 Component Input/Output Patterns

### Input Signals

```typescript
export class ExampleComponent {
  // Required inputs
  public readonly title = input.required<string>();
  public readonly description = input.required<string>();

  // Optional inputs with defaults
  public readonly isActive = input<boolean>(false);
  public readonly size = input<"small" | "large">("small");
}
```

### Output Signals

```typescript
export class ExampleComponent {
  // Output events
  public readonly onClick = output<Event>();
  public readonly valueChange = output<string>();

  // Event handlers
  protected handleClick(event: Event): void {
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
