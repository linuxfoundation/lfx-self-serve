// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgLensProjectSearchResponse, OrgLensProjectsResponse, OrgProjectsWorkspace, OrgProjectsWorkspacesResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OrgLensProjectsService {
  private readonly http = inject(HttpClient);

  public getProjects(orgUid: string, orgName: string, slugs: readonly string[] = []): Observable<OrgLensProjectsResponse> {
    let params = new HttpParams().set('orgName', orgName);
    if (slugs.length) {
      params = params.set('slugs', slugs.join(','));
    }
    return this.http.get<OrgLensProjectsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/projects`, { params });
  }

  public searchProjects(orgUid: string, query: string, excludeSlugs: readonly string[] = []): Observable<OrgLensProjectSearchResponse> {
    let params = new HttpParams().set('q', query);
    if (excludeSlugs.length) {
      params = params.set('excludeSlugs', excludeSlugs.join(','));
    }
    return this.http.get<OrgLensProjectSearchResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/projects/search`, {
      params,
    });
  }

  public getWorkspaces(orgUid: string): Observable<OrgProjectsWorkspacesResponse> {
    return this.http.get<OrgProjectsWorkspacesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/workspaces`);
  }

  public createWorkspace(orgUid: string, name: string): Observable<{ workspace: OrgProjectsWorkspace }> {
    return this.http.post<{ workspace: OrgProjectsWorkspace }>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/workspaces`, { name });
  }

  public renameWorkspace(orgUid: string, workspaceId: string, name: string): Observable<{ workspace: OrgProjectsWorkspace }> {
    return this.http.put<{ workspace: OrgProjectsWorkspace }>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/workspaces/${encodeURIComponent(workspaceId)}`, {
      name,
    });
  }

  public deleteWorkspace(orgUid: string, workspaceId: string): Observable<void> {
    return this.http.delete<void>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  public addProjectsToWorkspace(orgUid: string, workspaceId: string, slugs: readonly string[]): Observable<{ workspace: OrgProjectsWorkspace }> {
    return this.http.post<{ workspace: OrgProjectsWorkspace }>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/workspaces/${encodeURIComponent(workspaceId)}/projects`,
      {
        slugs,
      }
    );
  }

  public removeProjectFromWorkspace(orgUid: string, workspaceId: string, slug: string): Observable<{ workspace: OrgProjectsWorkspace }> {
    return this.http.delete<{ workspace: OrgProjectsWorkspace }>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(slug)}`
    );
  }
}
