// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
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
import { isRelativeInAppPath, isValidUrl } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-formation-checklist-row',
  imports: [TagComponent, ButtonComponent, MenuComponent, NgTemplateOutlet],
  templateUrl: './formation-checklist-row.component.html',
  styleUrl: './formation-checklist-row.component.scss',
})
export class FormationChecklistRowComponent {
  private readonly userService = inject(UserService);

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

  /** `#gatedAction`/`#linkOrDetailsAction` template contexts, keyed by action kind — typed at the definition site (see `FORMATION_GATED_ROW_ACTIONS`/`FORMATION_LINK_ROW_ACTIONS`), not inline in the template where `*ngTemplateOutlet` context is untyped. */
  protected readonly gatedActions = FORMATION_GATED_ROW_ACTIONS;
  protected readonly linkActions = FORMATION_LINK_ROW_ACTIONS;

  protected readonly statusLabel = computed(() => FORMATION_ITEM_STATUS_LABELS[this.item().status]);
  protected readonly statusSeverity = computed(() => FORMATION_ITEM_STATUS_SEVERITY[this.item().status]);
  protected readonly statusOutlined = computed(() => this.item().status === 'not_started');
  /** "Mark done" relabels to "Accept" once the item is sitting with the formation team and this caller can close it out. */
  protected readonly completeLabel = computed(() => (this.item().status === 'awaiting_acceptance' && this.item().can_complete ? 'Accept' : 'Mark done'));
  /** `provisionable`/`request` actions change status the same way complete/skip do — hide them once the item is already terminal. */
  protected readonly isActionable = computed(() => this.item().status !== 'done' && this.item().status !== 'skipped');
  /** `status_only` items are updated by external tooling only — the chip must not offer a menu the server will reject (see `buildStatusMenuItems`). */
  protected readonly isStatusEditable = computed(() => this.item().action !== 'status_only');
  /** GH-1958 acceptance criteria: surface an "Assigned to you" chip when the viewer is this item's owner. */
  protected readonly isAssignedToViewer = computed(() => {
    const owner = this.item().owner;
    const viewerUsername = this.userService.viewerUsername();
    return !!owner && !!viewerUsername && owner.username === viewerUsername;
  });
  protected readonly subItemsSummary = computed(() => {
    const subItems = this.item().sub_items;
    if (subItems.length === 0) return null;
    const done = subItems.filter((subItem) => subItem.status === 'done').length;
    return `${done} of ${subItems.length} sub-items done`;
  });
  /**
   * `action_href` is API-sourced (fixture today, a real upstream response once #1957 lands) — never
   * trust it into `[href]`/`[routerLink]` unvalidated. Split into external/internal so the template
   * can bind each to the right control: an absolute value still needs scheme validation and opens in
   * a new tab, while a relative in-app path routes through `routerLink` in place instead of a raw
   * anchor. `null` on both means no safe destination — the row falls back to "View details".
   */
  protected readonly safeExternalHref = computed(() => {
    const href = this.item().action_href;
    return href && !isRelativeInAppPath(href) && isValidUrl(href) ? href : null;
  });
  protected readonly safeInternalPath = computed(() => {
    const href = this.item().action_href;
    return href && isRelativeInAppPath(href) ? href : null;
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
    // status_only items are updated by external tooling only (see formation.service.ts's
    // completeFormationItem/skipFormationItem/updateFormationItemStatus rejection for the same
    // rule enforced server-side) — the status menu must not offer a write the server will reject.
    if (item.action === 'status_only') return [];
    // A gating item's `done`/`awaiting_acceptance` status is a gate decision — reversing it
    // requires the same `can_complete` privilege the server now enforces for that transition.
    const reversingGateDecision = item.is_gating && (item.status === 'done' || item.status === 'awaiting_acceptance');
    const items: MenuItem[] = [];

    if (item.status !== 'in_progress') {
      items.push({
        label: 'Mark in progress',
        icon: 'fa-light fa-spinner',
        disabled: reversingGateDecision && !item.can_complete,
        command: () => this.emitStatusChange('in_progress'),
      });
    }
    if (item.status !== 'done' && item.status !== 'skipped') {
      items.push({
        label: this.completeLabel(),
        icon: 'fa-light fa-check',
        // can_complete gates the acceptance decision, not first-time submission — a non-gate-writer
        // can still submit a gating item (server responds with 'awaiting_acceptance'); only accepting
        // an item already awaiting acceptance requires can_complete.
        disabled: item.status === 'awaiting_acceptance' && !item.can_complete,
        command: () => this.completeRequested.emit(item),
      });
      if (item.status !== 'blocked') {
        items.push({ label: 'Mark blocked…', icon: 'fa-light fa-hand', command: () => this.blockRequested.emit(item) });
      }
    }
    if (item.status !== 'not_started') {
      items.push({
        label: 'Back to not started',
        icon: 'fa-light fa-rotate-left',
        disabled: reversingGateDecision && !item.can_complete,
        command: () => this.emitStatusChange('not_started'),
      });
    }

    return items;
  }

  private buildOverflowMenuItems(): MenuItem[] {
    const item = this.item();
    const items: MenuItem[] = [
      { label: 'Assign', icon: 'fa-light fa-user', command: () => this.openDrawer.emit(item) },
      { label: 'Set due date', icon: 'fa-light fa-calendar', command: () => this.openDrawer.emit(item) },
    ];
    // status_only items are updated by external tooling only (see formation.service.ts's
    // completeFormationItem/skipFormationItem/updateFormationItemStatus rejection for the same
    // rule enforced server-side) — skip isn't a write the server will accept for this action kind.
    if (item.action !== 'status_only') {
      items.push(
        { separator: true },
        {
          label: 'Skip with reason',
          icon: 'fa-light fa-forward',
          // Mirrors the drawer's Skip button gating (formation-item-drawer.component.html) — the
          // overflow menu must not offer a write the rest of the UI treats as unauthorized/terminal.
          disabled: !item.can_complete || item.status === 'done' || item.status === 'skipped',
          command: () => this.skipRequested.emit(item),
        }
      );
    }
    return items;
  }

  private emitStatusChange(status: Extract<FormationItem['status'], 'not_started' | 'in_progress'>): void {
    this.statusChanged.emit({ item: this.item(), status });
  }
}
