// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, UrlTree } from '@angular/router';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { ReasonPromptDialogComponent } from '@components/reason-prompt-dialog/reason-prompt-dialog.component';
import { TagComponent } from '@components/tag/tag.component';
import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_FADE_OUT_MS, PENDING_ACTION_LABEL } from '@lfx-one/shared/constants';
import { FormationService } from '@services/formation.service';
import { MeetingService } from '@services/meeting.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { InvitationService } from '@shared/services/invitation.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { filter, take, timer } from 'rxjs';

import type { DrawerActionRow, Meeting, MeetingRsvp, PendingActionItem, ReasonPromptDialogResult, RsvpResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-pending-actions-drawer',
  imports: [DrawerModule, SkeletonModule, ButtonComponent, TagComponent, EmptyStateComponent, RsvpButtonGroupComponent],
  providers: [DialogService],
  templateUrl: './pending-actions-drawer.component.html',
  styleUrl: './pending-actions-drawer.component.scss',
})
export class PendingActionsDrawerComponent {
  private readonly hiddenActionsService = inject(HiddenActionsService);
  private readonly meetingService = inject(MeetingService);
  private readonly invitationService = inject(InvitationService);
  private readonly formationService = inject(FormationService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly buttonIcons = PENDING_ACTION_BUTTON_ICON;
  protected readonly typeLabels = PENDING_ACTION_LABEL;

  public readonly pendingActions = input.required<PendingActionItem[]>();
  public readonly visible = model<boolean>(false);

  public readonly actionCompleted = output<PendingActionItem>();
  // Emits voteUid when a Vote row's CTA is clicked so the parent dashboard can open the cast drawer inline.
  public readonly castVoteRequested = output<string>();
  // Invitation Accept/Decline are delegated to the parent so the optimistic markResolved, the success/error toasts, and the
  // deferred-undo decline (whose Undo affordance lives in the parent's shared p-toast) are all owned in one place.
  public readonly acceptInvitationRequested = output<PendingActionItem>();
  public readonly declineInvitationRequested = output<PendingActionItem>();
  // Emits {projectUid, itemKey} when a FormationItem row's Open action needs the existing
  // formation-item-drawer (GH-1956) — mirrors `pending-actions.component.ts`'s own output;
  // the parent dashboard hosts `dashboard-formation-item-drawer-host` and opens it on this event.
  public readonly formationItemRequested = output<{ projectUid: string; itemKey: string }>();
  // Emits after a successful Claim/Block-with-note so the parent (`pending-actions.component.ts`)
  // can re-fetch the server-truth pending actions list — mirroring its own `actionClick` output for
  // the same two actions on the main inline list. `actionCompleted` above only drives the local
  // hide-cookie recompute (correct for RSVP/dismiss, which are purely client-side), so it can't be
  // reused here: a claim/block changes the item's status server-side and the row stays visible, so
  // without this the row's status/actions go stale until the next unrelated refresh.
  public readonly formationItemMutated = output<PendingActionItem>();

  private readonly hiddenActionsVersion = signal(0);
  // Rows currently in the fade-out + collapse transition; keeps them rendered through the animation.
  protected readonly completingRowKeys = signal<ReadonlySet<string>>(new Set());
  // Rows with an in-flight claim/block mutation — mirrors `pending-actions.component.ts`'s own signal.
  protected readonly formationMutationRowKeys = signal<ReadonlySet<string>>(new Set());
  private readonly meetingCache = signal<Record<string, Meeting>>({});
  private readonly loadingMeetingUids = signal<ReadonlySet<string>>(new Set());
  private readonly failedMeetingUids = signal<ReadonlySet<string>>(new Set());

  protected readonly visibleRows: Signal<DrawerActionRow[]> = this.initVisibleRows();
  protected readonly uncompletedCount: Signal<number> = computed(() => this.visibleRows().length);

  public constructor() {
    // When the drawer becomes visible, eagerly load Meeting payloads for every RSVP row so the inline RSVP buttons render immediately.
    // Subscribe only to the visibility signal (not `visibleRows`) — `visibleRows` re-emits every time `meetingCache` updates,
    // which would cause an O(n) rescan per fetched meeting (O(n²) overall). Read `visibleRows()` synchronously inside the
    // subscribe instead so each fetch fires exactly once per row.
    toObservable(this.visible)
      .pipe(
        filter((isVisible) => isVisible),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        for (const row of this.visibleRows()) {
          if (row.isRsvpInline && !row.meeting && !row.isMeetingLoading && !row.meetingLoadFailed) {
            this.loadMeeting(row.meetingUid as string);
          }
        }
      });
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected handleAgendaOrOtherClick(item: DrawerActionRow): void {
    if (item.isVoteInline && item.voteUid) {
      this.visible.set(false);
      this.castVoteRequested.emit(item.voteUid);
      return;
    }
    // RSVP fallback (meeting load failed): opening the meeting page is not the same as completing the RSVP, so the
    // reminder stays visible. Only successful RSVP submission hides the row.
    if (item.type === 'RSVP') return;
    this.startCompletion(item);
  }

  protected handleDismiss(item: DrawerActionRow): void {
    this.hiddenActionsService.dismissAction(item);
    // skipHide: the permanent dismiss cookie already hides the row; a 24h hideAction cookie would be redundant.
    this.startCompletion(item, true);
  }

  // Delegate invitation Accept/Decline to the parent (it owns the optimistic markResolved, toasts, and deferred undo).
  // The shared resolvedInviteUids signal drives this drawer's filter too, so the row disappears here the moment the
  // parent resolves it — no local completion animation needed.
  protected onAcceptInvitation(item: DrawerActionRow): void {
    this.acceptInvitationRequested.emit(item);
  }

  protected onDeclineInvitation(item: DrawerActionRow): void {
    this.declineInvitationRequested.emit(item);
  }

  // Claim a formation checklist item assigned to the caller (GH-1956), mirroring
  // `pending-actions.component.ts`'s `onClaimFormationItem`. The row stays on the list — a
  // successful claim just clears the in-flight flag so the drawer's next render (driven by the
  // parent's refreshed `pendingActions` input) picks up the new status/actions.
  protected onClaimFormationItem(item: DrawerActionRow): void {
    const projectUid = item.formationProjectUid;
    const itemKey = item.formationItemKey;
    if (!projectUid || !itemKey) return;

    const rowKey = item.rowKey;
    if (this.formationMutationRowKeys().has(rowKey)) return;
    this.formationMutationRowKeys.update((s) => new Set(s).add(rowKey));

    this.formationService
      .updateFormationItemStatus(projectUid, itemKey, 'in_progress')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.formationMutationRowKeys.update((s) => this.removeFromSet(s, rowKey));
          this.messageService.add({ key: 'pending-actions-toast', severity: 'success', summary: 'Claimed', detail: `You claimed "${item.text}"`, life: 5000 });
          this.formationItemMutated.emit(item);
        },
        error: () => {
          this.formationMutationRowKeys.update((s) => this.removeFromSet(s, rowKey));
          this.messageService.add({ key: 'pending-actions-toast', severity: 'error', summary: "Couldn't claim — try again.", life: 5000 });
        },
      });
  }

  // Block with note (GH-1956), mirroring `pending-actions.component.ts`'s `onBlockFormationItemRequested`.
  protected onBlockFormationItemRequested(item: DrawerActionRow): void {
    const projectUid = item.formationProjectUid;
    const itemKey = item.formationItemKey;
    if (!projectUid || !itemKey) return;

    const rowKey = item.rowKey;
    const ref = this.dialogService.open(ReasonPromptDialogComponent, {
      header: 'Mark blocked',
      width: '480px',
      modal: true,
      data: {
        prompt: `Marking "${item.text}" blocked requires a reason. This is logged in the item's history.`,
        placeholder: 'What is blocking this item?',
        confirmLabel: 'Mark blocked',
      },
    });

    ref?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: ReasonPromptDialogResult | undefined) => {
      if (!result?.reason || this.formationMutationRowKeys().has(rowKey)) return;
      this.formationMutationRowKeys.update((s) => new Set(s).add(rowKey));

      this.formationService
        .updateFormationItemStatus(projectUid, itemKey, 'blocked', result.reason)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.formationMutationRowKeys.update((s) => this.removeFromSet(s, rowKey));
            this.messageService.add({ key: 'pending-actions-toast', severity: 'success', summary: 'Marked blocked', life: 5000 });
            this.formationItemMutated.emit(item);
          },
          error: () => {
            this.formationMutationRowKeys.update((s) => this.removeFromSet(s, rowKey));
            this.messageService.add({ key: 'pending-actions-toast', severity: 'error', summary: "Couldn't mark this item blocked — try again.", life: 5000 });
          },
        });
    });
  }

  // Open (GH-1956): opens the existing formation-item-drawer via the parent-hosted dashboard-formation-item-drawer-host.
  protected onOpenFormationItem(item: DrawerActionRow): void {
    const projectUid = item.formationProjectUid;
    const itemKey = item.formationItemKey;
    if (!projectUid || !itemKey) return;
    this.formationItemRequested.emit({ projectUid, itemKey });
  }

  protected handleRsvpSubmit(item: DrawerActionRow, rsvp: MeetingRsvp): void {
    this.messageService.add({
      key: 'pending-actions-toast',
      severity: 'success',
      summary: 'RSVP saved',
      detail: `You responded '${this.formatResponse(rsvp.response_type)}' to ${item.text}`,
      // Prefer the canonical buttonLink (carries password query params for upcoming meetings); fall back to the meeting root only as a last resort.
      data: this.buildToastMeetingData(item),
      life: 5000,
    });
    this.startCompletion(item);
  }

  // Parse the href into a UrlTree up-front so `[routerLink]` preserves query params (e.g. `?password=...`).
  // Binding a raw string with `?` to `[routerLink]` treats the entire value as a path segment and URL-encodes the query separator.
  private buildToastMeetingData(item: PendingActionItem): { meetingUrl: UrlTree; meetingTitle: string } | undefined {
    const href = item.buttonLink ?? (item.meetingUid ? `/meetings/${item.meetingUid}` : null);
    if (!href) return undefined;
    return { meetingUrl: this.router.parseUrl(href), meetingTitle: item.text };
  }

  private loadMeeting(meetingUid: string): void {
    if (this.meetingCache()[meetingUid]) return;
    if (this.loadingMeetingUids().has(meetingUid)) return;
    if (this.failedMeetingUids().has(meetingUid)) return;

    this.loadingMeetingUids.update((set) => new Set(set).add(meetingUid));
    this.meetingService
      .getMeeting(meetingUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (meeting) => {
          this.meetingCache.update((cache) => ({ ...cache, [meetingUid]: meeting }));
          this.loadingMeetingUids.update((set) => this.removeFromSet(set, meetingUid));
        },
        error: () => {
          this.loadingMeetingUids.update((set) => this.removeFromSet(set, meetingUid));
          this.failedMeetingUids.update((set) => new Set(set).add(meetingUid));
          this.messageService.add({
            key: 'pending-actions-toast',
            severity: 'warn',
            summary: 'Unable to load RSVP options',
            detail: 'Open the meeting page to RSVP.',
            life: 5000,
          });
        },
      });
  }

  // Persist the hide synchronously unless `skipHide` is set (Dismiss already wrote a permanent cookie), then drive the fade animation through a single timer.
  private startCompletion(item: PendingActionItem, skipHide = false): void {
    const rowKey = this.getRowKey(item);
    if (!skipHide) {
      this.hiddenActionsService.hideAction(item);
    }

    this.completingRowKeys.update((keys) => new Set(keys).add(rowKey));
    timer(PENDING_ACTION_FADE_OUT_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.completingRowKeys.update((keys) => this.removeFromSet(keys, rowKey));
        this.hiddenActionsVersion.update((v) => v + 1);
        this.actionCompleted.emit(item);
      });
  }

  private removeFromSet(keys: ReadonlySet<string>, rowKey: string): ReadonlySet<string> {
    if (!keys.has(rowKey)) return keys;
    const next = new Set(keys);
    next.delete(rowKey);
    return next;
  }

  // Mirror HiddenActionsService.getActionIdentifier so the row key, hidden-cookie identifier, and `@for` track key all stay in sync.
  private getRowKey(item: PendingActionItem): string {
    if (item.meetingUid) {
      return `${item.type}-${item.meetingUid}-${item.occurrenceId ?? ''}`;
    }
    if (item.voteUid) {
      return `${item.type}-${item.voteUid}`;
    }
    if (item.briefActionUid) {
      return `${item.type}-${item.briefActionUid}`;
    }
    if (item.formationItemUid) {
      return `${item.type}-${item.formationItemUid}`;
    }
    const base = `${item.type}-${item.badge}-${item.text}`;
    return item.buttonLink ? `${base}|${item.buttonLink}` : base;
  }

  private formatResponse(response: RsvpResponse): string {
    switch (response) {
      case 'accepted':
        return 'Yes';
      case 'declined':
        return 'No';
      case 'maybe':
        return 'Maybe';
      default:
        return response;
    }
  }

  private initVisibleRows(): Signal<DrawerActionRow[]> {
    return computed(() => {
      this.hiddenActionsVersion();
      // Invitations are resolved server-side, not cookie-hidden: drop any invite resolved this session (shared signal) so
      // the row disappears in lockstep with the inline list. Reading the signal makes this computed re-run on accept/decline/undo.
      const resolvedInvites = this.invitationService.resolvedInviteUids();
      const completing = this.completingRowKeys();
      const cache = this.meetingCache();
      const loading = this.loadingMeetingUids();
      const failed = this.failedMeetingUids();
      return this.pendingActions()
        .filter((item) => {
          if (item.type === 'Invitation' && !!item.inviteUid && resolvedInvites.has(item.inviteUid)) {
            return false;
          }
          return completing.has(this.getRowKey(item)) || !this.hiddenActionsService.isActionHidden(item);
        })
        .map((item) => {
          const rowKey = this.getRowKey(item);
          // When the meeting fetch fails, fall back to the regular buttonLink/CTA branch so users still have a working action.
          const meetingLoadFailed = !!item.meetingUid && failed.has(item.meetingUid);
          const isRsvpInline = item.type === 'RSVP' && !!item.meetingUid && !meetingLoadFailed;
          const isVoteInline = item.type === 'Vote' && !!item.voteUid;
          // Require committeeUid too — Accept/Decline delegate to the parent which calls the API with it.
          const isInvitation = item.type === 'Invitation' && !!item.inviteUid && !!item.committeeUid;
          const isFormationItem = item.type === 'FormationItem' && !!item.formationProjectUid && !!item.formationItemKey;
          const inviteGroupName = item.inviteGroupName ?? item.badge;
          return {
            ...item,
            rowKey,
            isRsvpInline,
            isVoteInline,
            meeting: item.meetingUid ? (cache[item.meetingUid] ?? null) : null,
            isMeetingLoading: !!item.meetingUid && loading.has(item.meetingUid),
            meetingLoadFailed,
            isInvitation,
            isFormationItem,
            acceptAriaLabel: `Accept invite to ${inviteGroupName}`,
            declineAriaLabel: `Decline invite to ${inviteGroupName}`,
          };
        });
    });
  }
}
