// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, PLATFORM_ID, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ORG_CLA_ACTIVITY_LOG_COLUMN_HEADERS,
  ORG_CLA_RECENT_ACTIVITY_HEADING,
  ORG_CLA_RECENT_ACTIVITY_PAGE_SIZE,
  ORG_CLA_RECENT_ACTIVITY_VIEW_ALL_LABEL,
} from '@lfx-one/shared/constants';
import type { OrgClaActivityLogDisplayRow, OrgClaGroup, OrgClaRecentActivityState } from '@lfx-one/shared/interfaces';
import { toOrgClaActivityLogDisplayRow } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';

@Component({
  selector: 'lfx-org-easycla-recent-activity',
  imports: [SkeletonModule],
  templateUrl: './org-easycla-recent-activity.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class OrgEasyclaRecentActivityComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly claService = inject(OrgLensClaService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  public readonly claGroup = input.required<OrgClaGroup>();
  public readonly viewFullActivityLog = output<void>();

  protected readonly heading = ORG_CLA_RECENT_ACTIVITY_HEADING;
  protected readonly viewAllLabel = ORG_CLA_RECENT_ACTIVITY_VIEW_ALL_LABEL;
  protected readonly columnHeaders = ORG_CLA_ACTIVITY_LOG_COLUMN_HEADERS;
  protected readonly loadingRows = Array.from({ length: ORG_CLA_RECENT_ACTIVITY_PAGE_SIZE }, (_, index) => index);

  private readonly target = computed(() => this.initTarget());
  private readonly state = this.initState();

  protected readonly loading = computed(() => this.state().status === 'loading');
  protected readonly rows = computed(() => this.initRows());

  private initTarget(): { orgUid: string; signatureId: string } | null {
    const group = this.claGroup();
    const orgUid = this.accountContext.selectedAccount()?.uid ?? '';
    return this.isBrowser && group.signed && orgUid && group.id ? { orgUid, signatureId: group.id } : null;
  }

  private initState(): Signal<OrgClaRecentActivityState> {
    return toSignal(
      toObservable(this.target).pipe(
        distinctUntilChanged((a, b) => a?.orgUid === b?.orgUid && a?.signatureId === b?.signatureId),
        switchMap((target) => {
          if (!target) return of<OrgClaRecentActivityState>({ status: 'idle' });
          return this.claService.getActivityLog(target.orgUid, target.signatureId, { pageSize: ORG_CLA_RECENT_ACTIVITY_PAGE_SIZE }).pipe(
            map(
              (page): OrgClaRecentActivityState => ({
                status: 'loaded',
                rows: page.list.slice(0, ORG_CLA_RECENT_ACTIVITY_PAGE_SIZE).map((entry) => toOrgClaActivityLogDisplayRow(entry)),
              })
            ),
            catchError((error: unknown) => {
              const httpError = error instanceof HttpErrorResponse ? error : null;
              console.warn('Failed to load recent activity:', httpError?.status ?? 'unknown', httpError?.message ?? String(error));
              return of<OrgClaRecentActivityState>({ status: 'failed' });
            }),
            startWith<OrgClaRecentActivityState>({ status: 'loading' })
          );
        })
      ),
      { initialValue: { status: 'idle' } as OrgClaRecentActivityState }
    );
  }

  private initRows(): OrgClaActivityLogDisplayRow[] {
    const state = this.state();
    return state.status === 'loaded' ? state.rows : [];
  }
}
