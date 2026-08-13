// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type {
  SocialListeningAnalyticsOverview,
  SocialListeningAnalyticsRequest,
  SocialListeningAuthorsRequest,
  SocialListeningCountRequest,
  SocialListeningCountResponse,
  SocialListeningFeedRequest,
  SocialListeningFeedResponse,
  SocialListeningMentionAuthor,
  SocialListeningOptionsRequest,
  SocialListeningOverTimePoint,
  SocialListeningPlatform,
  SocialListeningPlatformDistribution,
  SocialListeningScopedOptionsRequest,
  SocialListeningSentimentDistribution,
  SocialListeningSubProject,
  SocialListeningTagCount,
  SocialListeningTopProject,
} from '@lfx-one/shared/interfaces';

/**
 * Angular gateway over the 13 Express endpoints from LFXV2-3015 (`/api/social-listening/*`,
 * ED-gated server-side). Pure-read service by design (LFXV2-3016): no service-side state
 * container — the page owns loading/error/data via declarative `toSignal` pipelines, so errors
 * deliberately propagate instead of being swallowed into fallback values (unlike
 * `analytics.service.ts`, whose per-method `catchError(of(fallback))` would hide failures the
 * page needs to surface).
 *
 * Wire contract (see `server/helpers/social-listening-params.helper.ts`): keys are the camelCase
 * `MentionFilters` field names, array values are comma-joined, and empty/`undefined` values are
 * omitted. `'all'` sentinels never reach this service — callers pass fragments built by
 * `buildMentionFilters()`, which already strips them.
 */
@Injectable({
  providedIn: 'root',
})
export class SocialListeningService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/social-listening';

  /** One window of mentions for a foundation, newest first. */
  public getMentionsFeed(request: SocialListeningFeedRequest): Observable<SocialListeningFeedResponse> {
    return this.http.get<SocialListeningFeedResponse>(`${this.baseUrl}/mentions-feed`, { params: this.toParams(request) });
  }

  /** Total mentions matching the same scope + filters as the feed — backs the paginator. */
  public getMentionsCount(request: SocialListeningCountRequest): Observable<SocialListeningCountResponse> {
    return this.http.get<SocialListeningCountResponse>(`${this.baseUrl}/mentions-count`, { params: this.toParams(request) });
  }

  /** Sub-project options for the scope select (period-independent). */
  public getMentionsProjects(request: SocialListeningOptionsRequest): Observable<SocialListeningSubProject[]> {
    return this.http.get<SocialListeningSubProject[]>(`${this.baseUrl}/mentions-projects`, { params: this.toParams(request) });
  }

  /** Platform options for the scope select (period-independent). */
  public getMentionsPlatforms(request: SocialListeningOptionsRequest): Observable<SocialListeningPlatform[]> {
    return this.http.get<SocialListeningPlatform[]>(`${this.baseUrl}/mentions-platforms`, { params: this.toParams(request) });
  }

  /** Distinct languages within the current scope + window (filter panel, LFXV2-3017). */
  public getMentionsLanguages(request: SocialListeningScopedOptionsRequest): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/mentions-languages`, { params: this.toParams(request) });
  }

  /** Distinct tracked keywords within the current scope + window (filter panel, LFXV2-3017). */
  public getMentionsKeywords(request: SocialListeningScopedOptionsRequest): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/mentions-keywords`, { params: this.toParams(request) });
  }

  /** Tags with mention volume, highest first — serves both the tag filter and the analytics top-tags panel. */
  public getMentionsTags(request: SocialListeningScopedOptionsRequest): Observable<SocialListeningTagCount[]> {
    return this.http.get<SocialListeningTagCount[]>(`${this.baseUrl}/mentions-tags`, { params: this.toParams(request) });
  }

  /** Author options cascading off every other active filter — never filtered by `authors` itself. */
  public getMentionsAuthors(request: SocialListeningAuthorsRequest): Observable<SocialListeningMentionAuthor[]> {
    return this.http.get<SocialListeningMentionAuthor[]>(`${this.baseUrl}/mentions-authors`, { params: this.toParams(request) });
  }

  /** Headline KPIs plus change vs. the preceding equal-length window (analytics tab, LFXV2-3018). */
  public getAnalyticsOverview(request: SocialListeningAnalyticsRequest): Observable<SocialListeningAnalyticsOverview> {
    return this.http.get<SocialListeningAnalyticsOverview>(`${this.baseUrl}/analytics-overview`, { params: this.toParams(request) });
  }

  /** Mentions over time, bucketed per sub-project (analytics tab, LFXV2-3018). */
  public getAnalyticsOverTime(request: SocialListeningAnalyticsRequest): Observable<SocialListeningOverTimePoint[]> {
    return this.http.get<SocialListeningOverTimePoint[]>(`${this.baseUrl}/analytics-over-time`, { params: this.toParams(request) });
  }

  /** Platform share of mentions (analytics tab, LFXV2-3018). */
  public getAnalyticsPlatformDistribution(request: SocialListeningAnalyticsRequest): Observable<SocialListeningPlatformDistribution[]> {
    return this.http.get<SocialListeningPlatformDistribution[]>(`${this.baseUrl}/analytics-platform-distribution`, { params: this.toParams(request) });
  }

  /** Sentiment share of mentions (analytics tab, LFXV2-3018). */
  public getAnalyticsSentimentDistribution(request: SocialListeningAnalyticsRequest): Observable<SocialListeningSentimentDistribution[]> {
    return this.http.get<SocialListeningSentimentDistribution[]>(`${this.baseUrl}/analytics-sentiment-distribution`, { params: this.toParams(request) });
  }

  /** Top sub-projects by mention volume (analytics tab, LFXV2-3018). */
  public getAnalyticsTopProjects(request: SocialListeningAnalyticsRequest): Observable<SocialListeningTopProject[]> {
    return this.http.get<SocialListeningTopProject[]>(`${this.baseUrl}/analytics-top-projects`, { params: this.toParams(request) });
  }

  /**
   * Serializes a request object to query params: arrays comma-join (the cross-slice contract
   * with the server's params helper), and `undefined` / empty-string / empty-array values are
   * omitted so the server's `all`/blank normalization never sees them.
   */
  private toParams(request: object): HttpParams {
    // Shared request interfaces have no index signature, so entries are narrowed via a cast.
    const entries = Object.entries(request) as [string, string | number | string[] | undefined][];
    return entries.reduce((params, [key, value]) => {
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        return params;
      }
      return params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }, new HttpParams());
  }
}
