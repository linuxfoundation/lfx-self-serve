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
import { Observable, take } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class WeeklyBriefService {
  private readonly http = inject(HttpClient);

  public getWeeklyBrief(committeeId: string): Observable<WeeklyBriefCurrentResponse> {
    return this.http.get<WeeklyBriefCurrentResponse>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`);
    // No catchError — a failed read must reach the caller so it can be classified as a
    // real error, distinct from the server's own 200-with-null-brief "no brief yet" state.
    // A blanket fallback here would render a misconfigured deploy or a 404 identically to
    // "no brief yet, 2 generates available" — see LFXV2-2175 full-branch review.
  }

  public generateWeeklyBrief(committeeId: string, body: GenerateWeeklyBriefRequest = {}): Observable<GenerateWeeklyBriefResponse> {
    return this.http.post<GenerateWeeklyBriefResponse>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/generate`, body).pipe(take(1));
    // No catchError — caller handles 429/error states
  }

  public saveWeeklyBrief(committeeId: string, body: SaveWeeklyBriefRequest): Observable<WeeklyBrief> {
    return this.http.put<WeeklyBrief>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`, body).pipe(take(1));
    // No catchError — caller handles 409 conflicts
  }
}
