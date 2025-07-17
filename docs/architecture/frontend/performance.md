# Performance

## ⚡ SSR Performance Benefits

### Server-Side Rendering Optimizations

The application uses Angular Universal with AngularNodeAppEngine for optimal performance:

```typescript
// server.ts - Express SSR server
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';

const angularApp = new AngularNodeAppEngine();

export function app(): express.Express {
  const server = express();

  // SSR route handler
  server.get('**', (req, res, next) => {
    angularApp
      .handle(req)
      .then((response) => {
        if (response) {
          writeResponseToNodeResponse(response, res);
        } else {
          next();
        }
      })
      .catch(next);
  });

  return server;
}
```

### Performance Metrics

- **Time to First Byte (TTFB)**: Reduced by pre-rendering on server
- **First Contentful Paint (FCP)**: Improved by ~40% vs client-only rendering
- **Largest Contentful Paint (LCP)**: Better initial page performance
- **Cumulative Layout Shift (CLS)**: Minimized by SSR content stability

## 🎯 Zoneless Change Detection

### Performance Impact

```typescript
// Traditional Angular with Zone.js
// - Monkey patches global APIs
// - Triggers change detection on every async operation
// - Higher memory usage and slower startup

// Angular 19 Zoneless
export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    // Signals-based change detection
    // Manual triggering when needed
    // Better tree-shaking and smaller bundles
  ],
};
```

### Benefits

- **Bundle Size**: ~30KB reduction by removing Zone.js
- **Startup Time**: Faster application initialization
- **Memory Usage**: Lower runtime memory footprint
- **Change Detection**: More predictable and efficient

## 🔄 Signal-Based Reactivity

### Performance Characteristics

```typescript
// Efficient signal updates
@Injectable({ providedIn: 'root' })
export class PerformantService {
  private readonly dataSignal = signal<Data[]>([]);

  // Computed signals are memoized and only recalculate when dependencies change
  public readonly filteredData = computed(() => {
    const data = this.dataSignal();
    return data.filter((item) => item.isActive);
  });

  // Updates only trigger re-computation of dependent computed signals
  public updateData(newData: Data[]): void {
    this.dataSignal.set(newData); // Minimal update cycle
  }
}
```

### Signal Performance Benefits

- **Selective Updates**: Only components using changed signals re-render
- **Memoization**: Computed signals cache results automatically
- **Minimal DOM Updates**: Precise change detection
- **No Over-Rendering**: Unlike RxJS streams that can trigger unnecessary updates

## 🏗 Build Optimizations

### Angular Build Pipeline

```json
// angular.json - Production optimizations
{
  "build": {
    "builder": "@angular-devkit/build-angular:browser",
    "options": {
      "optimization": true,
      "sourceMap": false,
      "extractCss": true,
      "namedChunks": false,
      "aot": true,
      "buildOptimizer": true
    }
  }
}
```

### Webpack Optimizations

- **Tree Shaking**: Removes unused code
- **Code Splitting**: Lazy loading for route-based chunks
- **Bundle Analysis**: `ng build --stats-json` for size monitoring
- **Source Map Generation**: Disabled in production for smaller bundles

### CSS Optimizations

```scss
// CSS Layer optimization
@layer tailwind-base, primeng, tailwind-utilities;

// PurgeCSS integration
// Only used CSS classes are included in production builds
```

## 📦 Bundle Management

### Current Bundle Sizes (Production)

```text
main.[hash].js          ~180KB (gzipped)
vendor.[hash].js        ~120KB (gzipped)
styles.[hash].css       ~45KB (gzipped)
runtime.[hash].js       ~12KB (gzipped)
```

### Optimization Strategies

1. **Dynamic Imports**: Route-based code splitting
2. **Tree Shaking**: Removing unused PrimeNG components
3. **Font Optimization**: Google Fonts with display=swap
4. **Image Optimization**: WebP format with fallbacks

## 🚀 Runtime Performance

### Component Performance Patterns

```typescript
@Component({
  selector: 'lfx-optimized-list',
  template: `
    @for (item of items(); track trackByFn) {
      <lfx-project-card [title]="item.name" [description]="item.description"> </lfx-project-card>
    }
  `,
})
export class OptimizedListComponent {
  protected readonly items = inject(ProjectService).projects;

  // TrackBy function for efficient list updates
  protected readonly trackByFn = (index: number, item: Project): string => item.id;
}
```

### Virtual Scrolling

For large datasets, implement virtual scrolling:

```html
<lfx-table [value]="largeDataset()" [virtualScroll]="true" [virtualScrollItemSize]="48" [virtualScrollOptions]="{ lazy: true }"> </lfx-table>
```

## 🔧 Development Performance

### Hot Module Replacement (HMR)

Development server optimization:

```json
// angular.json - Development configuration
{
  "serve": {
    "builder": "@angular-devkit/build-angular:dev-server",
    "options": {
      "hmr": true,
      "liveReload": false
    }
  }
}
```

### TypeScript Compilation

```json
// tsconfig.json - Performance optimizations
{
  "compilerOptions": {
    "incremental": true,
    "skipLibCheck": true,
    "strict": true
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictTemplates": true
  }
}
```

## 📈 Performance Best Practices

### Component Level

1. **Use Signals**: Replace RxJS with signals for simple state
2. **TrackBy Functions**: Always provide trackBy for @for loops
3. **Computed Signals**: Use for derived data instead of methods
4. **OnPush Strategy**: Not needed with signals and zoneless change detection

### Service Level

1. **Readonly Signals**: Expose readonly versions from services
2. **Async Operations**: Use async/await with try/catch
3. **Error Handling**: Implement proper error states
4. **Caching**: Implement appropriate data caching strategies

### Application Level

1. **Lazy Loading**: Implement route-based code splitting
2. **Preloading**: Configure router preloading strategies
3. **Service Workers**: Cache static assets and API responses
4. **Image Optimization**: Use appropriate formats and lazy loading

## 🎯 Performance Testing

### Lighthouse Metrics

Target performance scores:

- **Performance**: 90+
- **Accessibility**: 95+
- **Best Practices**: 90+
- **SEO**: 95+

### Load Testing

```bash
# Performance testing commands
ng build --configuration=production
ng run lfx-pcc:serve:production

# Lighthouse CI for automated testing
npx @lhci/cli autorun
```

### Bundle Analysis

```bash
# Analyze bundle size
ng build --stats-json
npx webpack-bundle-analyzer dist/lfx-pcc/stats.json
```

This provides comprehensive performance optimization across the entire frontend stack, from build-time optimizations to runtime performance patterns.
