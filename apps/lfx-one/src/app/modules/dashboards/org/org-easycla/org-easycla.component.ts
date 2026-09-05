// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { AccountContextService } from '@services/account-context.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
import { SkeletonModule } from 'primeng/skeleton';

@Component({
  selector: 'lfx-org-easycla',
  imports: [EmptyStateComponent, OpenIntercomDirective, SkeletonModule],
  templateUrl: './org-easycla.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly orgNavigation = inject(OrgNavigationService);

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');

  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount()?.uid);

  /**
   * True once both grant fetches have returned and the caller holds no org access. The route guard
   * only checks the dark-launch flag, so without this an unauthorized deep link would be told
   * "No CLAs signed yet" — a statement about their CLAs rather than about their access.
   *
   * Shares `hasOrgSelectorAccess` with the sidebar org-selector so the two cannot drift, and waits
   * on `personaLoaded()` as well: for users whose orgs arrive only via the async personas response,
   * role grants can return empty first and flash the no-access message. See
   * `org-overview.component.ts` for the full reasoning.
   */
  protected readonly hasNoOrgAccess: Signal<boolean> = computed(
    () => this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded() && !this.accountContext.hasOrgSelectorAccess()
  );

  /**
   * No-access is a settled answer in its own right, so it does not wait behind the loading branch.
   *
   * `orgNavigation.loaded()` is part of the authorized branch because grants and personas can both
   * be loaded while the org list is still being fetched and default-selected — for a direct
   * writer/auditor whose persona payload carries no organization seed, and for LF staff, who
   * satisfy `hasOrgSelectorAccess` with an empty account list. Without it those users would see a
   * settled answer about their CLAs before any company was selected.
   */
  protected readonly orgContextLoaded: Signal<boolean> = computed(
    () => this.hasNoOrgAccess() || (this.orgNavigation.loaded() && this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded())
  );
}
