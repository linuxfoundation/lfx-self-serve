// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MktgDocumentsResponse } from '@lfx-one/shared/interfaces';
import { resolveMktgKit, summarizeMktgKit } from '@lfx-one/shared/utils';
import { catchError, distinctUntilChanged, of, switchMap } from 'rxjs';
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

  public readonly loading = signal(true);
  public readonly error = signal('');
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
            this.documents.set(null);
            this.error.set('');
            if (project) this.contextSeen = true;
            this.loading.set(!!project || !this.contextSeen);
            if (!project) return of(null);
            return this.store.listDocuments(project).pipe(
              catchError((error: HttpErrorResponse) => {
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

  public retry(): void {
    this.reload.update((value) => value + 1);
  }
}
