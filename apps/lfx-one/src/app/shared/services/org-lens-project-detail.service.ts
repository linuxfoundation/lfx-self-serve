// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { PD_DEFAULT_TIME_RANGE } from '@lfx-one/shared/constants';
import type {
  OrgLensCardDetailSection,
  OrgLensCardRosterPage,
  OrgLensHeroBlock,
  OrgLensInfluenceBlock,
  OrgLensLeaderboardBlock,
  OrgLensLeaderboardTimeRange,
  OrgLensProjectDetailResponse,
  OrgLensProjectLeaderboardRow,
  OrgLensTrendBlock,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, shareReplay, throwError } from 'rxjs';

/**
 * Client-side proxy for the Org Lens · Project Detail sub-page (LFXV2-1885), exposing the page as
 * the eight independently-fetched data blocks from the UX contract (hero, influence cards, trend,
 * the two leaderboard boards, and the per-card drawer). Each block is fetched and rendered on its
 * own timeline so a slow or failed block never blocks the rest of the page.
 *
 * Interim transport (frontend-first stage): every block method resolves off a single shared BFF
 * call to GET /api/orgs/:orgUid/lens/projects/:projectSlug?range=, deduplicated per
 * (org, name, slug, range) so the block decomposition does not multiply network requests. The
 * follow-up pass repoints each block method at its own per-block endpoint with no change to the
 * component that consumes this service.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensProjectDetailService {
  private readonly http = inject(HttpClient);

  // One in-flight/replayed request per (org, name, slug, range). Bounded to a few recent keys so
  // the shared cache never grows across a long browsing session.
  private readonly shared = new Map<string, Observable<OrgLensProjectDetailResponse | null>>();
  private static readonly maxSharedEntries = 8;

  // Hero is range-independent (§B1) — cache the first resolved hero block per (org, slug) so a
  // range change never re-resolves it.
  private readonly heroCache = new Map<string, OrgLensHeroBlock | null>();

  /** B1 — Hero block; fetched once per (org, slug), never re-fetched on a range change. A null result is the page-level not-found. */
  public getHero(orgUid: string, orgName: string, projectSlug: string): Observable<OrgLensHeroBlock | null> {
    const cacheKey = `${orgUid}|${projectSlug}`;
    const cached = this.heroCache.get(cacheKey);
    if (cached !== undefined) {
      return of(cached);
    }
    return this.sharedRequest(orgUid, orgName, projectSlug, PD_DEFAULT_TIME_RANGE).pipe(
      map((resp) => {
        const block = resp ? { hero: resp.hero, isNonLfProject: resp.isNonLfProject } : null;
        this.heroCache.set(cacheKey, block);
        return block;
      })
    );
  }

  /** B3/B4 — Technical + Ecosystem cards, with the viewing org's own tiers carried inline for the band chips. */
  public getInfluenceBlock(orgUid: string, orgName: string, projectSlug: string, range: OrgLensLeaderboardTimeRange): Observable<OrgLensInfluenceBlock | null> {
    return this.sharedRequest(orgUid, orgName, projectSlug, range).pipe(
      map((resp) => {
        if (!resp) return null;
        const viewing = resp.leaderboard.find((row) => row.isViewingOrg) ?? null;
        return {
          technical: resp.technical,
          ecosystem: resp.ecosystem,
          isNonLfProject: resp.isNonLfProject,
          levels: {
            technical: viewing?.levels.technical ?? null,
            ecosystem: resp.isNonLfProject ? null : (viewing?.levels.ecosystem ?? null),
          },
        };
      })
    );
  }

  /** B6 — Influence Trend series. */
  public getTrendBlock(orgUid: string, orgName: string, projectSlug: string, range: OrgLensLeaderboardTimeRange): Observable<OrgLensTrendBlock | null> {
    return this.sharedRequest(orgUid, orgName, projectSlug, range).pipe(map((resp) => (resp ? { trend: resp.trend } : null)));
  }

  /** B7 — Technical leaderboard board (influence rows + contribution activity rows). */
  public getTechnicalBoard(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange
  ): Observable<OrgLensLeaderboardBlock | null> {
    return this.boardBlock(orgUid, orgName, projectSlug, range, (resp) => resp.activityLeaderboards.contributions);
  }

  /** B8 — Ecosystem leaderboard board (influence rows + collaboration activity rows). */
  public getEcosystemBoard(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange
  ): Observable<OrgLensLeaderboardBlock | null> {
    return this.boardBlock(orgUid, orgName, projectSlug, range, (resp) => resp.activityLeaderboards.collaborations);
  }

  /** B5 — Card detail drawer definition (+ column headers) for one card; the roster rows come from getCardRoster. */
  public getCardDrawer(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    cardKey: string,
    range: OrgLensLeaderboardTimeRange
  ): Observable<OrgLensCardDetailSection | null> {
    return this.sharedRequest(orgUid, orgName, projectSlug, range).pipe(map((resp) => resp?.cardDetails?.[cardKey] ?? null));
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
    const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/projects/${encodeURIComponent(projectSlug)}/cards/${encodeURIComponent(cardKey)}/roster`;
    return this.http
      .get<OrgLensCardRosterPage>(url, { params: { orgName, range, page: String(page), pageSize: String(pageSize) } })
      .pipe(catchError((err: HttpErrorResponse) => (err.status === 404 ? of({ rows: [], total: 0 }) : throwError(() => err))));
  }

  private boardBlock(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange,
    pickActivity: (resp: OrgLensProjectDetailResponse) => OrgLensProjectLeaderboardRow[]
  ): Observable<OrgLensLeaderboardBlock | null> {
    return this.sharedRequest(orgUid, orgName, projectSlug, range).pipe(
      map((resp) => (resp ? { influence: resp.leaderboard, activity: pickActivity(resp), isNonLfProject: resp.isNonLfProject } : null))
    );
  }

  private sharedRequest(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange
  ): Observable<OrgLensProjectDetailResponse | null> {
    const key = `${orgUid}|${orgName}|${projectSlug}|${range}`;
    let request = this.shared.get(key);
    if (!request) {
      if (this.shared.size >= OrgLensProjectDetailService.maxSharedEntries) {
        this.shared.clear();
      }
      const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/projects/${encodeURIComponent(projectSlug)}`;
      request = this.http.get<OrgLensProjectDetailResponse>(url, { params: { orgName, range } }).pipe(
        catchError((err: HttpErrorResponse) => (err.status === 404 ? of(null) : throwError(() => err))),
        shareReplay({ bufferSize: 1, refCount: false })
      );
      this.shared.set(key, request);
    }
    return request;
  }
}
