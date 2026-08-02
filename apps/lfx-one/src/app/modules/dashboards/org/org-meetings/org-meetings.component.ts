// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { ORG_MEETINGS_DEFAULT_TIME_RANGE, ORG_MEETINGS_TIME_RANGES } from '@lfx-one/shared/constants';
import type { OrgMeetingsSupportedTimeRange, OrgMeetingsTimeRange } from '@lfx-one/shared/interfaces';
import { isSupportedOrgMeetingsTimeRange } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { SkeletonModule } from 'primeng/skeleton';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';

import { OrgMeetingsInfluenceComponent } from './components/org-meetings-influence/org-meetings-influence.component';
import { OrgMeetingsKpiCardsComponent } from './components/org-meetings-kpi-cards/org-meetings-kpi-cards.component';
import { OrgMeetingsSpendBreakdownComponent } from './components/org-meetings-spend-breakdown/org-meetings-spend-breakdown.component';
import { OrgMeetingsTimeRangeComponent } from './components/org-meetings-time-range/org-meetings-time-range.component';

// The employee leaderboard is a per-person surface and needs its own privacy review plus a real
// backend before it can render; it ships in a follow-up rather than sitting here unreferenced.

// This page was previously retired to a "coming soon" placeholder (LFXV2-1902 / ADR-0038) after the
// legacy implementation served per-invitee PII from the analytics lane without an operational-plane
// check. The sections below now read real analytics, but only organization-level aggregates: the
// endpoints expose no person, attendee, or meeting identifier, and each one gates on the caller's
// org grant before reading anything.
@Component({
  selector: 'lfx-org-meetings',
  imports: [
    OrgMeetingsTimeRangeComponent,
    OrgMeetingsKpiCardsComponent,
    OrgMeetingsSpendBreakdownComponent,
    OrgMeetingsInfluenceComponent,
    EmptyStateComponent,
    SkeletonModule,
  ],
  templateUrl: './org-meetings.component.html',
})
export class OrgMeetingsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);

  // Simple WritableSignals
  // The dropdown's model spans all nine ranges; only the seven the warehouse is built for are
  // selectable (the rest are disabled below and rejected by the endpoints).
  protected readonly timeRange = signal<OrgMeetingsTimeRange>(ORG_MEETINGS_DEFAULT_TIME_RANGE);

  // Configuration
  protected readonly unsupportedTimeRanges: OrgMeetingsTimeRange[] = ORG_MEETINGS_TIME_RANGES.filter((range) => !isSupportedOrgMeetingsTimeRange(range));

  // Complex computed
  // True once role grants + personas have settled and the caller genuinely has no org access —
  // mirrors org-overview/org-projects' `hasNoOrgAccess`. Reused below so a direct writer/auditor
  // with no persona-seeded organizations (who never triggers the nav fetch) isn't stuck waiting
  // on `orgNavigationService.loaded()` forever.
  protected readonly hasNoOrgAccess: Signal<boolean> = computed(
    () => this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded() && !this.accountContext.hasOrgSelectorAccess()
  );

  // True once every fetch that can populate `selectedAccount` has settled — either the caller
  // has no org access (short-circuits without waiting on nav), or role grants + personas +
  // org-navigation's default-org selection have all returned. Without waiting on org-navigation
  // too, a direct writer/auditor whose persona response has no organizations could see a one-tick
  // flash of the no-company empty state before `/api/nav/org-items` populates `selectedAccount`.
  // Mirrors org-projects.component.ts's `orgContextLoaded` gate.
  protected readonly loaded: Signal<boolean> = computed(
    () => this.hasNoOrgAccess() || (this.orgNavigationService.loaded() && this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded())
  );

  // Either identifier counts as "selected": a fresh persona seed can have `uid` but an empty
  // `accountId` pending Snowflake enrichment, while a cookie-restored stub (account-context.service.ts)
  // can have `uid` set with `accountId` still empty. Checking only one leaves a validly-selected
  // company on the empty state, per the same gate in org-overview.component.ts.
  protected readonly hasCompany: Signal<boolean> = computed(
    () => !!this.accountContext.selectedAccount().uid || !!this.accountContext.selectedAccount().accountId
  );

  // Every section keys off the analytics account id, not the uid. A cookie-restored selection can
  // carry a uid with the accountId still pending, and the canonical-record fetch that resolves it
  // fails silently by design — so once the org context has settled without one, the sections would
  // otherwise sit on their loading skeletons indefinitely with nothing on screen to say why.
  protected readonly hasAnalyticsId: Signal<boolean> = computed(() => !!this.accountContext.selectedAccount().accountId);

  // Children take the narrowed range, so "only a served window reaches the endpoint" is enforced by
  // the type rather than by the dropdown alone. The fallback is unreachable while the unsupported
  // options stay disabled, and exists so a future dropdown regression degrades to the default window
  // instead of a 400.
  protected readonly servedTimeRange: Signal<OrgMeetingsSupportedTimeRange> = computed(() => {
    const range = this.timeRange();
    return isSupportedOrgMeetingsTimeRange(range) ? range : ORG_MEETINGS_DEFAULT_TIME_RANGE;
  });
}
