// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, PLATFORM_ID, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MKTG_DOCUMENTS_API_PATH, MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES } from '@lfx-one/shared/constants';
import type {
  MktgAddDocumentCommentRequest,
  MktgDocumentComment,
  MktgDocumentCommentDraft,
  MktgDocumentCommentScope,
  MktgDocumentCommentsResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, defer, distinctUntilChanged, EMPTY, finalize, Observable, Subject, Subscription, take, takeUntil, tap, throwError } from 'rxjs';
import { extractErrorMessage, isTransientHttpError } from '@shared/utils/http-error.utils';
import { ProjectContextService } from './project-context.service';
import { UserService } from './user.service';

/** One selected asset's comments. No persistent cache, implicit POST, or invented empty read. */
@Injectable({ providedIn: 'root' })
export class MktgDocumentCommentsService {
  private readonly http = inject(HttpClient);
  private readonly user = inject(UserService);
  private readonly project = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  private readonly selection = signal<MktgDocumentCommentScope | null>(null);
  private readonly owner = signal('');
  private readonly data = signal<MktgDocumentComment[]>([]);
  private readonly reading = signal(false);
  private readonly writing = signal(false);
  private readonly measured = signal(false);
  private readonly readError = signal('');
  private readonly writeError = signal('');
  private readonly stopWrites = new Subject<void>();
  private readonly fieldDrafts = new Map<string, Map<string, MktgDocumentCommentDraft>>();
  private reader?: Subscription;
  private readEpoch = 0;
  private contextEpoch = 0;

  // Observe identity independently: invalid selections can both map to the same empty context key.
  private readonly identity = computed(() => JSON.stringify([this.user.user()?.sub ?? '', this.project.activeContextUid()]));
  private readonly contextKey = computed(() => {
    const scope = this.selection();
    const subject = this.user.user()?.sub ?? '';
    if (!isPlatformBrowser(this.platformId) || !subject || !scope || scope.projectUid !== this.project.activeContextUid()) return '';
    return JSON.stringify([subject, scope.projectUid, scope.agentKey, scope.documentId, scope.revisionId]);
  });
  public readonly threads = computed(() => (this.current() ? this.data() : []));
  public readonly loading = computed(() => this.current() && this.reading());
  public readonly saving = computed(() => this.current() && this.writing());
  public readonly loaded = computed(() => this.current() && this.measured());
  public readonly loadError = computed(() => (this.current() ? this.readError() : ''));
  public readonly saveError = computed(() => (this.current() ? this.writeError() : ''));

  public constructor() {
    toObservable(this.identity)
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncContext());
    this.destroyRef.onDestroy(() => {
      this.cancelRead();
      this.stopWrites.next();
      this.stopWrites.complete();
      this.fieldDrafts.clear();
    });
  }

  /** Same-view field hosts share memory across tab destruction, never across effective scopes. */
  public fieldDraft(field: string, create: () => MktgDocumentCommentDraft): MktgDocumentCommentDraft {
    const owner = this.contextKey();
    if (!owner) return untracked(create);
    let fields = this.fieldDrafts.get(owner);
    if (!fields) {
      fields = new Map();
      this.fieldDrafts.set(owner, fields);
    }
    let draft = fields.get(field);
    if (!draft) {
      draft = untracked(create);
      fields.set(field, draft);
    }
    return draft;
  }

  /** Select on navigation and clear on departure. A restored view only GETs, never adds a comment. */
  public select(scope: MktgDocumentCommentScope | null): void {
    this.selection.set(scope ? { ...scope } : null);
    this.syncContext();
  }

  /** A failure is not known-empty. Same-scope transient failures retain the last measured list. */
  public refresh(): void {
    if (this.contextKey() !== this.owner()) {
      this.syncContext();
      return;
    }
    const scope = this.selection();
    const owner = this.contextKey();
    if (!scope || !owner) return;
    this.cancelRead();
    const epoch = this.readEpoch;
    this.reading.set(true);
    this.readError.set('');
    this.reader = this.http
      .get<MktgDocumentCommentsResponse>(this.path(scope), { params: { project: scope.projectUid, revision: scope.revisionId } })
      .pipe(
        take(1),
        tap((response) => {
          if (!this.current(owner) || epoch !== this.readEpoch) return;
          this.requireRevision(response, scope);
          this.data.set(response.threads);
          this.measured.set(true);
        }),
        catchError((error: unknown) => {
          if (this.current(owner) && epoch === this.readEpoch) {
            if (!isTransientHttpError(error)) {
              this.data.set([]);
              this.measured.set(false);
            }
            const denied = error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
            this.readError.set(denied ? MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.access : MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.load);
            // Status only: comment bodies and upstream payloads never enter diagnostics.
            console.error('Asset comments read failed', { status: error instanceof HttpErrorResponse ? error.status : null });
          }
          return EMPTY;
        }),
        finalize(() => {
          if (this.current(owner) && epoch === this.readEpoch) this.reading.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /** Caller retains request ID and composer text on failure; resubscription never invents another ID. */
  public add(anchor: MktgAddDocumentCommentRequest['anchor'], text: string, clientRequestId: string): Observable<MktgDocumentCommentsResponse> {
    const scope = this.selection();
    const owner = this.contextKey();
    if (!isPlatformBrowser(this.platformId)) return EMPTY;
    if (!scope || !owner || !this.current(owner)) return throwError(() => new Error(MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.scope));
    const body: MktgAddDocumentCommentRequest = { project: scope.projectUid, revisionId: scope.revisionId, anchor: { ...anchor }, text, clientRequestId };
    const epoch = this.contextEpoch;
    return defer(() => {
      if (!this.current(owner) || epoch !== this.contextEpoch || this.writing()) return EMPTY;
      this.writing.set(true);
      this.writeError.set('');
      return this.http.post<MktgDocumentCommentsResponse>(this.path(scope), body).pipe(
        take(1),
        takeUntil(this.stopWrites),
        tap((response) => {
          if (!this.current(owner)) return;
          this.requireRevision(response, scope);
          // A pre-save GET must never overwrite the acknowledged POST snapshot.
          this.cancelRead();
          this.reading.set(false);
          this.data.set(response.threads);
          this.measured.set(true);
          this.readError.set('');
        }),
        catchError((error: unknown) => {
          if (this.current(owner)) {
            if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
              this.cancelRead();
              this.reading.set(false);
              this.data.set([]);
              this.measured.set(false);
            }
            this.writeError.set(extractErrorMessage(error, MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.save));
          }
          return throwError(() => error);
        }),
        finalize(() => {
          if (this.current(owner)) this.writing.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      );
    });
  }

  private syncContext(): void {
    const owner = this.contextKey();
    if (owner === this.owner()) return;
    this.contextEpoch++;
    // A current-owner draft may have been requested before the identity observer flushed.
    for (const key of this.fieldDrafts.keys()) if (key !== owner) this.fieldDrafts.delete(key);
    this.cancelRead();
    this.stopWrites.next();
    this.owner.set(owner);
    this.data.set([]);
    this.measured.set(false);
    this.reading.set(false);
    this.writing.set(false);
    this.readError.set('');
    this.writeError.set('');
    if (owner) this.refresh();
  }

  private cancelRead(): void {
    this.readEpoch++;
    this.reader?.unsubscribe();
    this.reader = undefined;
  }

  private current(owner = this.owner()): boolean {
    return !!owner && owner === this.owner() && owner === this.contextKey();
  }
  private path(scope: MktgDocumentCommentScope): string {
    return `${MKTG_DOCUMENTS_API_PATH}/${encodeURIComponent(scope.agentKey)}/${encodeURIComponent(scope.documentId)}/comments`;
  }
  private requireRevision(response: MktgDocumentCommentsResponse, scope: MktgDocumentCommentScope): void {
    if (response.revisionId !== scope.revisionId) throw new Error(MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.unexpected);
  }
}
