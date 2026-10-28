// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MKTG_KIT_FRAMEWORK_KEY } from '@lfx-one/shared/constants';
import { MktgKitFamilyView, MktgKitSourcesView } from '@lfx-one/shared/interfaces';
import { mktgKitSources } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { catchError, of, switchMap } from 'rxjs';

/** Reads only the framework revision used by the source block, on its Family page. */
@Component({
  selector: 'lfx-mktg-family-details',
  imports: [ButtonComponent],
  templateUrl: './mktg-family-details.component.html',
})
export class MktgFamilyDetailsComponent {
  private readonly store = inject(MktgDocumentStoreService);
  private readonly platformId = inject(PLATFORM_ID);
  public readonly family = input.required<MktgKitFamilyView>();
  public readonly projectUid = input.required<string>();
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly sources = signal<MktgKitSourcesView | null>(null);
  private readonly reload = signal(0);

  public constructor() {
    const request$ = toObservable(computed(() => ({ family: this.family(), project: this.projectUid(), reload: this.reload() })));
    if (isPlatformBrowser(this.platformId)) {
      request$
        .pipe(
          switchMap(({ family, project }) => {
            this.sources.set(null);
            this.failed.set(false);
            this.loading.set(false);
            const document = family.rows.find((row) => row.asset.agentKey === MKTG_KIT_FRAMEWORK_KEY)?.document;
            if (!project || !document) return of(null);
            this.loading.set(true);
            return this.store.getRevision(project, document.agentKey, document.documentId, document.latestRevisionId).pipe(
              catchError(() => {
                this.failed.set(true);
                return of(null);
              })
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((revision) => {
          this.loading.set(false);
          this.sources.set(mktgKitSources(revision?.type.agentKey === MKTG_KIT_FRAMEWORK_KEY ? revision.sidecar : null));
        });
    }
  }

  protected retry(): void {
    this.reload.update((value) => value + 1);
  }
}
