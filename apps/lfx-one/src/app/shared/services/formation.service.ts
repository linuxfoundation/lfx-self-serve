// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Formation, FormationIntake } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take } from 'rxjs';

/** Client for the fixture-backed "Propose a project" formation endpoints (GH-1962). See
 *  `formation.service.ts` (server) for the fixture convention — #1957 isn't built yet. */
@Injectable({
  providedIn: 'root',
})
export class FormationService {
  private readonly http = inject(HttpClient);

  public createFormation(intake: FormationIntake): Observable<Formation> {
    return this.http.post<Formation>('/api/formations', intake).pipe(take(1));
  }

  public getFormationByUid(uid: string): Observable<Formation | null> {
    return this.http.get<Formation>(`/api/formations/${encodeURIComponent(uid)}`).pipe(
      take(1),
      catchError((error) => {
        // A 404 here is an expected outcome (unknown uid, wrong pod, or not the proposer — see
        // formation.service.ts server-side), not an error worth logging; anything else (network
        // failure, 5xx) is, so the confirmation page's not-found state doesn't silently hide it.
        if (error?.status !== 404) {
          console.error('Failed to fetch formation:', error);
        }
        return of(null);
      })
    );
  }
}
