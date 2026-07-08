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
  public resolveOrganization(name: string, domain: string, logo?: string): Observable<CdpOrganization> {
    // Drop empty-string logos — they're not meaningful URLs
    return this.http.post<CdpOrganization>(`${this.baseUrl}/resolve`, { name, domain, ...(logo ? { logo } : {}) });
  }

  /**
   * Look up a single organization in CDP by exact name.
   * Used to resolve an organization's canonical domain. Emits the organization, or `null` when
   * CDP confirms no match (the backend responds 200 with a null body on a CDP 404). HTTP/transport
   * errors are intentionally NOT swallowed — they propagate so callers can distinguish a confirmed
   * "no match" (safe to treat as no domain) from a failed lookup (must not be treated as a result).
   * @param name - Exact organization name
   * @returns Observable of the CDP organization, or null when there is no match
   */
  public lookupOrganizationByName(name: string): Observable<CdpOrganization | null> {
    const trimmed = name?.trim();
    if (!trimmed) {
      return of(null);
    }

    return this.http.get<CdpOrganization | null>(`${this.baseUrl}/lookup`, { params: { name: trimmed } });
  }
}
