// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ORG_LENS_EMPTY_STATE_COPY, OrgLensEmptyStateAction, OrgLensEmptyStateName } from '@lfx-one/shared/constants';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

/** Resolved values a state may interpolate. `orgName` is honoured only for states rendered to a caller who holds the org (FR-019). */
export interface OrgLensEmptyStateValues {
  orgName?: string | null;
  /** FR-013 — the section's plural noun ("meetings", "commits"). */
  noun?: string;
  /** FR-013 — human-readable selected period; absent ⇒ the `noPeriod` wording. */
  period?: string | null;
  correlationId?: string | null;
  /** FR-008 — the caller's own held organizations, rendered as the primary action list. */
  orgList?: { uid: string; name: string }[];
  /** FR-013 — false when no caller-set filter narrows the query, so `section-empty` renders reason-only. Defaults true. */
  filterActive?: boolean;
}

/** States whose wording must never carry an addressed organization's name (spec 050 DR-002 / 053 DR-001). */
const UNHELD_ORG_STATES: Record<string, true> = { 'no-access': true, 'wrong-organization': true, 'section-no-access': true, 'section-could-not-verify': true };

/** States that render the caller's own organization list (FR-008). */
const ORG_LIST_STATES: Record<string, true> = { 'wrong-organization': true, 'not-found-staff': true };

/** States a first-time visitor can reach — they carry the product line (FR-002). */
const PAGE_LEVEL_STATES: Record<string, true> = {
  'no-organization': true,
  'no-access': true,
  'wrong-organization': true,
  'not-found-staff': true,
  'could-not-load': true,
  'staff-check-failed': true,
};

/**
 * Spec 053 — the one shared Org Lens empty state. Renders headline → product line → reason → primary →
 * secondary from the copy registry; call sites choose a state, never a string (FR-001/FR-004).
 *
 * Not a thin wrapper over `lfx-empty-state`: that primitive carries one CTA and no secondary line, and
 * FR-002/FR-008 need a secondary action and an organization list. The visual shape (icon disc, headline,
 * muted body) is kept identical so the two read as one family.
 *
 * `testId` keeps the scenario hooks of the blocks it replaces — `{testId}-state`, `-title`,
 * `-description`, `-contact-support`, `-retry`, `-org-list`.
 */
@Component({
  selector: 'lfx-org-lens-empty-state',
  imports: [NgTemplateOutlet, RouterLink, ButtonComponent, CardComponent, OpenIntercomDirective],
  templateUrl: './org-lens-empty-state.component.html',
})
export class OrgLensEmptyStateComponent {
  public readonly state = input.required<OrgLensEmptyStateName>();
  public readonly values = input<OrgLensEmptyStateValues>({});
  /** Wrap in `lfx-card` (section usage) vs the dashed page block (page usage). */
  public readonly withCard = input(false);
  /** `data-testid` prefix, e.g. `org-overview-no-access`. */
  public readonly testId = input.required<string>();

  public readonly retry = output<void>();
  public readonly resetFilters = output<void>();
  public readonly orgSelected = output<string>();

  protected readonly copy = computed(() => ORG_LENS_EMPTY_STATE_COPY[this.state()]);

  protected readonly headline = computed(() => {
    const copy = this.copy();
    const template = copy.noPeriod && !this.values().period ? copy.noPeriod.headline : copy.headline;
    return this.interpolate(template);
  });

  protected readonly productLine = computed(() => (PAGE_LEVEL_STATES[this.state()] ? this.copy().productLine : undefined));

  protected readonly reason = computed(() => {
    const copy = this.copy();
    const template = copy.noPeriod && !this.values().period ? copy.noPeriod.reason : copy.reason;
    return this.interpolate(template);
  });

  /** FR-005 with the one FR-013 exception: `section-empty` without an active filter has no button. */
  protected readonly primary = computed<OrgLensEmptyStateAction | undefined>(() => {
    const copy = this.copy();
    if (this.state() === 'section-empty' && this.values().filterActive === false) {
      return undefined;
    }
    return copy.primary;
  });

  protected readonly secondary = computed(() => this.copy().secondary);

  /** FR-008 — the caller's own organizations; rendered by `wrong-organization` (as the primary way out) and `not-found-staff` (beneath the search invite). Empty renders nothing rather than an empty box. */
  protected readonly orgList = computed(() => (ORG_LIST_STATES[this.state()] ? (this.values().orgList ?? []) : []));

  protected onAction(action: OrgLensEmptyStateAction): void {
    if (action.action === 'retry') {
      this.retry.emit();
    } else if (action.action === 'reset-filters') {
      this.resetFilters.emit();
    }
  }

  private interpolate(template: string): string {
    const values = this.values();
    // FR-017: an unheld organization is never named, whatever the caller passed.
    const orgName = UNHELD_ORG_STATES[this.state()] ? 'This organization' : values.orgName?.trim() || 'This organization';
    return template
      .replace(/\{orgName\}/g, orgName)
      .replace(/\{noun\}/g, values.noun ?? 'records')
      .replace(/\{period\}/g, values.period ?? 'this period')
      .replace(/\{correlationId\}/g, values.correlationId ?? '—');
  }
}
