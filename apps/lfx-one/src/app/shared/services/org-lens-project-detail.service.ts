// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  OrgLensCardDetailSection,
  OrgLensCardRosterPage,
  OrgLensHeroBlock,
  OrgLensInfluenceBlock,
  OrgLensLeaderboardBlock,
  OrgLensLeaderboardTimeRange,
  OrgLensTrendBlock,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, throwError } from 'rxjs';

// Client proxy exposing the Project Detail page as independently-fetched blocks, each on its own per-block BFF endpoint (own request, failure boundary, and retry); only the hero 404 gates the page.
@Injectable({
  providedIn: 'root',
})
export class OrgLensProjectDetailService {
  private readonly http = inject(HttpClient);

  // Hero is range-independent (§B1) — cache the first resolved hero block per (org, slug) so a
  // range change never re-resolves it.
  private readonly heroCache = new Map<string, OrgLensHeroBlock | null>();
  private static readonly maxHeroEntries = 8;

  /** B1 — Hero block; fetched once per (org, slug), never re-fetched on a range change. A null result is the page-level not-found. */
  public getHero(orgUid: string, orgName: string, projectSlug: string): Observable<OrgLensHeroBlock | null> {
    const cacheKey = `${orgUid}|${projectSlug}`;
    const cached = this.heroCache.get(cacheKey);
    if (cached !== undefined) {
      return of(cached);
    }
    return this.blockGet<OrgLensHeroBlock>(`${this.baseUrl(orgUid, projectSlug)}/hero`, { orgName }).pipe(
      map((block) => {
        if (this.heroCache.size >= OrgLensProjectDetailService.maxHeroEntries) {
          this.heroCache.clear();
        }
        this.heroCache.set(cacheKey, block);
        return block;
      })
    );
  }

  /** B3/B4 — Technical + Ecosystem cards, with the viewing org's own tiers carried inline for the band chips. */
  public getInfluenceBlock(orgUid: string, orgName: string, projectSlug: string, range: OrgLensLeaderboardTimeRange): Observable<OrgLensInfluenceBlock | null> {
    return this.blockGet<OrgLensInfluenceBlock>(`${this.baseUrl(orgUid, projectSlug)}/influence`, { orgName, range });
  }

  /** B6 — Influence Trend series. */
  public getTrendBlock(orgUid: string, orgName: string, projectSlug: string): Observable<OrgLensTrendBlock | null> {
    return this.blockGet<OrgLensTrendBlock>(`${this.baseUrl(orgUid, projectSlug)}/trend`, { orgName });
  }

  /** B7 — Technical leaderboard board (influence rows + contribution activity rows). */
  public getTechnicalBoard(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange
  ): Observable<OrgLensLeaderboardBlock | null> {
    return this.blockGet<OrgLensLeaderboardBlock>(`${this.baseUrl(orgUid, projectSlug)}/leaderboard/technical`, { orgName, range });
  }

  /** B8 — Ecosystem leaderboard board (influence rows + collaboration activity rows). */
  public getEcosystemBoard(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange
  ): Observable<OrgLensLeaderboardBlock | null> {
    return this.blockGet<OrgLensLeaderboardBlock>(`${this.baseUrl(orgUid, projectSlug)}/leaderboard/ecosystem`, { orgName, range });
  }

  /** B5 — Card detail drawer definition (+ column headers) for one card; the roster rows come from getCardRoster. */
  public getCardDrawer(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    cardKey: string,
    range: OrgLensLeaderboardTimeRange
  ): Observable<OrgLensCardDetailSection | null> {
    return this.blockGet<OrgLensCardDetailSection>(`${this.baseUrl(orgUid, projectSlug)}/cards/${encodeURIComponent(cardKey)}`, { orgName, range });
  }

  /** B5 — One server-paginated page of a card drawer's roster rows; fetched lazily on open / page change. */
  public getCardRoster(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    cardKey: string,
    range: OrgLensLeaderboardTimeRange,
    page: number,
    pageSize: number
  ): Observable<OrgLensCardRosterPage> {
    const url = `${this.baseUrl(orgUid, projectSlug)}/cards/${encodeURIComponent(cardKey)}/roster`;
    return this.http
      .get<OrgLensCardRosterPage>(url, { params: { orgName, range, page: String(page), pageSize: String(pageSize) } })
      .pipe(catchError((err: HttpErrorResponse) => (err.status === 404 ? of({ rows: [], total: 0 }) : throwError(() => err))));
  }

  private baseUrl(orgUid: string, projectSlug: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/projects/${encodeURIComponent(projectSlug)}`;
  }

  private blockGet<T>(url: string, params: Record<string, string>): Observable<T | null> {
    return this.http.get<T>(url, { params }).pipe(catchError((err: HttpErrorResponse) => (err.status === 404 ? of(null) : throwError(() => err))));
  }
}
