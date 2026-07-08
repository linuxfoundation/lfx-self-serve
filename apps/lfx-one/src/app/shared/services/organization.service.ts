// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CdpOrganization, OrganizationSuggestion, OrganizationSuggestionsResponse } from '@lfx-one/shared';
import { matchesOrgQuery, mergeOrgSuggestions, normalizeOrgKey } from '@lfx-one/shared/utils';
import { catchError, map, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OrganizationService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/organizations';

  /**
   * Organizations the user has created or selected during this browser session.
   * The upstream typeahead is served from a third-party company database that
   * never contains user-invented orgs, so without this a freshly created org
   * (e.g. an inline "create" in the meetings guest flow) would vanish from
   * search and force re-creation for every subsequent guest. Root-provided, so
   * the list persists across every modal and form for the whole session.
   */
  private readonly sessionOrgs: OrganizationSuggestion[] = [];

  /** Cap the session list so a long editing session can't grow it without bound. Most-recent-first, so older entries drop off. */
  private readonly maxSessionOrgs = 25;

  /**
   * Search for organizations by name
   * @param searchTerm - The search term to look for
   * @returns Observable of organization suggestions
   */
  public searchOrganizations(searchTerm: string): Observable<OrganizationSuggestion[]> {
    if (!searchTerm || searchTerm.length < 2) {
      return of([]);
    }

    const trimmed = searchTerm.trim();
    const localMatches = this.sessionOrgs.filter((org) => matchesOrgQuery(org, trimmed));

    return this.http
      .get<OrganizationSuggestionsResponse>(`${this.baseUrl}/search`, {
        params: { query: trimmed },
      })
      .pipe(
        map((response) => mergeOrgSuggestions(localMatches, response.suggestions || [])),
        // Even if the upstream call fails, surface the session's remembered orgs
        // so a just-created org stays selectable. Run them through the same merge
        // so the collapse/dedupe applies on the error path too.
        catchError((error) => {
          console.error('Error searching organizations:', error);
          return of(mergeOrgSuggestions(localMatches, []));
        })
      );
  }

  /**
   * Remember an organization the user created or selected so it stays selectable
   * for the rest of the session. Deduped by domain (or name, for free-text orgs)
   * and kept most-recent-first. No-op for blank names.
   */
  public registerSessionOrg(org: OrganizationSuggestion): void {
    if (!org.name?.trim()) {
      return;
    }

    const key = normalizeOrgKey(org);
    const existingIndex = this.sessionOrgs.findIndex((existing) => normalizeOrgKey(existing) === key);
    if (existingIndex !== -1) {
      this.sessionOrgs.splice(existingIndex, 1);
    }
    this.sessionOrgs.unshift(org);
    if (this.sessionOrgs.length > this.maxSessionOrgs) {
      this.sessionOrgs.length = this.maxSessionOrgs;
    }
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
}
