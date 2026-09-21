// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ORG_LENS_ENABLED_FLAG, OrgLensEmptyStateName } from '@lfx-one/shared/constants';
import { Account } from '@lfx-one/shared/interfaces';
import { orgUrlSegment } from '@lfx-one/shared/utils';
import { ButtonComponent } from '@components/button/button.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { SkeletonModule } from 'primeng/skeleton';

/**
 * Org Lens dead end (spec 050 US4, FR-022/FR-022a; spec 053 FR-007/FR-008): the address named an
 * organization that does not exist, that the viewer cannot read, or that Org Lens cannot serve right
 * now. Reads nothing about the address — no route params, no HTTP — so nothing here can tell
 * "unknown" from "no access" (DR-002) or leak the organization behind the address.
 *
 * What it does read is the caller's OWN list: a caller who holds at least one organization sees the
 * wrong-organization state with that list as the way out (FR-008); a caller who holds none sees the
 * no-access state (FR-007). Both keep the wording on "this organization".
 */
@Component({
  selector: 'lfx-org-not-found',
  imports: [RouterLink, ButtonComponent, OrgLensEmptyStateComponent, SkeletonModule],
  templateUrl: './org-not-found.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgNotFoundComponent {
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);
  private readonly emptyState = inject(OrgLensEmptyStateService);
  private readonly featureFlags = inject(FeatureFlagService);

  /** Spec 050 US5: the same dead end also serves a viewer for whom Org Lens is switched off; their switcher never loads a list. */
  private readonly orgLensEnabled: Signal<boolean> = this.featureFlags.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false);

  /**
   * Both bootstrap loads have answered, and — when the caller can see the switcher at all — its list
   * has too. Two callers never trigger the list fetch and must not be held on the skeleton for it: one
   * without switcher access, and one for whom Org Lens is disabled (the selector is never enabled).
   */
  protected readonly settled: Signal<boolean> = computed(
    () => this.emptyState.settled() && (!this.orgLensEnabled() || !this.accountContext.hasOrgSelectorAccess() || this.orgNavigation.loaded())
  );

  /** The caller's own held organizations — the same access-filtered rows the switcher shows. */
  protected readonly orgList: Signal<{ uid: string; name: string }[]> = computed(() =>
    this.orgNavigation.items().map((item) => ({ uid: item.uid, name: item.name }))
  );

  /**
   * Spec 050 US5: Org Lens switched off for this viewer — the static, cause-blind dead end, no list
   * and no registry state (an access-themed wording would imply an administrator could help).
   */
  protected readonly orgLensOff: Signal<boolean> = computed(() => !this.orgLensEnabled());

  /**
   * An LF-team caller holds every organization, so an unresolvable address can only mean no such
   * organization or a resolver miss — never "no access" (FR-012; the epic's "never say no access when
   * the truth is a failed lookup"). They get the switcher-search invite, with their own rows beneath
   * when they have any. Otherwise FR-008 when the caller holds something to switch to, FR-007 when not.
   */
  protected readonly state: Signal<OrgLensEmptyStateName> = computed(() => {
    if (this.orgRoleGrants.isStaff()) {
      return 'not-found-staff';
    }
    return this.orgList().length > 0 ? 'wrong-organization' : 'no-access';
  });

  /** Select one of the caller's own organizations and open its overview. */
  protected pick(uid: string): void {
    const item = this.orgNavigation.items().find((row) => row.uid === uid);
    if (!item) {
      return;
    }
    // Same shape the switcher builds on selection: slug and tier are org-specific and arrive with the
    // canonical record, never carried over from the previous selection.
    const account: Account = {
      accountId: item.accountId ?? '',
      accountName: item.name,
      accountSlug: '',
      membershipTier: '',
      logoUrl: item.logoUrl ?? null,
      uid: item.uid,
      slug: item.slug ?? null,
    };
    this.accountContext.setAccount(account);
    this.accountContext.refreshCanonicalRecord(account).catch(() => {
      // Already logged inside refreshCanonicalRecord; the indexed snapshot stays.
    });
    const segment = orgUrlSegment(account);
    this.router.navigate(segment ? ['/org', segment, 'overview'] : ['/org/overview']);
  }
}
