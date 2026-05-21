// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { SkeletonModule } from 'primeng/skeleton';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensFoundationsService } from '@services/org-lens-foundations.service';
import { PlausibleService } from '@services/plausible.service';
import { catchError, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';

import type { OrgLensFoundationRow, OrgLensFoundationsAndProjectsResponse } from '@lfx-one/shared/interfaces';

import { FoundationRowComponent } from './components/foundation-row.component';
import { FoundationsStatStripComponent } from './components/foundations-stat-strip.component';

interface SectionState {
  status: 'loading' | 'error' | 'ready' | 'empty';
  data: OrgLensFoundationsAndProjectsResponse | null;
}

const EMPTY_RESPONSE: OrgLensFoundationsAndProjectsResponse = {
  accountId: '',
  accountName: '',
  statStrip: {
    foundations: { total: 0, breakdown: {} },
    projects: { total: 0, leading: 0, contributing: 0, participating: 0, silent: 0 },
    governanceRoles: { total: 0, boardMembers: 0, committeeMembers: 0 },
    meetingsThisWeek: { total: 0, board: 0, technical: 0, marketing: 0, workingGroup: 0, other: 0 },
  },
  rows: [],
};

const INITIAL_STATE: SectionState = { status: 'loading', data: null };

/**
 * Parent component for the Org Lens "Foundations and Projects" section.
 *
 * Owns:
 * - Data fetch keyed on the selected org id (re-fetch on switch).
 * - Loading / error / ready / empty status signal.
 * - Row expansion state cleared on org switch.
 * - Retry trigger.
 * - First-render telemetry per org (`overview_view` Plausible event).
 *
 * Renders:
 * - Section header with org name + "View all on Memberships page ›" link.
 * - 4-tile stat strip (FoundationsStatStripComponent).
 * - Foundations table with per-row FoundationRowComponent + inline-detail expansion.
 * - Loading skeletons / retry affordance / empty caption.
 */
@Component({
  selector: 'lfx-org-overview-foundations-and-projects',
  imports: [FoundationRowComponent, FoundationsStatStripComponent, RouterLink, SkeletonModule, TableModule],
  templateUrl: './org-overview-foundations-and-projects.component.html',
  styleUrls: ['./org-overview-foundations-and-projects.component.scss'],
})
export class OrgOverviewFoundationsAndProjectsComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly foundationsService = inject(OrgLensFoundationsService);
  private readonly plausibleService = inject(PlausibleService);
  private readonly router = inject(Router);

  protected readonly companyName = computed<string>(() => this.accountContextService.selectedAccount().accountName || 'Your Organization');

  private readonly retryTrigger = signal(0);

  private readonly accountId$ = toObservable(this.accountContextService.selectedAccount).pipe(map((account) => account.accountId));
  private readonly retryTrigger$ = toObservable(this.retryTrigger);

  /**
   * Combined stream: re-fetches when the selected account changes OR
   * when the retry trigger ticks. `combineLatest` ensures both feed in;
   * `startWith` primes the retry stream so the first emission fires on
   * mount.
   */
  private readonly state = toSignal(
    combineLatest([this.accountId$, this.retryTrigger$.pipe(startWith(0))]).pipe(
      switchMap(([accountId]) => {
        if (!accountId) {
          return of<SectionState>({ status: 'empty', data: EMPTY_RESPONSE });
        }
        return this.foundationsService.getFoundationsAndProjects(accountId).pipe(
          map<OrgLensFoundationsAndProjectsResponse, SectionState>((data) => ({
            status: data.rows.length === 0 ? 'empty' : 'ready',
            data,
          })),
          startWith<SectionState>({ status: 'loading', data: null }),
          catchError(() => of<SectionState>({ status: 'error', data: null })),
          tap((s) => {
            if (s.status === 'ready' || s.status === 'empty') {
              this.emitOverviewViewOnce(accountId);
            }
          })
        );
      })
    ),
    { initialValue: INITIAL_STATE }
  );

  protected readonly loading = computed(() => this.state().status === 'loading');
  protected readonly error = computed(() => this.state().status === 'error');
  protected readonly statStrip = computed(() => (this.state().data ?? EMPTY_RESPONSE).statStrip);
  protected readonly rows = computed<OrgLensFoundationRow[]>(() => (this.state().data ?? EMPTY_RESPONSE).rows);
  protected readonly isEmpty = computed(() => this.state().status === 'empty');

  // Per-row expansion state. Cleared whenever the selected account
  // changes so previous-org expansions never leak into a new org.
  private readonly expansionState = signal<Record<string, boolean>>({});

  /** Telemetry de-dupe: emit `overview_view` once per org per session. */
  private readonly viewedOrgs = new Set<string>();

  public constructor() {
    effect(() => {
      // Re-read selectedAccount so this effect re-runs on every change.
      this.accountContextService.selectedAccount();
      this.expansionState.set({});
    });
  }

  protected isExpanded(foundationId: string): boolean {
    return this.expansionState()[foundationId] === true;
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

  protected influenceDotClasses(influence: OrgLensFoundationRow['projects'][number]['influence']): string {
    switch (influence) {
      case 'Leading':
        return 'bg-emerald-700';
      case 'Contributing':
        return 'bg-blue-500';
      case 'Participating':
        return 'bg-amber-500';
      case 'Silent':
      default:
        return 'bg-gray-400';
    }
  }

  protected projectSlugTestId(slug: string | null | undefined, projectId: string): string {
    return slug && slug.length > 0 ? slug : projectId;
  }

  protected onProjectRowClick(project: OrgLensFoundationRow['projects'][number]): void {
    // LF project-row clicks route to `/org/projects` (no slug, no
    // ProjectContext mutation, no lens switch) until the slug-aware
    // per-project drilldown destination lands as a follow-on feature.
    // Keeping the user inside the Org Lens is intentional — switching
    // them out via `lensService.setLens('project')` on a row click was
    // jarring. Non-LF rows (under the Outside-LF umbrella) remain
    // intentional no-ops (category mismatch with /org/projects).
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
