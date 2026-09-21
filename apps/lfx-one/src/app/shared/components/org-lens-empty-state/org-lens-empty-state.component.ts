// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ORG_LENS_EMPTY_STATE_COPY } from '@lfx-one/shared/constants';
import { OrgLensEmptyStateAction, OrgLensEmptyStateName, OrgLensEmptyStateValues } from '@lfx-one/shared/interfaces';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

/** States whose wording must never carry an addressed organization's name (spec 050 DR-002 / 053 DR-001). */
const UNHELD_ORG_STATES: ReadonlySet<OrgLensEmptyStateName> = new Set(['no-access', 'wrong-organization', 'section-no-access', 'section-could-not-verify']);

/** States that render the caller's own organization list (FR-008). */
const ORG_LIST_STATES: ReadonlySet<OrgLensEmptyStateName> = new Set(['wrong-organization', 'not-found-staff']);

/** States a first-time visitor can reach — they carry the product line (FR-002). */
const PAGE_LEVEL_STATES: ReadonlySet<OrgLensEmptyStateName> = new Set([
  'no-organization',
  'no-access',
  'wrong-organization',
  'not-found-staff',
  'could-not-load',
  'staff-check-failed',
]);

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

  protected readonly productLine = computed(() => (PAGE_LEVEL_STATES.has(this.state()) ? this.copy().productLine : undefined));

  protected readonly reason = computed(() => {
    const copy = this.copy();
    const template = copy.noPeriod && !this.values().period ? copy.noPeriod.reason : copy.reason;
    return this.interpolate(template);
  });

  /**
   * FR-005 with the one FR-013 exception: `section-empty` without an active filter has no button. An
   * `org-list` primary with nothing to list (the caller's rows are filtered out or not here yet) promotes
   * the secondary into the primary slot, so the state is never left without a control.
   */
  protected readonly primary = computed<OrgLensEmptyStateAction | undefined>(() => {
    const copy = this.copy();
    if (this.state() === 'section-empty' && this.values().filterActive === false) {
      return undefined;
    }
    if (copy.primary?.action === 'org-list' && this.orgList().length === 0) {
      return copy.secondary;
    }
    return copy.primary;
  });

  /** Hidden when it has been promoted to the primary slot. */
  protected readonly secondary = computed(() => (this.primary() === this.copy().secondary ? undefined : this.copy().secondary));

  /** FR-008 — the caller's own organizations, honoured only for the states that list them. Empty renders nothing rather than an empty box. */
  protected readonly orgList = computed(() => (ORG_LIST_STATES.has(this.state()) ? (this.values().orgList ?? []) : []));

  /** The list is the primary control (`wrong-organization`: the way out is picking a held organization) — rendered under the primary's label, in the primary's slot. */
  protected readonly orgListIsPrimary = computed(() => this.primary()?.action === 'org-list');

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
    const orgName = UNHELD_ORG_STATES.has(this.state()) ? 'This organization' : values.orgName?.trim() || 'This organization';
    return template
      .replace(/\{orgName\}/g, orgName)
      .replace(/\{noun\}/g, values.noun ?? 'records')
      .replace(/\{period\}/g, values.period ?? 'this period')
      .replace(/\{correlationId\}/g, values.correlationId ?? '—');
  }
}
