// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BEHAVIORAL_CLASS_CONFIG, COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import type { GroupBehavioralClass, OrgLensGroupSummary, OrgLensGroupsResponse, OrgLensGroupVm } from '@lfx-one/shared/interfaces';
import { getGroupBehavioralClass } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, of, switchMap } from 'rxjs';

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

  protected readonly hasCompany: Signal<boolean> = computed(
    () => !!this.accountContext.selectedAccount().uid || !!this.accountContext.selectedAccount().accountId
  );

  protected readonly hasAnalyticsId: Signal<boolean> = computed(() => !!this.accountContext.selectedAccount().accountId);

  // ── Data ──────────────────────────────────────────────────────────────────
  protected readonly groupsLoading = computed(() => this.hasAnalyticsId() && this.groupsData() === undefined);

  private readonly groupsData: Signal<OrgLensGroupsResponse | null | undefined> = toSignal(
    toObservable(computed(() => this.accountContext.selectedAccount().accountId)).pipe(
      filter((id): id is string => !!id),
      distinctUntilChanged(),
      switchMap((id) => this.groupsService.getGroups(id).pipe(catchError(() => of(null)))),
      takeUntilDestroyed()
    )
  );

  protected readonly groups: Signal<OrgLensGroupSummary[]> = computed(() => this.groupsData()?.groups ?? []);
  protected readonly groupsWithClass: Signal<OrgLensGroupVm[]> = computed(() => this.groups().map((g) => ({ ...g, cls: getGroupBehavioralClass(g.category) })));
  protected readonly totalGroups: Signal<number> = computed(() => this.groupsData()?.total_groups ?? 0);
  protected readonly totalSeats: Signal<number> = computed(() => this.groupsData()?.total_seats ?? 0);

  protected readonly behavioralClassCounts: Signal<Record<GroupBehavioralClass, number>> = computed(() => {
    const counts: Record<GroupBehavioralClass, number> = {
      'governing-board': 0,
      'oversight-committee': 0,
      'working-group': 0,
      'special-interest-group': 0,
      'ambassador-program': 0,
      other: 0,
    };
    for (const g of this.groups()) {
      const cls = getGroupBehavioralClass(g.category);
      counts[cls]++;
    }
    return counts;
  });
}
