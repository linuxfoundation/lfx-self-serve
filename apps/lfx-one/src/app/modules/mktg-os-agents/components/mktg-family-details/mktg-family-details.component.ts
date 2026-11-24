// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MKTG_KIT_FRAMEWORK_KEY, MKTG_KIT_SHOW_COMING_SOON, MKTG_NOT_AVAILABLE_TEXT, MKTG_POLL_RETRYING_TEXT } from '@lfx-one/shared/constants';
import { MktgKitFamilyView, MktgKitSourcesView } from '@lfx-one/shared/interfaces';
import { mktgKitSources } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { readUntilReachable } from '@shared/utils/visibility-poll.util';
import { catchError, distinctUntilChanged, of, switchMap } from 'rxjs';

/** Reads only the framework revision used by the source block, on its Family page. */
@Component({
  selector: 'lfx-mktg-family-details',
  imports: [ButtonComponent],
  templateUrl: './mktg-family-details.component.html',
})
export class MktgFamilyDetailsComponent {
  private readonly store = inject(MktgDocumentStoreService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  public readonly family = input.required<MktgKitFamilyView>();
  public readonly projectUid = input.required<string>();
  protected readonly showComingSoon = MKTG_KIT_SHOW_COMING_SOON;
  protected readonly loading = signal(false);
  /** A final refusal of the source read: one red line, no Retry. */
  protected readonly failed = signal(false);
  /** The server cannot be reached: one grey line in the loading spot while the read keeps trying. */
  protected readonly retrying = signal(false);
  protected readonly retryingText = MKTG_POLL_RETRYING_TEXT;
  protected readonly failedText = MKTG_NOT_AVAILABLE_TEXT.familyDetails;
  protected readonly loadingText = computed(() => {
    if (this.retrying()) return this.retryingText;
    return this.loading() ? 'Loading source details…' : '';
  });
  protected readonly sources = signal<MktgKitSourcesView | null>(null);
  protected readonly sourcesExpanded = signal(false);
  protected readonly signOffExpanded = signal(false);

  public constructor() {
    const request$ = toObservable(
      computed(() => {
        const family = this.family();
        const document = family.rows.find((row) => row.asset.agentKey === MKTG_KIT_FRAMEWORK_KEY)?.document;
        return { project: this.projectUid(), familyId: family.family.id, revisionId: document?.latestRevisionId, document };
      })
    );
    if (isPlatformBrowser(this.platformId)) {
      request$
        .pipe(
          distinctUntilChanged(
            (previous, next) => previous.project === next.project && previous.familyId === next.familyId && previous.revisionId === next.revisionId
          ),
          switchMap(({ document, project }) => {
            this.sources.set(null);
            this.sourcesExpanded.set(false);
            this.signOffExpanded.set(false);
            this.failed.set(false);
            this.retrying.set(false);
            this.loading.set(false);
            if (!project || !document) return of(null);
            this.loading.set(true);
            return readUntilReachable(
              this.document,
              () => this.store.getRevision(project, document.agentKey, document.documentId, document.latestRevisionId),
              (retrying) => this.retrying.set(retrying)
            ).pipe(
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
}
