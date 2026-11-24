// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MKTG_NOT_AVAILABLE_TEXT } from '@lfx-one/shared/constants';
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
  throwError,
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
  /** A FINAL refusal only (403, 404, 400…): one red line, no Retry. A connection failure is `retrying`, never this. */
  public readonly error = signal('');
  /**
   * The server cannot be reached (network, 408, 429, 5xx): the pages show one grey line where the kit is read, keep
   * whatever is loaded usable, and the page's poller keeps checking. Cleared by the next good read.
   */
  public readonly retrying = signal(false);
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
            this.retrying.set(false);
            this.accessDenied.set(false);
            if (project) this.contextSeen = true;
            this.loading.set(!!project || !this.contextSeen);
            if (!project) return of(null);
            return this.read(project).pipe(
              catchError((error: HttpErrorResponse) => {
                // A same-scope transient failure cannot erase an already measured kit; the page's poller reads again.
                if (isTransientHttpError(error)) {
                  this.retrying.set(true);
                  return of(this.documents());
                }
                this.refuse(error);
                return of(null);
              })
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((documents) => {
          this.documents.set(documents);
          // Opened offline: the skeleton stays under the grey line until the poller's first good read.
          if (this.contextSeen) this.loading.set(this.retrying() && !documents);
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
          this.retrying.set(false);
          this.loading.set(false);
        }),
        // A scope/reload cancellation must still schedule the visibility poll's next tick.
        defaultIfEmpty(null),
        catchError((error: HttpErrorResponse) => {
          const current = project === this.projectUid();
          // Rethrown so the shared poller backs off with jitter; it never stops and a wake re-reads at once.
          if (isTransientHttpError(error)) {
            if (current) this.retrying.set(true);
            return throwError(() => error);
          }
          if (current) {
            this.retrying.set(false);
            // Nothing loaded yet (opened offline, then refused): the refusal is the page's final state.
            if (!this.documents()) {
              this.refuse(error);
              this.loading.set(false);
            } else if (error.status === 403) this.refreshDenied.set(true);
          }
          return error.status === 403 ? EMPTY : of(null);
        })
      );
    });
  }

  /** Re-read after an action changed the kit (a rebuild). Not a control: no screen offers a Retry for a failed read. */
  public retry(): void {
    this.reload.update((value) => value + 1);
  }

  private refuse(error: HttpErrorResponse): void {
    this.accessDenied.set(error.status === 403);
    this.error.set(error.status === 403 ? 'You need write access to this project to see its Marketing kit.' : MKTG_NOT_AVAILABLE_TEXT.kit);
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
