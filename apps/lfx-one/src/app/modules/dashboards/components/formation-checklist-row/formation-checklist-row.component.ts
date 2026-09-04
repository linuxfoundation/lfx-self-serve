// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import type { FormationItem, FormationRowStatusChange } from '@lfx-one/shared/interfaces';
import {
  FORMATION_GATED_ROW_ACTIONS,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_ITEM_STATUS_SEVERITY,
  FORMATION_LINK_ROW_ACTIONS,
} from '@lfx-one/shared/constants';
import { isValidUrl } from '@lfx-one/shared/utils';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-formation-checklist-row',
  imports: [TagComponent, ButtonComponent, MenuComponent, NgTemplateOutlet],
  templateUrl: './formation-checklist-row.component.html',
  styleUrl: './formation-checklist-row.component.scss',
})
export class FormationChecklistRowComponent {
  public readonly item = input.required<FormationItem>();
  /**
   * True while *any* mutation for this item is in flight — a row action (provisionable/request), a
   * skip, a status-menu transition, a completion/accept, or a drawer write (Mark complete/Save)
   * started while this item was open in the drawer. Drives the gated action button's `[loading]`,
   * which also blocks re-entry — see `ButtonComponent.handleClick`. Deliberately broad rather than
   * row-action-only: this button must stay non-actionable for the duration of any write against the
   * same item, not just its own.
   */
  public readonly submitting = input<boolean>(false);

  public readonly openDrawer = output<FormationItem>();
  /** Fired for the `provisionable`/`request` action kinds only — `manual` opens the drawer instead; the orchestrator owns the actual service call. */
  public readonly actionTriggered = output<FormationItem>();
  /** Status-menu "Mark in progress" / "Back to not started" — the two plain transitions that carry no extra data. */
  public readonly statusChanged = output<FormationRowStatusChange>();
  /** Status-menu "Mark blocked…" — kept separate since the parent opens `ReasonPromptDialogComponent` for an optional note before calling the same status-update endpoint. */
  public readonly blockRequested = output<FormationItem>();
  /** Status-menu "Mark done" / "Accept" — both call the existing complete endpoint; the parent decides the toast wording. */
  public readonly completeRequested = output<FormationItem>();
  /** Overflow menu "Skip with reason" — the parent already owns this flow (opens `ReasonPromptDialogComponent`) for the drawer's Skip button; reused verbatim here. */
  public readonly skipRequested = output<FormationItem>();

  /** `#gatedAction`/`#externalLinkAction` template contexts, keyed by action kind — typed at the definition site (see `FORMATION_GATED_ROW_ACTIONS`/`FORMATION_LINK_ROW_ACTIONS`), not inline in the template where `*ngTemplateOutlet` context is untyped. */
  protected readonly gatedActions = FORMATION_GATED_ROW_ACTIONS;
  protected readonly linkActions = FORMATION_LINK_ROW_ACTIONS;

  protected readonly statusLabel = computed(() => FORMATION_ITEM_STATUS_LABELS[this.item().status]);
  protected readonly statusSeverity = computed(() => FORMATION_ITEM_STATUS_SEVERITY[this.item().status]);
  protected readonly statusOutlined = computed(() => this.item().status === 'not_started');
  /** "Mark done" relabels to "Accept" once the item is sitting with the formation team and this caller can close it out. */
  protected readonly completeLabel = computed(() => (this.item().status === 'awaiting_acceptance' && this.item().can_complete ? 'Accept' : 'Mark done'));
  /** `provisionable`/`request` actions change status the same way complete/skip do — hide them once the item is already terminal. */
  protected readonly isActionable = computed(() => this.item().status !== 'done' && this.item().status !== 'skipped');
  protected readonly subItemsSummary = computed(() => {
    const subItems = this.item().sub_items;
    if (subItems.length === 0) return null;
    const done = subItems.filter((subItem) => subItem.status === 'done').length;
    return `${done} of ${subItems.length} sub-items done`;
  });
  /** `action_href` is API-sourced (fixture today, a real upstream response once #1957 lands) — never trust it into `[href]` unvalidated. `null` renders no link rather than a raw/unsafe URL. */
  protected readonly safeActionHref = computed(() => {
    const href = this.item().action_href;
    return href && isValidUrl(href) ? href : null;
  });

  protected statusMenuItems: MenuItem[] = [];
  protected overflowMenuItems: MenuItem[] = [];

  protected onOpenDrawer(): void {
    this.openDrawer.emit(this.item());
  }

  protected onAction(): void {
    this.actionTriggered.emit(this.item());
  }

  protected toggleStatusMenu(event: Event, menu: MenuComponent): void {
    event.stopPropagation();
    this.statusMenuItems = this.buildStatusMenuItems();
    menu.toggle(event);
  }

  protected toggleOverflowMenu(event: Event, menu: MenuComponent): void {
    event.stopPropagation();
    this.overflowMenuItems = this.buildOverflowMenuItems();
    menu.toggle(event);
  }

  private buildStatusMenuItems(): MenuItem[] {
    const item = this.item();
    const items: MenuItem[] = [];

    if (item.status !== 'in_progress') {
      items.push({ label: 'Mark in progress', icon: 'fa-light fa-spinner', command: () => this.emitStatusChange('in_progress') });
    }
    if (item.status !== 'done' && item.status !== 'skipped') {
      items.push({
        label: this.completeLabel(),
        icon: 'fa-light fa-check',
        disabled: !item.can_complete,
        command: () => this.completeRequested.emit(item),
      });
      if (item.status !== 'blocked') {
        items.push({ label: 'Mark blocked…', icon: 'fa-light fa-hand', command: () => this.blockRequested.emit(item) });
      }
    }
    if (item.status !== 'not_started') {
      items.push({ label: 'Back to not started', icon: 'fa-light fa-rotate-left', command: () => this.emitStatusChange('not_started') });
    }

    return items;
  }

  private buildOverflowMenuItems(): MenuItem[] {
    const item = this.item();
    return [
      { label: 'Assign', icon: 'fa-light fa-user', command: () => this.openDrawer.emit(item) },
      { label: 'Set due date', icon: 'fa-light fa-calendar', command: () => this.openDrawer.emit(item) },
      { separator: true },
      { label: 'Skip with reason', icon: 'fa-light fa-forward', command: () => this.skipRequested.emit(item) },
    ];
  }

  private emitStatusChange(status: Extract<FormationItem['status'], 'not_started' | 'in_progress'>): void {
    this.statusChanged.emit({ item: this.item(), status });
  }
}
