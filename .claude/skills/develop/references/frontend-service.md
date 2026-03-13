# Frontend Service Reference

## Location

`apps/lfx-one/src/app/shared/services/<name>.service.ts`

> **Prerequisite:** The backend endpoint must already exist (validated in Step 3, built earlier if needed). Do not create a frontend service that calls an API endpoint that doesn't exist — no mock data, no placeholder URLs.

## Conventions

- `@Injectable({ providedIn: 'root' })` — always tree-shakeable
- `inject(HttpClient)` — never constructor-based DI
- **GET requests:** `catchError(() => of(defaultValue))` for graceful error handling
- **POST/PUT/DELETE requests:** `take(1)` and let errors propagate to the component
- **Shared state:** Use `signal()` for data consumed by multiple components
- **Signals can't use rxjs pipes** — use `computed()` or `toSignal()` for reactive transforms
- **Interfaces:** Import from `@lfx-one/shared/interfaces`, never define locally
- **API paths:** Use relative paths (e.g., `/api/items`) — the proxy handles routing

## Example Pattern

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, of, take } from 'rxjs';
import { MyItem } from '@lfx-one/shared/interfaces';

@Injectable({ providedIn: 'root' })
export class MyService {
  private readonly http = inject(HttpClient);

  // Shared state
  public items = signal<MyItem[]>([]);

  public getItems() {
    return this.http.get<MyItem[]>('/api/items').pipe(catchError(() => of([] as MyItem[])));
  }

  public createItem(payload: Partial<MyItem>) {
    return this.http.post<MyItem>('/api/items', payload).pipe(take(1));
  }
}
```

## Checklist

- [ ] Uses `@Injectable({ providedIn: 'root' })`
- [ ] Uses `inject(HttpClient)` (not constructor DI)
- [ ] GET requests have `catchError` with sensible default
- [ ] POST/PUT/DELETE use `take(1)`
- [ ] Interfaces imported from `@lfx-one/shared/interfaces`
- [ ] API paths are relative (`/api/...`)
- [ ] No mock data or placeholder URLs
- [ ] File has license header
