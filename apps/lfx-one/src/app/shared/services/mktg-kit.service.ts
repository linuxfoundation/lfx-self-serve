// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MktgDocumentsResponse } from '@lfx-one/shared/interfaces';
import { resolveMktgKit, summarizeMktgKit } from '@lfx-one/shared/utils';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import {
  catchError,
  defaultIfEmpty,
  defer,
  distinctUntilChanged,
  EMPTY,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ProjectContextService } from './project-context.service';
import { UserService } from './user.service';

/** Read-state implementation; each Kit or Family page provides its own instance. */
@Injectable()
export class MktgKitService {
  private readonly context = inject(ProjectContextService);
  private readonly user = inject(UserService);
  private readonly store = inject(MktgDocumentStoreService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reload = signal(0);
  private contextSeen = false;
  private loadedScope = '';
  private readonly cancelReads = new Subject<void>();
  private readonly inFlight = new Map<string, Observable<MktgDocumentsResponse>>();

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
    const request$ = toObservable(
      computed(() => ({ project: this.context.activeContext()?.uid ?? '', subject: this.user.user()?.sub, reload: this.reload() }))
    );
    if (isPlatformBrowser(this.platformId)) {
      request$
        .pipe(
          distinctUntilChanged((a, b) => a.project === b.project && a.subject === b.subject && a.reload === b.reload),
          switchMap(({ project, subject }) => {
            // Cancel all subscribers on request-scope changes, including actor-scoped reloads.
            this.cancelReads.next();
            this.refreshDenied.set(false);
            const scope = JSON.stringify([project, subject]);
            if (scope !== this.loadedScope) this.documents.set(null);
            this.loadedScope = scope;
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
                // A same-scope transient failure cannot erase an already measured kit.
                return of(isTransientHttpError(error) ? this.documents() : null);
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
  public refresh(poll = false): Observable<MktgDocumentsResponse | null> {
    return defer(() => {
      const project = this.projectUid();
      if (!isPlatformBrowser(this.platformId) || !project) return of(null);
      if (this.accessDenied() || this.refreshDenied()) return EMPTY;
      return this.read(project, poll).pipe(
        tap((documents) => {
          if (project !== this.projectUid()) return;
          this.documents.set(documents);
          this.error.set('');
        }),
        // A scope/reload cancellation must still schedule the visibility poll's next tick.
        defaultIfEmpty(null),
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

  /** Initial loads and quiet refreshes share reads only within the same project and discovery/poll mode. */
  private read(project: string, poll = false): Observable<MktgDocumentsResponse> {
    const key = JSON.stringify([project, poll]);
    const current = this.inFlight.get(key);
    if (current) return current;
    const pending: Observable<MktgDocumentsResponse> = defer(() => this.store.listDocuments(project, poll)).pipe(
      takeUntil(this.cancelReads),
      map((documents) => {
        const previous = this.documents();
        if (!documents.progressUnavailable || previous?.project !== project || documents.project !== project) return documents;
        return {
          ...documents,
          runs: [...new Map([...(previous.runs ?? []), ...(documents.runs ?? [])].map((run) => [run.runId, run] as const)).values()],
        };
      }),
      finalize(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.inFlight.set(key, pending);
    return pending;
  }
}
