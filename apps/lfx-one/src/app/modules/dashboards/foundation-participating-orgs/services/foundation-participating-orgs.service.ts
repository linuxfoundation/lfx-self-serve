// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_EMPTY_MESSAGE,
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_ERROR_MESSAGE,
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER,
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_MESSAGE,
} from '@lfx-one/shared/constants';
import type {
  FoundationParticipatingOrgBreakdown,
  FoundationParticipatingOrgsExportFilters,
  FoundationParticipatingOrgsExportKind,
  FoundationParticipatingOrgsPage,
  FoundationParticipatingOrgsProjectsResponse,
  FoundationParticipatingOrgsQuery,
  FoundationParticipatingOrgsRange,
  FoundationParticipatingOrgsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { downloadFromUrl, parseContentDispositionFilename } from '@lfx-one/shared/utils';
import { strictHttpParams } from '@shared/utils/http-params.utils';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of, throwError } from 'rxjs';

const BASE_URL = '/api/foundation-participating-orgs';

/**
 * HTTP client for Foundation Lens → Participating Companies (#5697). Reads propagate their errors so the page can tell a
 * 403 (no access) from any other failure; the export never errors — it saves the file or toasts why not.
 */
@Injectable({ providedIn: 'root' })
export class FoundationParticipatingOrgsService {
  private readonly http = inject(HttpClient);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  public getProjects(foundationSlug: string, range: FoundationParticipatingOrgsRange): Observable<FoundationParticipatingOrgsProjectsResponse> {
    const params = strictHttpParams().set('foundationSlug', foundationSlug).set('range', range);
    return this.http.get<FoundationParticipatingOrgsProjectsResponse>(`${BASE_URL}/projects`, { params }).pipe(catchError(this.propagate('getProjects')));
  }

  public getSummary(
    foundationSlug: string,
    range: FoundationParticipatingOrgsRange,
    projectSlug: string | null
  ): Observable<FoundationParticipatingOrgsSummaryResponse> {
    let params = strictHttpParams().set('foundationSlug', foundationSlug).set('range', range);
    if (projectSlug) params = params.set('projectSlug', projectSlug);
    return this.http.get<FoundationParticipatingOrgsSummaryResponse>(`${BASE_URL}/summary`, { params }).pipe(catchError(this.propagate('getSummary')));
  }

  public getPage(query: FoundationParticipatingOrgsQuery): Observable<FoundationParticipatingOrgsPage> {
    const params = filterParams(query).set('pageSize', String(query.pageSize)).set('offset', String(query.offset));
    return this.http.get<FoundationParticipatingOrgsPage>(BASE_URL, { params }).pipe(catchError(this.propagate('getPage')));
  }

  /** The projects behind one company's totals; loaded when its row is expanded. */
  public getBreakdown(foundationSlug: string, range: FoundationParticipatingOrgsRange, companyKey: string): Observable<FoundationParticipatingOrgBreakdown> {
    const params = strictHttpParams().set('foundationSlug', foundationSlug).set('range', range).set('companyKey', companyKey);
    return this.http.get<FoundationParticipatingOrgBreakdown>(`${BASE_URL}/breakdown`, { params }).pipe(catchError(this.propagate('getBreakdown')));
  }

  /** Saves one of the two CSV files for the current filters. A 204 means nothing matches, so nothing is saved. */
  public exportCsv(filters: FoundationParticipatingOrgsExportFilters, kind: FoundationParticipatingOrgsExportKind): Observable<string | null> {
    if (!isPlatformBrowser(this.platformId)) return of(null);

    const params = filterParams(filters).set('kind', kind);
    return this.http.get(`${BASE_URL}/export`, { params, responseType: 'blob', observe: 'response' }).pipe(
      map((response) => {
        const blob = response.body;
        if (response.status === 204 || !blob || blob.size === 0) {
          this.toast('info', 'Nothing to export', FOUNDATION_PARTICIPATING_ORGS_EXPORT_EMPTY_MESSAGE);
          return null;
        }
        const fileName = parseContentDispositionFilename(response.headers.get('Content-Disposition')) ?? 'participating-companies.csv';
        const url = URL.createObjectURL(blob);
        downloadFromUrl(url, fileName);
        // Deferred: some browsers start the download asynchronously, and revoking at once can invalidate the URL first.
        setTimeout(() => URL.revokeObjectURL(url), 0);
        if (response.headers.get(FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER) === 'true') {
          this.toast('warn', 'Export truncated', FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_MESSAGE);
        }
        this.toast('success', 'Export started', `${fileName} will download in a moment.`);
        return fileName;
      }),
      catchError((error: unknown) => {
        console.error('[foundation-participating-orgs] export failed', error);
        this.toast('error', 'Export failed', FOUNDATION_PARTICIPATING_ORGS_EXPORT_ERROR_MESSAGE);
        return of(null);
      })
    );
  }

  private propagate(operation: string): (error: unknown) => Observable<never> {
    return (error: unknown) => {
      console.error(`[foundation-participating-orgs] ${operation} failed`, error);
      return throwError(() => error);
    };
  }

  private toast(severity: 'success' | 'info' | 'warn' | 'error', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail });
  }
}

/** Filters shared by the list read and the export. Empty search, no tier and no project scope are omitted. */
function filterParams(filters: FoundationParticipatingOrgsExportFilters): HttpParams {
  let params = strictHttpParams()
    .set('foundationSlug', filters.foundationSlug)
    .set('range', filters.range)
    .set('segment', filters.segment)
    .set('sort', filters.sort)
    .set('dir', filters.dir);
  if (filters.projectSlug) params = params.set('projectSlug', filters.projectSlug);
  if (filters.search) params = params.set('search', filters.search);
  if (filters.tier) params = params.set('tier', filters.tier);
  return params;
}
