// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import type { FormationItem } from '@lfx-one/shared/interfaces';
import {
  FORMATION_GATED_ROW_ACTIONS,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_ITEM_STATUS_SEVERITY,
  FORMATION_LINK_ROW_ACTIONS,
} from '@lfx-one/shared/constants';
import { isValidUrl } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-formation-checklist-row',
  imports: [TagComponent, ButtonComponent, NgTemplateOutlet],
  templateUrl: './formation-checklist-row.component.html',
  styleUrl: './formation-checklist-row.component.scss',
})
export class FormationChecklistRowComponent {
  public readonly item = input.required<FormationItem>();
  /**
   * True while *any* mutation for this item is in flight — a row action (provisionable/request), a
   * skip, or a drawer write (Mark complete/Save) started while this item was open in the drawer.
   * Drives the gated action button's `[loading]`, which also blocks re-entry — see
   * `ButtonComponent.handleClick`. Deliberately broad rather than row-action-only: this button must
   * stay non-actionable for the duration of any write against the same item, not just its own.
   */
  public readonly submitting = input<boolean>(false);

  public readonly openDrawer = output<FormationItem>();
  /** Fired for the `provisionable`/`request` action kinds only — `manual` opens the drawer instead; the orchestrator owns the actual service call. */
  public readonly actionTriggered = output<FormationItem>();

  /** `#gatedAction`/`#externalLinkAction` template contexts, keyed by action kind — typed at the definition site (see `FORMATION_GATED_ROW_ACTIONS`/`FORMATION_LINK_ROW_ACTIONS`), not inline in the template where `*ngTemplateOutlet` context is untyped. */
  protected readonly gatedActions = FORMATION_GATED_ROW_ACTIONS;
  protected readonly linkActions = FORMATION_LINK_ROW_ACTIONS;

  protected readonly statusLabel = computed(() => FORMATION_ITEM_STATUS_LABELS[this.item().status]);
  protected readonly statusSeverity = computed(() => FORMATION_ITEM_STATUS_SEVERITY[this.item().status]);
  protected readonly statusOutlined = computed(() => this.item().status === 'not_started');
  /** `provisionable`/`request` actions change status the same way complete/skip do — hide them once the item is already terminal. */
  protected readonly isActionable = computed(() => this.item().status !== 'done' && this.item().status !== 'skipped');
  /** `action_href` is API-sourced (fixture today, a real upstream response once #1957 lands) — never trust it into `[href]` unvalidated. `null` renders no link rather than a raw/unsafe URL. */
  protected readonly safeActionHref = computed(() => {
    const href = this.item().action_href;
    return href && isValidUrl(href) ? href : null;
  });

  protected onOpenDrawer(): void {
    this.openDrawer.emit(this.item());
  }

  protected onAction(): void {
    this.actionTriggered.emit(this.item());
  }
}
