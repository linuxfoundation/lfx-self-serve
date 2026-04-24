# Lazy Loading & Preloading Strategy

**Overview**: Comprehensive guide to LFX One's intelligent lazy loading and preloading architecture for optimal performance in Angular 20.

## Overview

The LFX One application implements an intelligent lazy loading and preloading strategy to optimize:

- **Initial bundle size** — only essential code ships in the initial bundle; feature modules load on demand.
- **Time to Interactive (TTI)** — faster initial page loads by deferring non-critical routes.
- **User experience** — smart preloading based on usage patterns and network conditions.
- **Resource efficiency** — network-aware loading strategies that skip preloading on slow connections.

### Architecture Pattern

```text
Initial Load (Home) → Smart Preloading → User Navigation (Instant)
     ↓                      ↓                    ↓
  Core App           High-Priority Routes    Pre-loaded Routes
                     (Background Loading)    (Cached & Ready)
```

> Bundle sizes vary per build. Verify current footprint locally with `yarn build` — never hardcode specific numbers into architecture docs (they drift silently).

---

## Lazy Loading Architecture

### Route Architecture

All routes are flat children of `MainLayoutComponent` (no nested `project/:slug` pattern):

```typescript
// app.routes.ts - Main route configuration
{
  path: '',
  canActivate: [authGuard],
  loadComponent: () => import('./layouts/main-layout/main-layout.component')
    .then(m => m.MainLayoutComponent),
  children: [
    { path: '', loadComponent: () => import('./modules/dashboards/dashboard.component').then(m => m.DashboardComponent) },
    { path: 'projects', loadComponent: () => import('./modules/pages/home/home.component').then(m => m.HomeComponent) },
    { path: 'meetings', loadChildren: () => import('./modules/meetings/meetings.routes').then(m => m.MEETING_ROUTES) },
    { path: 'groups', loadChildren: () => import('./modules/committees/committees.routes').then(m => m.COMMITTEE_ROUTES) },
    { path: 'mailing-lists', loadChildren: () => import('./modules/mailing-lists/mailing-lists.routes').then(m => m.MAILING_LIST_ROUTES) },
    { path: 'votes', loadChildren: () => import('./modules/votes/votes.routes').then(m => m.VOTE_ROUTES) },
    { path: 'surveys', loadChildren: () => import('./modules/surveys/surveys.routes').then(m => m.SURVEY_ROUTES) },
    { path: 'settings', loadChildren: () => import('./modules/settings/settings.routes').then(m => m.SETTINGS_ROUTES) },
    { path: 'profile', loadChildren: () => import('./modules/profile/profile.routes').then(m => m.PROFILE_ROUTES) },
  ],
}
```

### Feature Module Lazy Loading

Each feature module defines its own routes with preloading configuration:

```typescript
// Example: meetings.routes.ts
export const MEETING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./meetings-dashboard/meetings-dashboard.component').then((m) => m.MeetingsDashboardComponent),
    data: { preload: true, preloadDelay: 500 },
  },
  // ... additional child routes
];
```

### Bundle Splitting Strategy

| Route Segment     | Loading Strategy               | Priority |
| ----------------- | ------------------------------ | -------- |
| **Core App**      | Eager                          | Critical |
| **Dashboard**     | Lazy + Immediate               | High     |
| **Home/Projects** | Lazy + On-demand               | High     |
| **Meetings**      | Lazy + Fast Preload (500ms)    | High     |
| **Committees**    | Lazy + Medium Preload (1500ms) | Medium   |
| **Mailing Lists** | Lazy + Medium Preload (1500ms) | Medium   |
| **Votes**         | Lazy + Medium Preload (1500ms) | Medium   |
| **Surveys**       | Lazy + Medium Preload (1500ms) | Medium   |
| **Settings**      | Lazy + On-demand               | Low      |
| **Profile**       | Lazy + On-demand               | Low      |

---

## Custom Preloading Strategy

### Intelligent Network-Aware Preloading

The `CustomPreloadingStrategy` implements smart preloading based on:

1. **Network Connection Quality**
2. **Route Priority (usage-based)**
3. **Configurable Delays**

```typescript
@Injectable({ providedIn: 'root' })
export class CustomPreloadingStrategy implements PreloadingStrategy {
  public preload(route: Route, load: () => Observable<any>): Observable<any> {
    if (route.data && route.data['preload']) {
      // Network-aware loading
      const connection = (navigator as any).connection;
      const isSlowConnection = connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g';

      if (isSlowConnection) {
        return of(null); // Skip preloading on slow connections
      }

      // Smart delay-based preloading
      const delay = route.data['preloadDelay'] || 2000;
      return timer(delay).pipe(mergeMap(() => load()));
    }

    return of(null);
  }
}
```

### Preloading Configuration

Routes are configured with priority-based preloading metadata in each feature's route file:

| Route         | Preload                 | Delay  | Priority |
| ------------- | ----------------------- | ------ | -------- |
| Meetings      | `true`                  | 500ms  | High     |
| Committees    | `true`                  | 1500ms | Medium   |
| Mailing Lists | `true`                  | 1500ms | Medium   |
| Votes         | `true` (dashboard only) | 1500ms | Medium   |
| Surveys       | `true`                  | 1500ms | Medium   |
| Settings      | No preload data         | -      | Low      |
| Profile       | No preload data         | -      | Low      |

```typescript
// High-priority route (fast preload) - meetings.routes.ts
data: { preload: true, preloadDelay: 500 }

// Medium-priority route - committees.routes.ts, mailing-lists.routes.ts, votes.routes.ts, surveys.routes.ts
data: { preload: true, preloadDelay: 1500 }

// On-demand only (no preload) - settings, profile
// No data attribute or data: { preload: false }
```

---

## Performance Benefits

### Bundle Size Optimization

Lazy-loading feature modules and using the custom preloading strategy keeps the initial bundle small, defers non-critical work, and makes subsequent navigation near-instant because preloaded chunks are already in cache. Verify the shipping footprint for your build locally:

```bash
yarn build                                   # production bundle + stats
ls -lh apps/lfx-one/dist/lfx-one/browser/    # inspect emitted chunks
```

### Network Efficiency

| Connection Type    | Strategy              | Behavior                                                |
| ------------------ | --------------------- | ------------------------------------------------------- |
| **Fast (4G/WiFi)** | Aggressive preloading | All `preload: true` routes loaded in the background     |
| **Medium (3G)**    | Selective preloading  | Preloading honored but delay is respected               |
| **Slow (2G)**      | No preloading         | `CustomPreloadingStrategy` short-circuits to `of(null)` |

### User Experience Impact

- **Initial page load** shrinks — only the route the user is actually landing on ships up-front.
- **Route navigation** is near-instant for preloaded routes because their chunks are already in cache.
- **Bandwidth** is preserved on slow connections (`effectiveType === 'slow-2g'` / `'2g'` skips preloading entirely).
- **Battery impact** is minimal because preloading is network-aware and delay-scheduled instead of aggressive on page load.

---

## Implementation Guide

### 1. Setting Up Custom Preloading

#### Configure in App Config

```typescript
// app.config.ts
import { CustomPreloadingStrategy } from './shared/strategies/custom-preloading.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withPreloading(CustomPreloadingStrategy)),
    // ... other providers
  ],
};
```

### 2. Creating Lazy Route Modules

#### Step 1: Create Feature Routes File

```typescript
// feature/feature.routes.ts
import { Routes } from '@angular/router';

export const FEATURE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./feature-dashboard/feature-dashboard.component').then((m) => m.FeatureDashboardComponent),
  },
  {
    path: 'create',
    loadComponent: () => import('./feature-create/feature-create.component').then((m) => m.FeatureCreateComponent),
  },
];
```

#### Step 2: Configure Parent Route

```typescript
// parent.routes.ts
{
  path: 'feature',
  loadChildren: () => import('./feature/feature.routes')
    .then(m => m.FEATURE_ROUTES),
  data: {
    preload: true,           // Enable preloading
    preloadDelay: 1500       // Delay in milliseconds
  }
}
```

### 3. Preloading Priority Guidelines

| Priority     | Delay       | Use Case                             |
| ------------ | ----------- | ------------------------------------ |
| **Critical** | 0-500ms     | Core user flows, high-traffic routes |
| **High**     | 500-1000ms  | Frequently accessed features         |
| **Medium**   | 1000-2000ms | Moderately used features             |
| **Low**      | 2000-5000ms | Occasionally accessed features       |
| **None**     | No preload  | Admin features, edge cases           |

### 4. Measuring Impact

#### Bundle Analysis

```bash
# Generate bundle stats
ng build --stats-json

# Analyze with webpack-bundle-analyzer
npx webpack-bundle-analyzer dist/lfx-one/stats.json
```

#### Performance Monitoring

```typescript
// Track route load times
router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
  console.log(`Route loaded: ${event.url} in ${Date.now() - startTime}ms`);
});
```

---

## Monitoring & Optimization

### Optimization Opportunities

1. **Fine-tune Preload Delays**
   - Monitor user navigation patterns
   - Adjust delays based on real usage data

2. **Component-Level Optimization**
   - Split large components further
   - Implement lazy loading for heavy UI components

3. **Network-Specific Strategies**
   - Add more granular connection type handling
   - Implement save-data API support

---

## Best Practices

### 1. Route Organization

✅ **Do:**

- Group related routes in feature modules
- Use descriptive route file names (`meetings.routes.ts`)
- Keep route hierarchies shallow (max 3 levels)

❌ **Don't:**

- Mix lazy and eager routes unnecessarily
- Create overly deep route nesting
- Load entire feature modules for single components

### 2. Preloading Configuration

✅ **Do:**

- Base preload delays on actual user behavior
- Consider network conditions in strategy
- Test on various connection speeds

❌ **Don't:**

- Preload everything (defeats the purpose)
- Use uniform delays for all routes
- Ignore slow connection scenarios

### 3. Bundle Optimization

✅ **Do:**

- Regularly analyze bundle sizes
- Remove unused dependencies
- Split large third-party libraries

❌ **Don't:**

- Import entire libraries for single functions
- Keep dead code in production bundles
- Ignore webpack warnings about large chunks

### 4. Testing Strategy

✅ **Do:**

- Test on various network speeds
- Validate preload behavior in DevTools
- Monitor Core Web Vitals

❌ **Don't:**

- Test only on fast connections
- Skip bundle size analysis
- Ignore performance regressions

---

## Troubleshooting

### Common Issues

#### 1. Routes Not Preloading

**Symptoms**: Navigation still slow despite configuration
**Solutions**:

- Check `CustomPreloadingStrategy` is registered
- Verify `preload: true` in route data
- Confirm network conditions allow preloading

#### 2. Excessive Bundle Size

**Symptoms**: Initial load still slow
**Solutions**:

- Analyze bundle with webpack-bundle-analyzer
- Check for circular dependencies
- Verify lazy loading is working correctly

#### 3. Memory Issues

**Symptoms**: Browser performance degradation
**Solutions**:

- Reduce preload aggressiveness
- Implement route cleanup logic
- Monitor memory usage in DevTools

### Debug Commands

```bash
# Bundle analysis
ng build --stats-json
npx webpack-bundle-analyzer dist/lfx-one/stats.json

# Check lazy loading in dev mode
ng serve --verbose

# Performance testing
lighthouse http://localhost:4200 --chrome-flags="--headless"
```
