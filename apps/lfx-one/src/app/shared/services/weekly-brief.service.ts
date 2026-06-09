// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { WEEKLY_BRIEF_DEFAULT_THROTTLE } from '@lfx-one/shared/constants';
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
      catchError((err) => {
        console.warn('[WeeklyBriefService] getWeeklyBrief failed; falling back to empty envelope', err);
        return of({
          brief: null,
          throttle: { ...WEEKLY_BRIEF_DEFAULT_THROTTLE, window_resets_at: '' },
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
