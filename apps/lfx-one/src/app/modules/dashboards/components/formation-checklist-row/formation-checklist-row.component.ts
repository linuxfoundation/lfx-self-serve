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
  /** Status-menu "Mark done" — only offered from `in_progress` (see `buildStatusMenuItems`); calls `completeFormationItem`. */
  public readonly completeRequested = output<FormationItem>();
  /** Status-menu "Accept" — only offered from `awaiting_acceptance`; routes through the dedicated accept endpoint instead of `completeFormationItem`, which rejects an already-`awaiting_acceptance` source. */
  public readonly acceptRequested = output<FormationItem>();
  /** Status-menu "Mark in progress" when reversing off `awaiting_acceptance` — upstream requires a mandatory reason for this specific reversal (reject), unlike the plain `statusChanged` transitions or a `done` reversal (reopen, no reason required). */
  public readonly reopenRequested = output<FormationItem>();
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
  /**
   * `provisionable`/`request` actions call `completeFormationItem`/`requestFormationItem`
   * (`onAction()` in the parent), and both only accept `in_progress` as their source status
   * (`assertPlainTransitionAllowed` in `formation.service.ts`) — offering the button from any
   * other status 400s at the server. Restrict to the one status the call will actually accept;
   * `not_started`/`blocked` items first need "Mark in progress" from the status menu.
   */
  protected readonly isActionable = computed(() => this.item().status === 'in_progress');
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

  /**
   * Every offered item here must match a transition `formation.service.ts` will actually accept —
   * see its `allowedPlainTransitions` graph (not_started↔{in_progress,skipped}, in_progress↔{blocked,
   * awaiting_acceptance}, blocked→in_progress, skipped→not_started) plus the separate done/
   * awaiting_acceptance→in_progress reversal (reopen/reject, gate_writer-gated, reject requires a
   * mandatory reason). Offering a transition outside that graph 400s at the server.
   */
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

    // "Mark in progress" — not_started/blocked/done reverse via the plain `statusChanged` output (the
    // done case still lands on the server's no-reason-required reopen branch); awaiting_acceptance
    // reverses via `reopenRequested` instead, since that specific reversal (reject) requires a reason
    // the plain output has no way to carry.
    if (item.status === 'not_started' || item.status === 'blocked' || item.status === 'done') {
      items.push({
        label: 'Mark in progress',
        icon: 'fa-light fa-spinner',
        disabled: reversingGateDecision && !item.can_complete,
        command: () => this.emitStatusChange('in_progress'),
      });
    } else if (item.status === 'awaiting_acceptance') {
      items.push({
        label: 'Mark in progress',
        icon: 'fa-light fa-spinner',
        disabled: reversingGateDecision && !item.can_complete,
        command: () => this.reopenRequested.emit(item),
      });
    }

    // "Mark done" only from in_progress (the only source `completeFormationItem` accepts); "Accept"
    // only from awaiting_acceptance, and it routes through the dedicated accept endpoint instead —
    // completeFormationItem's transition check always rejects a source that's already awaiting_acceptance.
    if (item.status === 'in_progress') {
      items.push({ label: this.completeLabel(), icon: 'fa-light fa-check', command: () => this.completeRequested.emit(item) });
      // Only in_progress→blocked is a valid transition.
      items.push({ label: 'Mark blocked…', icon: 'fa-light fa-hand', command: () => this.blockRequested.emit(item) });
    } else if (item.status === 'awaiting_acceptance') {
      items.push({
        label: this.completeLabel(),
        icon: 'fa-light fa-check',
        disabled: !item.can_complete,
        command: () => this.acceptRequested.emit(item),
      });
    }

    // Only skipped→not_started is a valid transition — done/awaiting_acceptance can only reverse to
    // in_progress (handled above), never all the way back to not_started.
    if (item.status === 'skipped') {
      items.push({
        label: 'Back to not started',
        icon: 'fa-light fa-rotate-left',
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
          // `skipFormationItem` only accepts `not_started` as a source (`assertPlainTransitionAllowed`
          // target `skipped` in formation.service.ts) — mirrors the drawer's Skip button gating
          // (formation-item-drawer.component.html).
          disabled: !item.can_complete || item.status !== 'not_started',
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
