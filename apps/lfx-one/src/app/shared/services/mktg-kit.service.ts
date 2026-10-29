// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MktgDocumentsResponse } from '@lfx-one/shared/interfaces';
import { resolveMktgKit, summarizeMktgKit } from '@lfx-one/shared/utils';
import { catchError, defer, distinctUntilChanged, EMPTY, finalize, Observable, of, shareReplay, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ProjectContextService } from './project-context.service';

/** Read-state implementation; each Kit or Family page provides its own instance. */
@Injectable()
export class MktgKitService {
  private readonly context = inject(ProjectContextService);
  private readonly store = inject(MktgDocumentStoreService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reload = signal(0);
  private contextSeen = false;
  private readonly cancelReads = new Subject<void>();
  private inFlight: Observable<MktgDocumentsResponse> | null = null;
  private inFlightProject = '';

  public readonly loading = signal(true);
  public readonly error = signal('');
  /** A denied read resolves access, not private document state. */
  public readonly accessDenied = signal(false);
  /** Quiet refresh denial controls polling only, without changing the existing action/error UI. */
  public readonly refreshDenied = signal(false);
  public readonly documents = signal<MktgDocumentsResponse | null>(null);
  public readonly projectUid = computed(() => this.context.activeContext()?.uid ?? '');
  public readonly projectName = computed(() => this.context.activeContext()?.name ?? 'Project');
  public readonly projectQueryParams = computed(() => ({ project: this.context.activeContext()?.slug ?? null }));
  public readonly families = computed(() => {
    const documents = this.documents();
    return documents ? resolveMktgKit(documents) : [];
  });
  public readonly summary = computed(() => summarizeMktgKit(this.families()));

  public constructor() {
    const request$ = toObservable(computed(() => ({ project: this.context.activeContext()?.uid ?? '', reload: this.reload() })));
    if (isPlatformBrowser(this.platformId)) {
      request$
        .pipe(
          distinctUntilChanged((a, b) => a.project === b.project && a.reload === b.reload),
          switchMap(({ project }) => {
            // Cancel all subscribers on request-scope changes, including actor-scoped reloads.
            this.cancelReads.next();
            this.refreshDenied.set(false);
            this.documents.set(null);
            this.error.set('');
            this.accessDenied.set(false);
            if (project) this.contextSeen = true;
            this.loading.set(!!project || !this.contextSeen);
            if (!project) return of(null);
            return this.read(project).pipe(
              catchError((error: HttpErrorResponse) => {
                this.accessDenied.set(error.status === 403);
                this.error.set(
                  error.status === 403 ? 'You need write access to this project to see its Marketing kit.' : 'The Marketing kit could not be loaded. Try again.'
                );
                return of(null);
              })
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((documents) => {
          this.documents.set(documents);
          if (this.contextSeen) this.loading.set(false);
        });
    }
  }

  /** Read the current server listing without replacing the mounted rows with a loading state. */
  public refresh(): Observable<MktgDocumentsResponse | null> {
    return defer(() => {
      const project = this.projectUid();
      if (!isPlatformBrowser(this.platformId) || !project) return of(null);
      if (this.accessDenied() || this.refreshDenied()) return EMPTY;
      return this.read(project).pipe(
        tap((documents) => {
          if (project !== this.projectUid()) return;
          this.documents.set(documents);
          this.error.set('');
        }),
        catchError((error: HttpErrorResponse) => {
          if (project === this.projectUid() && error.status === 403) this.refreshDenied.set(true);
          return error.status === 403 ? EMPTY : of(null);
        })
      );
    });
  }

  public retry(): void {
    this.reload.update((value) => value + 1);
  }

  /** Initial loads and quiet refreshes observe the same in-flight HTTP read. */
  private read(project: string): Observable<MktgDocumentsResponse> {
    if (this.inFlight && this.inFlightProject === project) return this.inFlight;
    this.cancelReads.next();
    const pending: Observable<MktgDocumentsResponse> = defer(() => this.store.listDocuments(project)).pipe(
      takeUntil(this.cancelReads),
      finalize(() => {
        if (this.inFlight === pending) this.inFlight = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.inFlightProject = project;
    this.inFlight = pending;
    return pending;
  }
}
