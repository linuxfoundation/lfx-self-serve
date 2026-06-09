// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  GenerateWeeklyBriefRequest,
  GenerateWeeklyBriefResponse,
  SaveWeeklyBriefRequest,
  WeeklyBrief,
  WeeklyBriefCurrentResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class WeeklyBriefService {
  private readonly http = inject(HttpClient);

  public getWeeklyBrief(committeeId: string): Observable<WeeklyBriefCurrentResponse> {
    return this.http.get<WeeklyBriefCurrentResponse>(`/api/committees/${committeeId}/weekly-briefs/current`).pipe(
      catchError((error: unknown) => {
        // Log before falling back so failures are visible in DataDog RUM and dev console,
        // rather than silently degrading to the empty state.
        console.error('weekly-brief: getWeeklyBrief failed, returning empty state', { committeeId, error });
        return of({
          brief: null,
          throttle: {
            generates_used: 0,
            generates_limit: 2,
            regenerations_used: 0,
            regenerations_limit: 3,
            window_resets_at: '',
          },
        } as WeeklyBriefCurrentResponse);
      })
    );
  }

  public generateWeeklyBrief(committeeId: string, body: GenerateWeeklyBriefRequest = {}): Observable<GenerateWeeklyBriefResponse> {
    return this.http.post<GenerateWeeklyBriefResponse>(`/api/committees/${committeeId}/weekly-briefs/generate`, body);
    // No catchError — caller handles 429/error states
  }

  public saveWeeklyBrief(committeeId: string, body: SaveWeeklyBriefRequest): Observable<WeeklyBrief> {
    return this.http.put<WeeklyBrief>(`/api/committees/${committeeId}/weekly-briefs/current`, body);
    // No catchError — caller handles 409 conflicts
  }
}
