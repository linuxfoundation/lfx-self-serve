// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { Project } from '@lfx-pcc/shared/interfaces';
import { BehaviorSubject, catchError, Observable, of, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  public project: WritableSignal<Project | null> = signal(null);
  public project$: BehaviorSubject<Project | null> = new BehaviorSubject<Project | null>(null);

  private readonly http = inject(HttpClient);

  public getProjects(params?: HttpParams): Observable<Project[]> {
    return this.http.get<Project[]>('/api/projects', { params }).pipe(
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
      tap((project) => {
        this.project$.next(project);
        this.project.set(project);
      })
    );
  }

  public searchProjects(query: string): Observable<Project[]> {
    const params = new HttpParams().set('q', query);

    return this.http.get<Project[]>('/api/projects/search', { params }).pipe(
      catchError((error) => {
        console.error('Failed to search projects:', error);
        return of([]);
      })
    );
  }
}
