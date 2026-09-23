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

/**
 * Spec 053 — the one shared Org Lens empty state. Renders headline → reason → primary → secondary from
 * the copy registry; call sites choose a state, never a string (FR-001/FR-004).
 *
 * Visual shape follows the LFX Insights empty-state pattern (lfx-self-serve#2533 "Design"), in exact
 * px because the app root is 14px: a 56px `blue-100` disc (Insights' accent-100) with a 32px `blue-500`
 * icon, a Roboto Slab 18/20px headline, one 14px paragraph (max 448px), one primary call to action
 * rendered as an `accent-500` text-link `lfx-button` (Inter 600 · 14px label · 16px leading icon, see
 * `ctaStyleClass`), and at most one muted 13px secondary link.
 *
 * Not a thin wrapper over `lfx-empty-state`: that primitive carries one CTA and no secondary line, and
 * FR-002/FR-008 need a secondary action and an organization list.
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
  /** Wrap in `lfx-card` (section usage) vs the bordered page block (page usage). */
  public readonly withCard = input(false);
  /** `data-testid` prefix, e.g. `org-overview-no-access`. */
  public readonly testId = input.required<string>();
  /** True while the Retry this state offers is in flight — the control shows a spinner and cannot be re-fired. */
  public readonly retrying = input(false);

  public readonly retry = output<void>();
  public readonly resetFilters = output<void>();
  public readonly orgSelected = output<string>();

  /**
   * The call to action is an `accent-500` text link, not a filled button (#2533 Tokens row: Inter 600 ·
   * 14px · 16px icon). Exact px, not rem: the app root is 14px (styling.md).
   */
  protected readonly ctaStyleClass = '[&_.p-button-icon]:!text-[16px] [&_.p-button-label]:!text-[14px] [&_.p-button-label]:!font-semibold';

  /**
   * The registry entry for the state. The name set is closed at compile time, but a name that reaches
   * here unrecognised (a stale bundle after a registry change, a future wire-carried state) must render
   * a safe generic block with a control, never a blank page (#2535): it falls closed to
   * `section-could-not-load` — an outage wording that asserts nothing about access.
   */
  protected readonly copy = computed(() => ORG_LENS_EMPTY_STATE_COPY[this.state()] ?? ORG_LENS_EMPTY_STATE_COPY['section-could-not-load']);

  protected readonly headline = computed(() => {
    const copy = this.copy();
    const template = copy.noPeriod && !this.values().period ? copy.noPeriod.headline : copy.headline;
    return this.interpolate(template);
  });

  protected readonly reason = computed(() => {
    const copy = this.copy();
    if (copy.noPeriod && !this.values().period) {
      return this.interpolate(copy.noPeriod.reason);
    }
    // A reason that introduces the list ("Here is what you have access to:") must not run into nothing.
    if (copy.noList && copy.primary?.action === 'org-list' && this.orgList().length === 0) {
      return this.interpolate(copy.noList.reason);
    }
    return this.interpolate(copy.reason);
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

  /**
   * FR-008 — the caller's own organizations, listed only on `wrong-organization`, where picking one is
   * the way out. The staff not-found state lists none: staff reach any organization through switcher
   * search. Empty renders nothing rather than an empty box.
   */
  protected readonly orgList = computed(() => (this.state() === 'wrong-organization' ? (this.values().orgList ?? []) : []));

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
