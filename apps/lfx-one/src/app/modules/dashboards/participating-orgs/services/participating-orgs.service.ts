// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  PROJECT_PARTICIPATING_ORGS_EXPORT_EMPTY_MESSAGE,
  PROJECT_PARTICIPATING_ORGS_EXPORT_ERROR_MESSAGE,
  PROJECT_PARTICIPATING_ORGS_EXPORT_FALLBACK_FILENAME,
  PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER,
  PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_MESSAGE,
  PROJECT_PARTICIPATING_ORGS_LINKS_ACCOUNT_IDS_PARAM,
} from '@lfx-one/shared/constants';
import type {
  ProjectParticipatingOrgsExportFilters,
  ProjectParticipatingOrgsOrgLensLinksResponse,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgsQuery,
  ProjectParticipatingOrgsRange,
  ProjectParticipatingOrgsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { downloadFromUrl, parseContentDispositionFilename } from '@lfx-one/shared/utils';
import { strictHttpParams } from '@shared/utils/http-params.utils';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of, throwError } from 'rxjs';

/**
 * HTTP client for Project Lens → Participating Organizations (#2091). Reads propagate their errors so the page can
 * tell a 403 (no access) from any other failure; the export never errors — it saves the file or toasts why not.
 */
@Injectable({ providedIn: 'root' })
export class ParticipatingOrgsService {
  private readonly http = inject(HttpClient);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Tiles and tab counts; `summary` is null when the project has no company code activity in the range. */
  public getSummary(slug: string, range: ProjectParticipatingOrgsRange): Observable<ProjectParticipatingOrgsSummaryResponse> {
    return this.http.get<ProjectParticipatingOrgsSummaryResponse>(`${baseUrl(slug)}/summary`, { params: strictHttpParams().set('range', range) }).pipe(
      catchError((error: unknown) => {
        console.error('[participating-orgs] getSummary failed', { slug, error });
        return throwError(() => error);
      })
    );
  }

  /** One server-sorted page of companies for the segment, search and tier. */
  public getPage(slug: string, query: ProjectParticipatingOrgsQuery): Observable<ProjectParticipatingOrgsPage> {
    const params = filterParams(query).set('pageSize', String(query.pageSize)).set('offset', String(query.offset));
    return this.http.get<ProjectParticipatingOrgsPage>(baseUrl(slug), { params }).pipe(
      catchError((error: unknown) => {
        console.error('[participating-orgs] getPage failed', { slug, error });
        return throwError(() => error);
      })
    );
  }

  /**
   * The page's member companies the viewer can open in Org Lens. Browser only: on the server it emits `null`
   * (links pending), so server rendering never waits on the per-caller access check. A failed read yields no links.
   */
  public getOrgLensReadableAccountIds(slug: string, accountIds: string[]): Observable<ReadonlySet<string> | null> {
    if (!isPlatformBrowser(this.platformId)) return of(null);
    if (accountIds.length === 0) return of(new Set<string>());
    const params = strictHttpParams().set(PROJECT_PARTICIPATING_ORGS_LINKS_ACCOUNT_IDS_PARAM, accountIds.join(','));
    return this.http.get<ProjectParticipatingOrgsOrgLensLinksResponse>(`${baseUrl(slug)}/org-lens-links`, { params }).pipe(
      map((response) => new Set(response.readableAccountIds)),
      catchError((error: unknown) => {
        console.error('[participating-orgs] getOrgLensReadableAccountIds failed', { slug, error });
        return of(new Set<string>());
      })
    );
  }

  /**
   * Saves the full filtered list as the CSV the BFF builds, under the name it sends. A 204 means no company matches,
   * so nothing is saved; a file cut at the row cap is still saved, with a warning. Off the browser it reads nothing.
   */
  public exportCsv(slug: string, filters: ProjectParticipatingOrgsExportFilters): Observable<void> {
    if (!isPlatformBrowser(this.platformId)) return of(undefined);

    return this.http.get(`${baseUrl(slug)}/export`, { params: filterParams(filters), responseType: 'blob', observe: 'response' }).pipe(
      map((response) => {
        const blob = response.body;
        if (response.status === 204 || !blob || blob.size === 0) {
          this.toast('info', 'Nothing to export', PROJECT_PARTICIPATING_ORGS_EXPORT_EMPTY_MESSAGE);
          return;
        }
        const fileName = parseContentDispositionFilename(response.headers.get('Content-Disposition')) ?? PROJECT_PARTICIPATING_ORGS_EXPORT_FALLBACK_FILENAME;
        const url = URL.createObjectURL(blob);
        downloadFromUrl(url, fileName);
        // Deferred: some browsers start the download asynchronously, and revoking at once can invalidate the URL first.
        setTimeout(() => URL.revokeObjectURL(url), 0);
        if (response.headers.get(PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER) === 'true') {
          this.toast('warn', 'Export truncated', PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_MESSAGE);
        }
      }),
      catchError((error: unknown) => {
        console.error('[participating-orgs] export failed', { slug, error });
        this.toast('error', 'Export failed', PROJECT_PARTICIPATING_ORGS_EXPORT_ERROR_MESSAGE);
        return of(undefined);
      })
    );
  }

  private toast(severity: 'info' | 'warn' | 'error', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail });
  }
}

function baseUrl(slug: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/participating-orgs`;
}

/** Filters shared by the list read and the export. Empty search and no tier are omitted. */
function filterParams(filters: ProjectParticipatingOrgsExportFilters): HttpParams {
  let params = strictHttpParams().set('range', filters.range).set('segment', filters.segment).set('sort', filters.sort).set('dir', filters.dir);
  if (filters.search) params = params.set('search', filters.search);
  if (filters.tier) params = params.set('tier', filters.tier);
  return params;
}
