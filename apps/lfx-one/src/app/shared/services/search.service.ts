// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CommitteeOrganizationReference, UserSearchResponse, UserSearchResult, UserSearchType } from '@lfx-one/shared/interfaces';
import { dedupeUserSearchResults, isEmailShape } from '@lfx-one/shared/utils';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class SearchService {
  private readonly http = inject(HttpClient);

  /**
   * Search for users (meeting registrants or committee members) by name or email.
   *
   * The query service's `name` is a leading-prefix typeahead over each record's aliases (name and
   * username — not the email, for committee members), and `tags=email:<address>` is an exact,
   * case-sensitive match on the stored address. So:
   * - no `@`: a plain name search;
   * - a complete address: the exact tag lookup, also tried lowercased when the typed case differs,
   *   because the index stores the tag verbatim;
   * - a partial address (`kim.park@part`): the local part searched as a name — the username alias
   *   is prefix-searchable, and a person's local part is usually their username — keeping only
   *   rows whose email starts with what was typed. True partial-email matching needs the
   *   committee service to alias the email upstream (#2772 follow-up).
   */
  public searchUsers(name: string, type: UserSearchType): Observable<UserSearchResult[]> {
    const term = (name ?? '').trim();
    if (!term || !type) {
      return of([]);
    }

    if (!term.includes('@')) {
      return this.fetchUsers(type, { name: term });
    }

    if (isEmailShape(term)) {
      const addresses = [...new Set([term, term.toLowerCase()])];
      return forkJoin(addresses.map((address) => this.fetchUsers(type, { tags: `email:${address}` }))).pipe(
        map((results) => dedupeUserSearchResults(results.flat()))
      );
    }

    const localPart = term.slice(0, term.indexOf('@'));
    if (!localPart) {
      return of([]);
    }
    const typed = term.toLowerCase();
    return this.fetchUsers(type, { name: localPart }).pipe(map((users) => users.filter((user) => (user.email ?? '').toLowerCase().startsWith(typed))));
  }

  /** Fetch the current employer for any user by LFID — used to pre-fill org fields. Fails silently. */
  public getUserCurrentEmployer(lfid: string): Observable<CommitteeOrganizationReference | null> {
    return this.http
      .get<CommitteeOrganizationReference | null>(`/api/search/users/${encodeURIComponent(lfid)}/work-experiences`)
      .pipe(catchError(() => of(null)));
  }

  /** One `GET /api/search/users` call; a failed lookup degrades to no results rather than breaking the typeahead. */
  private fetchUsers(type: UserSearchType, query: { name: string } | { tags: string }): Observable<UserSearchResult[]> {
    let params = new HttpParams().set('type', type);
    params = 'name' in query ? params.set('name', query.name) : params.set('tags', query.tags);

    return this.http.get<UserSearchResponse>('/api/search/users', { params }).pipe(
      map((response) => response.results || []),
      catchError((error) => {
        console.error('Error searching users:', error);
        return of([]);
      })
    );
  }
}
