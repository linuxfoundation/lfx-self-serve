---
description: SSR safety rules — isPlatformBrowser guard, browser-only API handling, lazy-loading third-party libs
paths:
  - '**/*.component.ts'
  - '**/*.service.ts'
  - '**/*.directive.ts'
  - '**/server/**'
---

# SSR Safety

Angular 20 SSR is strict. Static HTML prototypes and dev-mode hot reload hide SSR-only failures — they only surface during `yarn build` or production runtime.

## Never reference browser-only APIs outside an isPlatformBrowser guard

`window`, `document`, `localStorage`, `navigator`, `IntersectionObserver`, `ResizeObserver`, `MutationObserver`, and similar browser globals must be gated:

```typescript
import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

private readonly platformId = inject(PLATFORM_ID);

ngOnInit() {
  if (isPlatformBrowser(this.platformId)) {
    // browser-only code here
  }
}
```

## Third-party libraries that touch the browser

Libraries that reference `window` at import time (charting libs, drag-and-drop libs, some UI kits) must be loaded lazily _inside_ the guard:

```typescript
ngOnInit() {
  if (isPlatformBrowser(this.platformId)) {
    import('some-browser-only-lib').then(({ default: lib }) => {
      // use lib here
    });
  }
}
```

A static top-level `import` of such a library will crash SSR even if the code path that uses it is browser-only.

## Catching failures

`yarn build` exercises the SSR bundle and is the fastest local way to catch SSR violations. `yarn start` (dev server) does not.
