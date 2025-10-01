// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { UserSearchResponse, UserSearchResult } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class SearchService {
  private readonly http = inject(HttpClient);

  /**
   * Search for users (meeting registrants or committee members)
   */
  public searchUsers(name: string, type: 'committee_member' | 'meeting_registrant'): Observable<UserSearchResult[]> {
    if (!name || !type) {
      return of([]);
    }

    let params = new HttpParams().set('type', type).set('limit', '20');

    // if name is an email, search for users by email
    if (name.includes('@')) {
      params = params.set('tags', `email:${name}`);
    } else {
      params = params.set('name', name);
    }

    return this.http.get<UserSearchResponse>('/api/search/users', { params }).pipe(
      map((response) => response.results || []),
      catchError((error) => {
        console.error('Error searching users:', error);
        return of([]);
      })
    );
  }
}
