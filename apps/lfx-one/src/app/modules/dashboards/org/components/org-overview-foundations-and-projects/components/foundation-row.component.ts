// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';

import type { OrgLensFoundationRow } from '@lfx-one/shared/interfaces';

import { foundationInitials, foundationLogoSquareClasses } from '../helpers/foundation-logo.helper';
import { tierRibbonClasses } from '../helpers/tier-ribbon.helper';

/** Presentational foundation row — owns the four-cell main `<tr>` (logo + tier ribbon + Org Role / Voting / Governance badges); inline detail lives in a parent-rendered sibling `<tr>`. */
@Component({
  selector: 'lfx-foundation-row',
  imports: [TooltipModule],
  templateUrl: './foundation-row.component.html',
  styleUrls: ['./foundation-row.component.scss'],
})
export class FoundationRowComponent {
  private readonly router = inject(Router);

  public readonly row = input.required<OrgLensFoundationRow>();
  public readonly expanded = input<boolean>(false);
  public readonly index = input<number>(0);

  public readonly toggle = output<void>();
  public readonly rowClick = output<{ foundationName: string; isMember: boolean }>();
  public readonly caretToggle = output<{ foundationName: string; expanded: boolean }>();

  protected readonly governanceHeaderTooltip =
    'Average meeting attendance across governance, working groups, and project meetings. <33% Inactive · 33–66% Partial · >66% Active.';

  protected readonly logoSquareClasses = computed(() => foundationLogoSquareClasses(this.row().foundationId));
  protected readonly initials = computed(() => foundationInitials(this.row().foundationName));
  protected readonly ribbonClasses = computed(() => tierRibbonClasses(this.row().membershipTierClass, this.row().rowKind));
  protected readonly testIdSlug = computed<string>(() => this.row().foundationSlug || this.row().foundationId);

  protected readonly trRole = computed<string | null>(() => (this.row().rowKind === 'outside_lf' ? null : 'button'));
  protected readonly trTabIndex = computed<number | null>(() => (this.row().rowKind === 'outside_lf' ? null : 0));

  /** Always-true today; kept as a signal so the gate can tighten without touching the template. */
  protected readonly showProjectsInvolved = computed<boolean>(() => true);

  protected readonly subtitleText = computed<string>(() => this.initSubtitleText());
  protected readonly projectsInvolvedText = computed<string>(() => this.initProjectsInvolvedText());
  protected readonly chevronAriaLabel = computed<string>(() => this.initChevronAriaLabel());
  protected readonly governanceTooltip = computed<string>(() => this.initGovernanceTooltip());
  protected readonly trClasses = computed<string>(() => this.initTrClasses());

  protected readonly orgRoleClass = computed<string>(() => this.initOrgRoleClass());
  protected readonly votingStatusClass = computed<string>(() => this.initVotingStatusClass());
  protected readonly governanceClass = computed<string>(() => this.initGovernanceClass());

  public onRowClick(event: MouseEvent): void {
    // Skip when the click landed inside an inner button/link so the chevron and any future inline affordances don't double-fire row navigation.
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a')) {
      return;
    }
    const r = this.row();
    if (r.rowKind === 'outside_lf') {
      return;
    }
    this.rowClick.emit({ foundationName: r.foundationName, isMember: r.rowKind === 'member' });
    void this.router.navigate(['/org/memberships']);
  }

  public onRowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Skip when focus is inside an inner button/link so Enter/Space on the chevron toggles expansion without bubbling to row navigation.
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a')) return;
    const r = this.row();
    if (r.rowKind === 'outside_lf') return;
    event.preventDefault();
    this.rowClick.emit({ foundationName: r.foundationName, isMember: r.rowKind === 'member' });
    void this.router.navigate(['/org/memberships']);
  }

  public onChevronClick(event: Event): void {
    event.stopPropagation();
    const nextExpanded = !this.expanded();
    this.toggle.emit();
    this.caretToggle.emit({ foundationName: this.row().foundationName, expanded: nextExpanded });
  }

  private initSubtitleText(): string {
    const r = this.row();
    if (r.rowKind === 'outside_lf') return 'Outside LF';
    if (r.rowKind === 'non_member') return 'Non-member';
    const tier = r.membershipTierClass ?? 'Member';
    return `${tier} Member`;
  }

  private initProjectsInvolvedText(): string {
    const count = this.row().projectCount;
    return `${count} project${count === 1 ? '' : 's'} involved`;
  }

  private initChevronAriaLabel(): string {
    const action = this.expanded() ? 'Collapse' : 'Expand';
    return `${action} ${this.row().foundationName}`;
  }

  private initGovernanceTooltip(): string {
    const pct = this.row().badges.governanceAttendancePct;
    if (pct == null) return '';
    const pctInt = Math.round(pct * 100);
    return `${pctInt}% meeting attendance across governance, working groups, and project meetings`;
  }

  private initTrClasses(): string {
    const base = 'border-b border-gray-200 hover:bg-gray-50 transition-colors';
    return this.row().rowKind === 'outside_lf' ? `${base} cursor-default` : `${base} cursor-pointer`;
  }

  private initOrgRoleClass(): string {
    const badge = this.row().badges.orgRole;
    if (badge === 'Director' || badge === 'Member') {
      return 'bg-blue-100 text-blue-700 border-blue-200';
    }
    return 'bg-white text-gray-600 border-gray-300';
  }

  private initVotingStatusClass(): string {
    const badge = this.row().badges.votingStatus;
    if (badge === 'Voting' || badge === 'Observer') {
      return 'bg-blue-100 text-blue-700 border-blue-200';
    }
    return 'text-gray-400';
  }

  private initGovernanceClass(): string {
    switch (this.row().badges.governanceParticipation) {
      case 'Active':
        return 'bg-emerald-100 text-emerald-700';
      case 'Partial':
        return 'bg-amber-100 text-amber-700';
      case 'Inactive':
        return 'bg-gray-100 text-gray-500';
      case '—':
      default:
        return 'text-gray-400';
    }
  }
}
