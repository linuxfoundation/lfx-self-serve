---
type: Decision
title: Angular 20 Zoneless SSR
description: Adoption of stable zoneless change detection and Angular Universal SSR for performance and future compatibility.
resource: docs/architecture/frontend/angular-patterns.md
tags: [architecture, frontend, performance]
---

## Context and Rationale

The application uses **Angular 20 with stable zoneless change detection** paired with **Angular Universal Server-Side Rendering (SSR)**. This decision was made to optimize performance, reduce bundle size, and prepare the codebase for Angular's long-term direction.

### Zoneless Change Detection Rationale

**Zone.js** is Angular's traditional change detection mechanism that zones async operations (timers, events, HTTP calls) to trigger automatic view updates. It adds complexity and overhead. **Zoneless change detection** replaces this with signal-based, fine-grained reactivity.

**Why adopted:**

- **No Zone.js dependency** — eliminates ~20 KB from the bundle
- **Better startup performance** — faster initialization and smaller memory footprint
- **Explicit reactivity** — change detection is tied directly to signal updates, not global zones
- **Signal-first** — encourages use of Angular Signals for state management
- **Future-ready** — Angular 19+ deprecates zone-based change detection; this prepares the codebase

**Configuration:**

```typescript
// apps/lfx-one/src/app/app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(), // Stable API in Angular 20
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
    provideAnimationsAsync(),
    // ... other providers
  ],
};
```

### SSR (Angular Universal) Rationale

**Server-Side Rendering** pre-renders the Angular application on the server before sending HTML to the browser.

**Why adopted:**

- **Improved SEO** — search engines receive pre-rendered content, not empty `<app-root />`
- **Faster initial load** — content is visible before JavaScript evaluates
- **Better UX** — reduced time to first contentful paint (FCP) and time to interactive (TTI)
- **Progressive enhancement** — the page is usable without JavaScript (critical for older browsers or slow networks)

**Configuration:**

```typescript
// apps/lfx-one/src/app/app.config.server.ts
export const config = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
});

// apps/lfx-one/src/app/app.routes.server.ts
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server, // All routes rendered server-side
  },
];
```

The Express server (`apps/lfx-one/src/server/server.ts`) handles SSR and forwards requests to the Angular app engine.

## Trade-offs

### Zoneless Benefits vs. Complexity

**Benefit:** Bundle size reduction and better performance.

**Trade-off:** Requires careful use of Angular Signals and explicit change detection. Some third-party libraries expecting Zone.js may need workarounds. Testing adjustments may be required for components relying on automatic change detection (though this is rare in Angular 20+).

**Mitigation:** Use Angular Signals as the default for state management. For third-party integrations, explicit change detection or signal wrapping can bridge the gap. The team actively uses zoneless on all new code; Zone.js is no longer a fallback.

### SSR Benefits vs. Server Overhead

**Benefit:** SEO and initial load performance.

**Trade-off:** Every request requires server-side rendering, which consumes CPU and memory. The server must stay in sync with the Angular app API as both evolve.

**Mitigation:** The Express server is co-located with the Angular app in the same Turborepo package (`apps/lfx-one`). Changes to components are immediately visible in server rendering. Build caching and CDN (in production) reduce the impact of server-side rendering cost. Angular's hydration API (`provideClientHydration`) ensures the browser efficiently reuses the server-rendered DOM, avoiding duplicate work.

### Browser API Constraints

**Trade-off:** Because the application renders on the server (Node.js environment), browser-only APIs (e.g., `localStorage`, `window`, `document`) are not available during SSR.

**Mitigation:** Use the `isPlatformBrowser` guard to conditionally execute browser-only code:

```typescript
import { isPlatformBrowser } from '@angular/common';

export class MyComponent {
  private readonly platform = inject(PLATFORM_ID);

  ngOnInit() {
    if (isPlatformBrowser(this.platform)) {
      // Safe to use window, localStorage, etc.
      localStorage.setItem('key', 'value');
    }
  }
}
```

This pattern is enforced in the codebase and checked by the Self Serve code reviewer.

## Key Implications for Development

1. **Always use Angular Signals** for reactive state instead of RxJS for simple data
2. **Use `isPlatformBrowser`** guards for any browser-only API access
3. **Test SSR explicitly** — some template bugs only surface in SSR; E2E tests cover both client and server rendering
4. **Keep server routes and client routes in sync** — SSR routes live in `app.routes.server.ts`; changes to client routing must be reflected on the server

## Related Concepts

- [Monorepo Turborepo](../decisions/monorepo-turborepo.md) — monorepo structure housing both Angular app and Express server
- [PrimeNG Wrapper Pattern](../decisions/primeng-wrapper-pattern.md) — component architecture for SSR compatibility

## Citations

- **Source:** `docs/architecture/frontend/angular-patterns.md`, Zoneless Change Detection section
- **Source:** `docs/architecture/frontend/angular-patterns.md`, Server-Side Rendering section
- **Source:** `docs/architecture/frontend/angular-patterns.md`, Implications for Development subsection
