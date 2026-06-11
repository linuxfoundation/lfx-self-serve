// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  GetOrgCertificationsParams,
  GetOrgTrainingsParams,
  OrgCertEmployeesResponse,
  OrgCertEmployeeStatus,
  OrgCertificationsResponse,
  OrgTrainingEmployeesResponse,
  OrgTrainingEmployeeStatus,
  OrgTrainingsResponse,
  OrgTrainingStats,
} from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OrgLensTrainingService {
  private readonly http = inject(HttpClient);

  public getTrainingStats(orgUid: string): Observable<OrgTrainingStats> {
    return this.http.get<OrgTrainingStats>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/training/stats`);
  }

  public getOrgCertifications(orgUid: string, params: GetOrgCertificationsParams = {}): Observable<OrgCertificationsResponse> {
    return this.http.get<OrgCertificationsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/training/certifications`, {
      params: this.buildListParams(params),
    });
  }

  public getOrgTrainings(orgUid: string, params: GetOrgTrainingsParams = {}): Observable<OrgTrainingsResponse> {
    return this.http.get<OrgTrainingsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/training/trainings`, {
      params: this.buildListParams(params),
    });
  }

  public getCertificationEmployees(
    orgUid: string,
    courseId: string,
    status: OrgCertEmployeeStatus,
    searchQuery?: string
  ): Observable<OrgCertEmployeesResponse> {
    let httpParams = new HttpParams().set('status', status);
    if (searchQuery) httpParams = httpParams.set('searchQuery', searchQuery);

    return this.http.get<OrgCertEmployeesResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/training/certifications/${encodeURIComponent(courseId)}/employees`,
      { params: httpParams }
    );
  }

  public getTrainingEmployees(
    orgUid: string,
    courseId: string,
    status: OrgTrainingEmployeeStatus,
    searchQuery?: string
  ): Observable<OrgTrainingEmployeesResponse> {
    let httpParams = new HttpParams().set('status', status);
    if (searchQuery) httpParams = httpParams.set('searchQuery', searchQuery);

    return this.http.get<OrgTrainingEmployeesResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/training/trainings/${encodeURIComponent(courseId)}/employees`,
      { params: httpParams }
    );
  }

  private buildListParams(params: GetOrgCertificationsParams | GetOrgTrainingsParams): HttpParams {
    let httpParams = new HttpParams();

    if (params.searchQuery) httpParams = httpParams.set('searchQuery', params.searchQuery);
    if (params.level) httpParams = httpParams.set('level', params.level);
    if (params.pageSize) httpParams = httpParams.set('pageSize', String(params.pageSize));
    if (params.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
    if (params.sortField) httpParams = httpParams.set('sortField', params.sortField);
    if (params.sortOrder) httpParams = httpParams.set('sortOrder', params.sortOrder);

    return httpParams;
  }
}
