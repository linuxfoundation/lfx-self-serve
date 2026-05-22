// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { SkeletonModule } from 'primeng/skeleton';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensFoundationsService } from '@services/org-lens-foundations.service';
import { PlausibleService } from '@services/plausible.service';
import { catchError, combineLatest, map, of, skip, startWith, switchMap, tap } from 'rxjs';

import { ORG_LENS_FOUNDATIONS_EMPTY_RESPONSE, ORG_LENS_FOUNDATIONS_INITIAL_STATE } from '@lfx-one/shared/constants';
import type { OrgLensFoundationRow, OrgLensFoundationsAndProjectsResponse, OrgLensFoundationsSectionState } from '@lfx-one/shared/interfaces';

import { FoundationRowComponent } from './components/foundation-row.component';
import { FoundationsStatStripComponent } from './components/foundations-stat-strip.component';

/** Parent for Org Lens "Foundations and Projects" — owns fetch keyed on selected org, status signal, row expansion, retry, and first-render telemetry. */
@Component({
  selector: 'lfx-org-overview-foundations-and-projects',
  imports: [DecimalPipe, FoundationRowComponent, FoundationsStatStripComponent, RouterLink, SkeletonModule],
  templateUrl: './org-overview-foundations-and-projects.component.html',
  styleUrls: ['./org-overview-foundations-and-projects.component.scss'],
})
export class OrgOverviewFoundationsAndProjectsComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly foundationsService = inject(OrgLensFoundationsService);
  private readonly plausibleService = inject(PlausibleService);
  private readonly router = inject(Router);

  private readonly retryTrigger = signal(0);
  private readonly expansionState = signal<Record<string, boolean>>({});
  private readonly viewedOrgs = new Set<string>();

  protected readonly companyName = computed<string>(() => this.accountContextService.selectedAccount().accountName || 'Your Organization');

  private readonly accountId$ = toObservable(this.accountContextService.selectedAccount).pipe(map((account) => account.accountId));
  private readonly retryTrigger$ = toObservable(this.retryTrigger);

  /** Combined stream: re-fetches on selected-account change OR retry tick. `retryTrigger$` is signal-backed and emits its current value on subscribe, so no `startWith(0)` needed. */
  private readonly state = toSignal(
    combineLatest([this.accountId$, this.retryTrigger$]).pipe(
      switchMap(([accountId]) => {
        if (!accountId) {
          return of<OrgLensFoundationsSectionState>({ status: 'empty', data: ORG_LENS_FOUNDATIONS_EMPTY_RESPONSE });
        }
        return this.foundationsService.getFoundationsAndProjects(accountId).pipe(
          map<OrgLensFoundationsAndProjectsResponse, OrgLensFoundationsSectionState>((data) => ({
            status: data.rows.length === 0 ? 'empty' : 'ready',
            data,
          })),
          startWith<OrgLensFoundationsSectionState>({ status: 'loading', data: null }),
          catchError(() => of<OrgLensFoundationsSectionState>({ status: 'error', data: null })),
          tap((s) => {
            if (s.status === 'ready' || s.status === 'empty') {
              this.emitOverviewViewOnce(accountId);
            }
          })
        );
      })
    ),
    { initialValue: ORG_LENS_FOUNDATIONS_INITIAL_STATE }
  );

  protected readonly loading = computed(() => this.state().status === 'loading');
  protected readonly error = computed(() => this.state().status === 'error');
  protected readonly isEmpty = computed(() => this.state().status === 'empty');
  protected readonly statStrip = computed(() => (this.state().data ?? ORG_LENS_FOUNDATIONS_EMPTY_RESPONSE).statStrip);
  protected readonly rows = computed<OrgLensFoundationRow[]>(() => (this.state().data ?? ORG_LENS_FOUNDATIONS_EMPTY_RESPONSE).rows);

  /** Boolean lookup map for the template — avoids isExpanded() method call in bindings. */
  protected readonly expansionMap = computed(() => this.expansionState());

  public constructor() {
    // Reset row expansion whenever the selected account actually changes (skip the initial emission so the empty map isn't overwritten on first mount).
    toObservable(this.accountContextService.selectedAccount)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.expansionState.set({});
      });
  }

  protected toggleExpansion(foundationId: string): void {
    this.expansionState.update((state) => {
      const next = { ...state };
      if (next[foundationId]) {
        delete next[foundationId];
      } else {
        next[foundationId] = true;
      }
      return next;
    });
  }

  protected retry(): void {
    this.retryTrigger.update((n) => n + 1);
  }

  protected onRowClick(payload: { foundationName: string; isMember: boolean }): void {
    const orgId = this.accountContextService.selectedAccount().accountId;
    this.plausibleService.trackEvent('mfp_row_click', {
      orgId,
      foundationName: payload.foundationName,
      isMember: payload.isMember,
    });
  }

  protected onCaretToggle(payload: { foundationName: string; expanded: boolean }): void {
    const orgId = this.accountContextService.selectedAccount().accountId;
    this.plausibleService.trackEvent('mfp_caret_toggle', {
      orgId,
      foundationName: payload.foundationName,
      expanded: payload.expanded,
    });
  }

  protected onProjectClick(payload: { projectId: string; projectName: string }): void {
    const orgId = this.accountContextService.selectedAccount().accountId;
    this.plausibleService.trackEvent('mfp_project_row_click', {
      orgId,
      projectId: payload.projectId,
      projectName: payload.projectName,
    });
  }

  protected onProjectRowClick(project: OrgLensFoundationRow['projects'][number]): void {
    // LF project-row clicks route to `/org/projects` (placeholder until the slug-aware drilldown lands); non-LF rows stay no-ops.
    if (!project.isLfProject) return;
    this.onProjectClick({ projectId: project.projectId, projectName: project.projectName });
    void this.router.navigate(['/org/projects']);
  }

  protected onProjectRowKeydown(event: KeyboardEvent, project: OrgLensFoundationRow['projects'][number]): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!project.isLfProject) return;
    event.preventDefault();
    this.onProjectRowClick(project);
  }

  private emitOverviewViewOnce(accountId: string): void {
    if (this.viewedOrgs.has(accountId)) return;
    this.viewedOrgs.add(accountId);
    this.plausibleService.trackEvent('overview_view', { orgId: accountId });
  }
}
