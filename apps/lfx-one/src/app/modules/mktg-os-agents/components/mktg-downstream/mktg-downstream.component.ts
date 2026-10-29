// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { mktgKitRootPath } from '@lfx-one/shared/utils';
import { ButtonComponent } from '@components/button/button.component';
import { MktgSkeletonComponent } from '@components/mktg-skeleton/mktg-skeleton.component';
import { MKTG_KIT_POSITIONING_FAMILY_ID, MKTG_REBUILD_NAVIGATION_STATE_KEY } from '@lfx-one/shared/constants';
import { MktgDocumentsResponse } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { UserService } from '@services/user.service';
import { catchError, of, switchMap } from 'rxjs';

/** The framework Asset board reads the SAME server projection as Kit and Family. */
@Component({
  selector: 'lfx-mktg-downstream',
  imports: [ButtonComponent, MktgSkeletonComponent],
  templateUrl: './mktg-downstream.component.html',
})
export class MktgDownstreamComponent {
  private readonly store = inject(MktgDocumentStoreService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  protected readonly user = inject(UserService);
  public readonly project = input.required<string>();
  public readonly projectSlug = input<string | null>(null);
  public readonly refreshKey = input('');
  public readonly writer = input(false);
  public readonly settled = output<string>();
  private readKey = '';
  protected readonly familyId = MKTG_KIT_POSITIONING_FAMILY_ID;
  protected readonly listing = signal<MktgDocumentsResponse | null>(null);
  protected readonly failed = signal(false);
  protected readonly loading = signal(true);
  private readonly reload = signal(0);
  protected readonly stale = computed(
    () =>
      this.listing()?.groups.flatMap((group) =>
        group.documents.filter((document) => document.needsRebuild).map((document) => ({ label: group.type.label, stale: document.needsRebuild }))
      ) ?? []
  );
  protected readonly copy = this.initCopy();
  protected readonly buttonLabel = computed(() =>
    this.stale().length === 2
      ? 'Rebuild both'
      : 'Rebuild ' +
        this.stale()
          .map((entry) => entry.label)
          .join(', ')
  );

  public constructor() {
    if (isPlatformBrowser(this.platform)) {
      toObservable(computed(() => ({ project: this.project(), refresh: this.refreshKey(), reload: this.reload() })))
        .pipe(
          switchMap(({ project, refresh }) => {
            this.readKey = JSON.stringify([project, refresh]);
            this.listing.set(null);
            this.failed.set(false);
            this.loading.set(!!project);
            if (!project) return of(null);
            return this.store.listDocuments(project).pipe(
              catchError(() => {
                this.failed.set(true);
                return of(null);
              })
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((listing) => {
          this.listing.set(listing);
          this.loading.set(false);
          this.settled.emit(this.readKey);
        });
    }
  }

  protected retry(): void {
    this.reload.update((value) => value + 1);
  }

  protected rebuild(): void {
    const framework = this.listing()?.approvedFramework;
    if (!framework || !this.projectSlug() || !this.writer() || this.user.impersonating()) return;
    void this.router.navigate([mktgKitRootPath(this.router.url), 'families', this.familyId], {
      state: { [MKTG_REBUILD_NAVIGATION_STATE_KEY]: { project: this.project(), frameworkRevisionId: framework.revisionId } },
      queryParams: { project: this.projectSlug() },
    });
  }

  private initCopy() {
    return computed(() => {
      const entries = this.stale();
      const target = this.listing()?.approvedFramework;
      if (!entries.length || !target) return '';
      const versions = new Set(entries.map((entry) => entry.stale?.builtFrom.revisionNumber));
      const names = entries.map((entry) => entry.label);
      if (entries.length === 1) return `${names[0]} was built from v${entries[0].stale?.builtFrom.revisionNumber}. Rebuild it from v${target.revisionNumber}?`;
      if (versions.size === 1)
        return `${new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names)} were built from v${entries[0].stale?.builtFrom.revisionNumber}. Rebuild them from v${target.revisionNumber}?`;
      return `${entries.map((entry) => `${entry.label} (from v${entry.stale?.builtFrom.revisionNumber})`).join(', ')} need rebuilding from v${target.revisionNumber}.`;
    });
  }
}
