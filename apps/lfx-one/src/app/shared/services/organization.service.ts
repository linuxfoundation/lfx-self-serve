// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CdpOrganization, OrganizationSuggestion, OrganizationSuggestionsResponse } from '@lfx-one/shared';
import { catchError, map, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OrganizationService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/organizations';

  /**
   * Search for organizations by name
   * @param searchTerm - The search term to look for
   * @returns Observable of organization suggestions
   */
  public searchOrganizations(searchTerm: string): Observable<OrganizationSuggestion[]> {
    if (!searchTerm || searchTerm.length < 2) {
      return of([]);
    }

    return this.http
      .get<OrganizationSuggestionsResponse>(`${this.baseUrl}/search`, {
        params: { query: searchTerm.trim() },
      })
      .pipe(
        map((response) => response.suggestions || []),
        catchError((error) => {
          console.error('Error searching organizations:', error);
          return of([]);
        })
      );
  }

  /**
   * Resolve (find or create) an organization in CDP
   * @param name - Organization name
   * @param domain - Organization domain
   * @returns Observable of the resolved CDP organization
   */
  public resolveOrganization(name: string, domain: string): Observable<CdpOrganization> {
    return this.http.post<CdpOrganization>(`${this.baseUrl}/resolve`, { name, domain });
  }
}
