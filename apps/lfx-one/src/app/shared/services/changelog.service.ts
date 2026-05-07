// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ChangelogViewMarkViewedResponse, ChangelogViewUnseenResponse } from '@lfx-one/shared/interfaces';
import { catchError, EMPTY, map, merge, of, Subject, switchMap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ChangelogService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/changelog';

  private readonly loadTrigger$ = new Subject<void>();
  private readonly markViewedTrigger$ = new Subject<void>();

  // Errors swallowed so the badge keeps its last known value (best-effort UX hint).
  public readonly unseenChangelogCount: Signal<number> = toSignal(
    merge(
      this.loadTrigger$.pipe(
        switchMap(() =>
          this.http.get<ChangelogViewUnseenResponse>(`${this.baseUrl}/unseen`).pipe(
            map((res) => res.data.unseenCount),
            catchError(() => EMPTY)
          )
        )
      ),
      this.markViewedTrigger$.pipe(
        // Optimistic 0 first, then the POST in the background.
        switchMap(() =>
          merge(
            of(0),
            this.http.post<ChangelogViewMarkViewedResponse>(`${this.baseUrl}/mark-viewed`, {}).pipe(
              map(() => 0),
              catchError(() => EMPTY)
            )
          )
        )
      )
    ),
    { initialValue: 0 }
  );

  public loadUnseenCount(): void {
    this.loadTrigger$.next();
  }

  public markViewed(): void {
    this.markViewedTrigger$.next();
  }
}
