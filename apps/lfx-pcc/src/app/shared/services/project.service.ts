// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { Project, ProjectQueryResponse, ProjectSearchResult } from '@lfx-pcc/shared/interfaces';
import { catchError, map, Observable, of, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  public project: WritableSignal<Project | null> = signal(null);

  private readonly http = inject(HttpClient);

  public getProjects(params?: HttpParams): Observable<Project[]> {
    return this.http.get<ProjectQueryResponse>('/api/projects', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load projects:', error);
        return of([]);
      })
    );
  }

  public getProject(slug: string): Observable<Project | null> {
    return this.http.get<Project>(`/api/projects/${slug}`).pipe(
      catchError((error) => {
        console.error(`Failed to load project ${slug}:`, error);
        return of(null);
      }),
      tap((project) => this.project.set(project))
    );
  }

  public searchProjects(query: string): Observable<Project[]> {
    const params = new HttpParams().set('q', query);

    return this.http.get<ProjectSearchResult[]>('/api/projects/search', { params }).pipe(
      map((results) => this.transformSearchResultsToProjects(results)),
      catchError((error) => {
        console.error('Failed to search projects:', error);
        return of([]);
      })
    );
  }

  private transformSearchResultsToProjects(searchResults: ProjectSearchResult[]): Project[] {
    return searchResults.map((result) => ({
      id: result.project_id,
      name: result.project_name,
      slug: result.project_slug,
      description: result.project_description,
      status: result.status,
      logo: result.logo,
      meetings_count: result.meetings_count || 0,
      mailing_list_count: result.mailing_list_count || 0,
      committees_count: result.committee_names?.length || 0,
    }));
  }
}
