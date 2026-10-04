// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { SkeletonModule } from 'primeng/skeleton';

import { OrgOverviewFoundationsAndProjectsComponent } from '../components/org-overview-foundations-and-projects/org-overview-foundations-and-projects.component';
import { OrgOverviewInvolvementComponent } from '../components/org-overview-involvement/org-overview-involvement.component';

@Component({
  selector: 'lfx-org-overview',
  imports: [
    TagComponent,
    SkeletonModule,
    OpenIntercomDirective,
    OrgLensEmptyStateComponent,
    OrgOverviewInvolvementComponent,
    OrgOverviewFoundationsAndProjectsComponent,
  ],
  templateUrl: './org-overview.component.html',
})
export class OrgOverviewComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  protected readonly emptyState = inject(OrgLensEmptyStateService);

  protected readonly selectedAccount = this.accountContextService.selectedAccount;

  protected readonly companyName: Signal<string> = computed(() => this.selectedAccount().accountName || 'Your Organization');

  protected readonly tierLabel: Signal<string | null> = computed(() => this.selectedAccount().membershipTier || null);

  /**
   * Page is "loaded" once the org list has answered and the empty-state classifier has settled (its
   * `settled` covers the role-grants and persona loads). Prevents an FOEC race: before this, the
   * skeleton — never a state, never the legacy invite-status prompt.
   */
  protected readonly loaded: Signal<boolean> = computed(() => this.emptyState.pageReady());

  /** True ONLY after both dependencies have completed their initial load and the user genuinely has no selectable org. Drives the empty-state render. */
  protected readonly isEmpty: Signal<boolean> = computed(
    () => this.loaded() && this.orgNavigationService.items().length === 0 && !this.selectedAccount().uid && !this.selectedAccount().accountId
  );

  /**
   * Splits the empty state by caller. For LF-team callers an empty list is the expected starting point, not a
   * missing invitation: they reach organizations through switcher search, so the invite-status copy
   * would send them to their admin over something working as designed.
   */
  protected readonly isStaff: Signal<boolean> = this.orgRoleGrantsService.isStaff;

  /**
   * Spec 053 — the page-level state replacing the page (`could-not-load`, `staff-check-failed`,
   * `no-organization`), or `null` when the page itself renders. Decided by the shared classifier so
   * this gate cannot drift from the other Org Lens pages or from the sidebar org-selector rule.
   */
  protected readonly pageState = this.emptyState.pageState;
  protected readonly hasPageState = this.emptyState.hasPageState;
  protected readonly correlationId: Signal<string | null> = this.orgRoleGrantsService.correlationId;
}
