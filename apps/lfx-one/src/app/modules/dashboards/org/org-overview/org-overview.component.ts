// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { SkeletonModule } from 'primeng/skeleton';

import { OrgOverviewFoundationsAndProjectsComponent } from '../components/org-overview-foundations-and-projects/org-overview-foundations-and-projects.component';
import { OrgOverviewInvolvementComponent } from '../components/org-overview-involvement/org-overview-involvement.component';

@Component({
  selector: 'lfx-org-overview',
  imports: [TagComponent, SkeletonModule, OrgOverviewInvolvementComponent, OrgOverviewFoundationsAndProjectsComponent],
  templateUrl: './org-overview.component.html',
})
export class OrgOverviewComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);

  protected readonly selectedAccount = this.accountContextService.selectedAccount;

  protected readonly companyName: Signal<string> = computed(() => this.selectedAccount().accountName || 'Your Organization');

  protected readonly tierLabel: Signal<string | null> = computed(() => this.selectedAccount().membershipTier || null);

  /** Page is "loaded" once BOTH dependencies have returned their first response. Prevents an FOEC race. */
  protected readonly loaded: Signal<boolean> = computed(() => this.orgNavigationService.loaded() && this.orgRoleGrantsService.loaded());

  /** True ONLY after both dependencies have completed their initial load and the user genuinely has no selectable org. Drives the empty-state render. */
  protected readonly isEmpty: Signal<boolean> = computed(
    () => this.loaded() && this.orgNavigationService.items().length === 0 && !this.selectedAccount().uid && !this.selectedAccount().accountId
  );

  /**
   * True once the role-grants fetch has completed and the caller has no org access. Reuses the shared
   * `AccountContextService.hasOrgSelectorAccess` predicate so this gate cannot drift from the sidebar
   * org-selector visibility rule — direct writer/auditor grants or a persona-seeded account count;
   * indirect grants do not (the selector is direct-only, so a user with only indirect access never
   * triggers the selector's list fetch and would otherwise stay on the skeleton forever).
   *
   * "Completed" here means each async request has returned its first response — these are one-shot
   * loads on page init, not eventually-consistent streams. We also wait on the personas fetch: for
   * users whose org seeds arrive only via the async personas response (empty `auth.organizations` at
   * SSR), role grants can return empty before personas seed `availableAccounts`, so gating on
   * `personaLoaded()` prevents a one-tick flash of the not-available message. Both requests always
   * resolve, so this never re-introduces an indefinite skeleton.
   */
  protected readonly hasNoOrgAccess: Signal<boolean> = computed(
    () => this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded() && !this.accountContextService.hasOrgSelectorAccess()
  );
}
