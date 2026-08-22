// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BEHAVIORAL_CLASS_CONFIG, COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import type { GroupBehavioralClass, OrgLensGroupSummary, OrgLensGroupsResponse, OrgLensGroupVm } from '@lfx-one/shared/interfaces';
import { getGroupBehavioralClass } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, of, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensGroupsService } from '@services/org-lens-groups.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';

@Component({
  selector: 'lfx-org-groups',
  imports: [EmptyStateComponent, RouterLink, SkeletonModule, TagComponent],
  templateUrl: './org-groups.component.html',
})
export class OrgGroupsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly groupsService = inject(OrgLensGroupsService);

  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly behavioralClassConfig = BEHAVIORAL_CLASS_CONFIG;

  // ── Auth / access guards (mirrors org-meetings pattern) ───────────────────
  protected readonly hasNoOrgAccess: Signal<boolean> = computed(
    () => this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded() && !this.accountContext.hasOrgSelectorAccess()
  );

  protected readonly loaded: Signal<boolean> = computed(
    () => this.hasNoOrgAccess() || (this.orgNavigationService.loaded() && this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded())
  );

  // Committee-service B2B endpoints are scoped by org uid, not the Snowflake accountId — mirrors
  // org-people/committee-members. Gate and fetch key both use uid.
  protected readonly hasCompany: Signal<boolean> = computed(() => !!this.accountContext.selectedAccount().uid);

  // ── Data ──────────────────────────────────────────────────────────────────
  protected readonly fetchError = signal(false);
  private readonly groupsLoadingState = signal(false);
  // Loading: initial (undefined) OR explicit flag set during org-switch (null stays after an error,
  // so groupsData() === undefined alone would miss the reload-after-error skeleton).
  protected readonly groupsLoading = computed(() => this.hasCompany() && (this.groupsData() === undefined || this.groupsLoadingState()));

  private readonly groupsData: Signal<OrgLensGroupsResponse | null | undefined> = this.initGroupsData();

  protected readonly groups: Signal<OrgLensGroupSummary[]> = computed(() => this.groupsData()?.groups ?? []);
  protected readonly groupsWithClass: Signal<OrgLensGroupVm[]> = this.initGroupsWithClass();
  protected readonly totalGroups: Signal<number> = computed(() => this.groupsData()?.total_groups ?? 0);
  protected readonly totalSeats: Signal<number> = computed(() => this.groupsData()?.total_seats ?? 0);

  protected readonly behavioralClassCounts: Signal<Record<GroupBehavioralClass, number>> = this.initBehavioralClassCounts();

  private initGroupsData(): Signal<OrgLensGroupsResponse | null | undefined> {
    return toSignal(
      toObservable(computed(() => this.accountContext.selectedAccount().uid)).pipe(
        filter((id): id is string => !!id),
        distinctUntilChanged(),
        tap(() => {
          this.groupsLoadingState.set(true);
          this.fetchError.set(false);
        }),
        switchMap((id) =>
          this.groupsService.getGroups(id).pipe(
            tap(() => this.groupsLoadingState.set(false)),
            catchError(() => {
              this.fetchError.set(true);
              this.groupsLoadingState.set(false);
              return of(null);
            })
          )
        ),
        takeUntilDestroyed()
      )
    );
  }

  private initGroupsWithClass(): Signal<OrgLensGroupVm[]> {
    return computed(() =>
      this.groups().map((g) => {
        const cls = getGroupBehavioralClass(g.category);
        const projectLabel = g.project_name || g.project_slug || '';
        const ariaLabel = `${g.name}, ${BEHAVIORAL_CLASS_CONFIG[cls].label}, ${g.org_seat_count} seats` + (projectLabel ? `, ${projectLabel}` : '');
        // Routes to /org/memberships/:slug, not /org/projects/:slug — the org-projects page is
        // Snowflake/CDP-scoped to sub-project activity rows and doesn't resolve foundation-level
        // slugs (verified live: /org/projects/uepf 404s, /org/memberships/uepf works). Wording
        // matches org-memberships.component.html's own membership rows.
        const projectAriaLabel = projectLabel ? `View ${projectLabel} membership details` : '';
        return { ...g, cls, projectLabel, ariaLabel, projectAriaLabel };
      })
    );
  }

  private initBehavioralClassCounts(): Signal<Record<GroupBehavioralClass, number>> {
    return computed(() => {
      const counts: Record<GroupBehavioralClass, number> = {
        'governing-board': 0,
        'oversight-committee': 0,
        'working-group': 0,
        'special-interest-group': 0,
        'ambassador-program': 0,
        other: 0,
      };
      for (const g of this.groupsWithClass()) {
        counts[g.cls]++;
      }
      return counts;
    });
  }
}
