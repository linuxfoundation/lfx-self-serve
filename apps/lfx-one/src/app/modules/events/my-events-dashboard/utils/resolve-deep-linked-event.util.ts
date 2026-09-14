// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MyEvent, MyEventsResponse } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of } from 'rxjs';

/**
 * Resolves a deep-linked `?event=<id>` against a request-type-scoped `getMyEvents` fetch.
 * Matches by id rather than trusting the response's ordering, and normalizes a failed fetch
 * into an `'error'` sentinel so callers don't need their own `catchError`.
 */
export function resolveDeepLinkedEvent$(fetch$: Observable<MyEventsResponse>, eventId: string, label: string): Observable<MyEvent | null | 'error'> {
  return fetch$.pipe(
    map((response) => response.data.find((event) => event.id === eventId) ?? null),
    catchError((error) => {
      console.error(`Failed to resolve deep-linked ${label} event:`, error);
      return of('error' as const);
    })
  );
}
