// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';

import type { GovernanceParticipationBucket, OrgLensFoundationRow, OrgRoleBadge, VotingStatusBadge } from '@lfx-one/shared/interfaces';

import { foundationInitials, foundationLogoSquareClasses } from '../helpers/foundation-logo.helper';
import { tierRibbonClasses } from '../helpers/tier-ribbon.helper';

/**
 * Presentational foundation row. Renders the four-cell main `<tr>` inside
 * its template: Name (logo + name + tier-ribbon subtitle + chevron),
 * Org Role, Voting Status, Governance Participation.
 *
 * Hosting strategy: the component declares `:host { display: contents }` in
 * SCSS so the `<lfx-foundation-row>` element disappears from the box tree
 * and the inner `<tr>` becomes a direct child of `<tbody>` — required for
 * HTML table layout. This is the Angular-canonical alternative to
 * attribute-selector row components, which our `@angular-eslint/component-selector`
 * rule disallows (must be kebab-case element selector).
 *
 * Inline-detail (expansion) data is rendered by the parent component in a
 * sibling `<tr>` because expansion can grow/shrink independently of the
 * presentational row.
 *
 * Behaviour-level concerns owned by this component:
 * - Row-body click navigates to /org/memberships (no slug parameter — the
 *   slug-aware Memberships detail page is a follow-on feature; the
 *   current Memberships route is a placeholder page) for member /
 *   non_member rows; outside_lf is a no-op. When the slug-aware page
 *   lands, restore the slug argument here AND register
 *   `path: 'org/memberships/:foundationSlug'` in app.routes.ts.
 * - Chevron click toggles expansion via the `toggle` output and stops
 *   propagation so the row-body click does NOT also fire.
 * - Keyboard activation (Enter / Space) mirrors the click handler.
 */
@Component({
  selector: 'lfx-foundation-row',
  imports: [TooltipModule],
  templateUrl: './foundation-row.component.html',
  styleUrls: ['./foundation-row.component.scss'],
})
export class FoundationRowComponent {
  public readonly row = input.required<OrgLensFoundationRow>();
  public readonly expanded = input<boolean>(false);
  public readonly index = input<number>(0);

  public readonly toggle = output<void>();
  public readonly rowClick = output<{ foundationName: string; isMember: boolean }>();
  public readonly caretToggle = output<{ foundationName: string; expanded: boolean }>();

  private readonly router = inject(Router);

  protected readonly logoSquareClasses = computed(() => foundationLogoSquareClasses(this.row().foundationId));
  protected readonly initials = computed(() => foundationInitials(this.row().foundationName));
  protected readonly ribbonClasses = computed(() => tierRibbonClasses(this.row().membershipTierClass, this.row().rowKind));

  /**
   * Subtitle pill text. Binds to the canonical `membershipTierClass`
   * (NOT `membershipTierDisplayName`) so the badge renders the canonical
   * tier label.
   */
  protected readonly subtitleText = computed<string>(() => {
    const r = this.row();
    if (r.rowKind === 'outside_lf') return 'Outside LF';
    if (r.rowKind === 'non_member') return 'Non-member';
    const tier = r.membershipTierClass ?? 'Member';
    return `${tier} Member`;
  });

  protected readonly projectsInvolvedText = computed<string>(() => {
    const count = this.row().projectCount;
    return `${count} project${count === 1 ? '' : 's'} involved`;
  });

  /**
   * The "N projects involved · " prefix renders on every row regardless of
   * `rowKind` (member / non_member / outside_lf). The visual design shows
   * the prefix for non-member and Outside-LF rows too (e.g. "8 projects
   * involved · Outside LF"), so the gate is kept as a signal but always
   * resolves to true. Left as a computed so it can be tightened later
   * without touching the template.
   */
  protected readonly showProjectsInvolved = computed<boolean>(() => true);

  protected readonly chevronAriaLabel = computed<string>(() => {
    const action = this.expanded() ? 'Collapse' : 'Expand';
    return `${action} ${this.row().foundationName}`;
  });

  protected readonly governanceTooltip = computed<string>(() => {
    const pct = this.row().badges.governanceAttendancePct;
    if (pct == null) return '';
    const pctInt = Math.round(pct * 100);
    return `${pctInt}% meeting attendance across governance, working groups, and project meetings`;
  });

  protected readonly governanceHeaderTooltip =
    'Average meeting attendance across governance, working groups, and project meetings. <33% Inactive · 33–66% Partial · >66% Active.';

  protected readonly testIdSlug = computed<string>(() => this.row().foundationSlug || this.row().foundationId);

  protected readonly trRole = computed<string | null>(() => (this.row().rowKind === 'outside_lf' ? null : 'button'));
  protected readonly trTabIndex = computed<number | null>(() => (this.row().rowKind === 'outside_lf' ? null : 0));
  protected readonly trClasses = computed<string>(() => {
    const base = 'border-b border-gray-200 hover:bg-gray-50 transition-colors';
    return this.row().rowKind === 'outside_lf' ? `${base} cursor-default` : `${base} cursor-pointer`;
  });

  public onRowClick(event: MouseEvent): void {
    // Defensive: if the click landed inside a real interactive child
    // (chevron button, future inline link, etc.), let that child handle
    // it instead of firing the row navigation. We deliberately do NOT
    // match `[role="button"]` here because the row's own <tr> carries
    // `role="button"` and a `closest()` query would always match the row
    // itself — silently swallowing every row click. The chevron button
    // already calls `event.stopPropagation()`, so this branch is mainly
    // a safety net for future inner affordances.
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

  /** Org Role badge palette via Tailwind utilities → lfxColors. */
  protected orgRoleBadgeClasses(badge: OrgRoleBadge): string {
    if (badge === 'Director' || badge === 'Member') {
      return 'bg-blue-100 text-blue-700 border-blue-200';
    }
    return 'bg-white text-gray-600 border-gray-300';
  }

  protected votingStatusBadgeClasses(badge: VotingStatusBadge): string {
    if (badge === 'Voting' || badge === 'Observer') {
      return 'bg-blue-100 text-blue-700 border-blue-200';
    }
    return 'text-gray-400';
  }

  protected governanceBadgeClasses(bucket: GovernanceParticipationBucket): string {
    switch (bucket) {
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
