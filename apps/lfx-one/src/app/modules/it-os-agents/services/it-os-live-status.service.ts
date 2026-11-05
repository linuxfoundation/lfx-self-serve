// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ItOsGuildStatusResponse } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of } from 'rxjs';

/** Which IT OS agents can be reached live here (#4257). Empty outside dev, or if the check fails. */
@Injectable({ providedIn: 'root' })
export class ItOsLiveStatusService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly agents: Signal<string[]> = toSignal(this.load(), { initialValue: [] });

  private load(): Observable<string[]> {
    // Asked from the browser only: the answer depends on the signed-in session, not on the server render.
    if (!isPlatformBrowser(this.platformId)) return of([]);
    return this.http.get<ItOsGuildStatusResponse>('/api/it-os-agents/status').pipe(
      map((response) => response.agents ?? []),
      catchError(() => of([]))
    );
  }
}
