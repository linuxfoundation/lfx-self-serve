// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { OrgMembershipAgreement, OrgMembershipCertificateTemplate, OrgMembershipDocumentsResponse } from '@lfx-one/shared/interfaces';
import { TooltipModule } from 'primeng/tooltip';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import { catchError, combineLatest, filter, of, switchMap, tap } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';

import { buildAgreementsCsv } from './documentation-tab.utils';

type PageState = 'loading' | 'error' | 'ready';

@Component({
  selector: 'lfx-documentation-tab',
  standalone: true,
  imports: [CardComponent, EmptyStateComponent, TooltipModule],
  templateUrl: './documentation-tab.component.html',
})
export class DocumentationTabComponent {
  // 1. Private injections
  private readonly service = inject(OrgLensMembershipsService);
  private readonly platformId = inject(PLATFORM_ID);

  // 2. Public fields from inputs
  public readonly accountId = input.required<string>();
  public readonly foundationId = input.required<string>();

  /** CSV export "Organization" column (FR-032a col 1). */
  public readonly orgName = input.required<string>();

  /** CSV export "Foundation" column (FR-032a col 2). */
  public readonly foundationName = input.required<string>();

  /** CSV filename slug; falls back to sanitized foundationId when null (FR-034a). */
  public readonly foundationSlug = input<string | null>(null);

  // 5. Simple WritableSignals
  protected readonly retryTrigger = signal(0);
  protected readonly fetchLoading = signal(true);
  protected readonly fetchError = signal(false);
  protected readonly agreements = signal<OrgMembershipAgreement[]>([]);

  // 6. Complex computed/toSignal — declared via private init functions where pipelines are non-trivial
  /** View-model: agreements with the signed date pre-formatted so the template stays pure. */
  protected readonly displayAgreements = computed(() =>
    this.agreements().map((agreement) => ({
      ...agreement,
      formattedSignedDate: this.formatSignedDate(agreement.signedDate),
    }))
  );

  protected readonly docsData: Signal<OrgMembershipDocumentsResponse | null> = this.initDocsData();

  protected readonly pageState = computed<PageState>(() => {
    if (this.fetchLoading()) return 'loading';
    if (this.fetchError()) return 'error';
    if (!this.docsData()) return 'loading';
    return 'ready';
  });

  /** Null when org has no active TLF Corporate Membership or cert query degraded (FR-010a). */
  protected readonly certificateTemplate = computed<OrgMembershipCertificateTemplate | null>(() => this.docsData()?.certificateTemplate ?? null);

  // 9. Protected methods
  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  /** Client-side CSV download of all displayed agreements; no-ops when list is empty (FR-033). */
  protected onDownloadAll(): void {
    // SSR guard: Blob/URL/document are browser-only globals.
    if (!isPlatformBrowser(this.platformId)) return;

    const rows = this.displayAgreements();
    if (!rows.length) return;

    const csv = buildAgreementsCsv(rows, this.orgName(), this.foundationName());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const slug = this.foundationSlug() ?? this.sanitizedFoundationIdForFilename();
    const filename = `membership-agreements-${slug}-${yyyymmdd}.csv`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 10. Private initializer functions (grouped)
  private initDocsData(): Signal<OrgMembershipDocumentsResponse | null> {
    const accountId$ = toObservable(this.accountId);
    const foundationId$ = toObservable(this.foundationId);
    const retryTrigger$ = toObservable(this.retryTrigger);

    const docs$ = combineLatest([
      accountId$.pipe(filter((id): id is string => !!id)),
      foundationId$.pipe(filter((id): id is string => !!id)),
      retryTrigger$,
    ]).pipe(
      tap(() => {
        this.fetchLoading.set(true);
        this.fetchError.set(false);
      }),
      switchMap(([accountId, foundationId]) =>
        this.service.getMembershipDocuments(accountId, foundationId).pipe(
          catchError(() => {
            this.fetchError.set(true);
            this.fetchLoading.set(false);
            return of(null);
          })
        )
      ),
      tap((response) => {
        this.fetchLoading.set(false);
        if (response) {
          this.agreements.set(response.agreements);
        }
      })
    );

    return toSignal<OrgMembershipDocumentsResponse | null>(docs$, { initialValue: null });
  }

  // 11. Other private helpers
  private sanitizedFoundationIdForFilename(): string {
    return this.foundationId()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
  }

  private formatSignedDate(dateString: string): string {
    if (!dateString) return '—';
    try {
      return parseLocalDateString(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  }
}
