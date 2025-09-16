// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { RecentActivity } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ActivityService {
  private readonly http = inject(HttpClient);

  /**
   * Get recent activity for a specific project
   */
  public getRecentActivitiesByProject(projectUid: string, limit: number = 10): Observable<RecentActivity[]> {
    let params = new HttpParams();

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    return this.http.get<RecentActivity[]>(`/api/projects/${projectUid}/recent-activity`, { params }).pipe(
      catchError((error) => {
        console.error('Failed to load recent activities:', error);
        return of([]);
      })
    );
  }
}
