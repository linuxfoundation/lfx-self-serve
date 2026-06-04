// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { PendingActionsDrawerComponent } from '@app/modules/dashboards/components/pending-actions-drawer/pending-actions-drawer.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { VoteBallotInlineComponent } from '@app/modules/votes/components/vote-ballot-inline/vote-ballot-inline.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_FADE_OUT_MS, PENDING_ACTION_LABEL, PENDING_ACTION_SKELETON_HOLD_MS } from '@lfx-one/shared/constants';
import { PollType } from '@lfx-one/shared/enums';
import { MeetingService } from '@services/meeting.service';
import { VoteService } from '@services/vote.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { InvitationService } from '@shared/services/invitation.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { timer } from 'rxjs';

import type { DecoratedPendingAction, Meeting, MeetingRsvp, PendingActionItem, PendingDecline, RsvpResponse, Vote } from '@lfx-one/shared/interfaces';

/** Deferred-undo window (ms) before an optimistic decline is committed upstream. */
const INVITE_DECLINE_UNDO_MS = 5000;

@Component({
  selector: 'lfx-pending-actions',
  imports: [
    ButtonComponent,
    TagComponent,
    RsvpButtonGroupComponent,
    VoteBallotInlineComponent,
    PendingActionsDrawerComponent,
    SkeletonModule,
    ToastModule,
    RouterLink,
  ],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  private readonly hiddenActionsService = inject(HiddenActionsService);
  private readonly meetingService = inject(MeetingService);
  private readonly voteService = inject(VoteService);
  private readonly invitationService = inject(InvitationService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly buttonIcons = PENDING_ACTION_BUTTON_ICON;
  protected readonly typeLabels = PENDING_ACTION_LABEL;

  public readonly pendingActions = input.required<PendingActionItem[]>();
  public readonly displayLimit = input<number>(2);

  public readonly actionClick = output<PendingActionItem>();
  // Emits the voteUid when a Vote pending-action needs the cast drawer (multi-question or ranked poll).
  public readonly castVoteRequested = output<string>();

  protected readonly drawerVisible = model<boolean>(false);

  // Cookie-backed dismissals live outside the signal graph; bumping forces the computed to recompute.
  private readonly hiddenActionsVersion = signal(0);
  // Rows currently in the 300ms fade-out + collapse transition.
  protected readonly completingRowKeys = signal<ReadonlySet<string>>(new Set());
  // Rows whose content is currently swapped to a skeleton placeholder while the next action takes the slot.
  protected readonly swappingRowKeys = signal<ReadonlySet<string>>(new Set());
  protected readonly expandedVoteKey = signal<string | null>(null);
  private readonly rsvpMeetingCache = signal<Record<string, Meeting>>({});
  private readonly voteCache = signal<Record<string, Vote>>({});
  private readonly loadingMeetingUids = signal<ReadonlySet<string>>(new Set());
  private readonly loadingVoteUids = signal<ReadonlySet<string>>(new Set());
  private readonly failedMeetingUids = signal<ReadonlySet<string>>(new Set());

  // The decline currently inside its deferred-undo window — drives the Undo affordance in the toast. Null when no decline is pending.
  protected readonly pendingDecline = signal<PendingDecline | null>(null);
  // setTimeout handle for the in-flight deferred decline; cleared on undo or when the timer fires.
  private declineTimerId: ReturnType<typeof setTimeout> | null = null;

  // Clamped display limit shared by slicing, hasMore, and skeleton-swap arrival logic — rejects NaN/Infinity, floors fractional values, default 2.
  protected readonly safeDisplayLimit: Signal<number> = this.initSafeDisplayLimit();
  protected readonly visibleActionsUnlimited: Signal<PendingActionItem[]> = this.initVisibleActionsUnlimited();
  protected readonly visibleActions: Signal<PendingActionItem[]> = this.initVisibleActions();
  protected readonly totalVisible: Signal<number> = computed(() => this.visibleActionsUnlimited().length);
  protected readonly hasMore: Signal<boolean> = computed(() => this.totalVisible() > this.safeDisplayLimit());
  protected readonly decoratedActions: Signal<DecoratedPendingAction[]> = this.initDecoratedActions();

  public constructor() {
    // Eagerly load Meeting payloads for every inline RSVP row so its buttons render immediately.
    toObservable(this.decoratedActions)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        for (const row of rows) {
          if (row.isRsvpInline && !row.meeting && !row.isLoading) {
            this.loadMeeting(row.meetingUid as string);
          }
        }
      });

    // If the user navigates away while a decline is still in its undo window, commit it immediately so
    // leaving the page doesn't silently drop the decline (clear the timer first so it can't double-fire).
    this.destroyRef.onDestroy(() => {
      const pending = this.pendingDecline();
      if (!pending) return;
      this.clearDeclineTimer();
      this.invitationService.declineInvitation(pending.committeeUid, pending.inviteUid).subscribe();
    });
  }

  protected handleAgendaOrOtherClick(item: DecoratedPendingAction): void {
    if (this.isVoteInline(item) && item.voteUid) {
      this.loadVoteForRow(item);
      return;
    }
    // RSVP fallback (meeting load failed): the user is being redirected to the meeting page to RSVP from there — opening
    // the page is not the same as completing the RSVP, so we leave the reminder visible. Only successful RSVP submission
    // hides the row.
    if (item.type !== 'RSVP') {
      this.startCompletion(item, { withSkeleton: false });
    }
    this.actionClick.emit(item);
  }

  protected handleRsvpSubmit(item: DecoratedPendingAction, rsvp: MeetingRsvp): void {
    this.messageService.add({
      key: 'pending-actions-toast',
      severity: 'success',
      summary: 'RSVP saved',
      detail: `You responded '${this.formatResponse(rsvp.response_type)}' to ${item.text}`,
      // Prefer the canonical buttonLink (carries password query params for upcoming meetings); fall back to the meeting root only as a last resort.
      data: this.buildToastMeetingData(item),
      life: 5000,
    });
    this.startCompletion(item, { withSkeleton: true });
  }

  protected handleVoteSubmitted(item: DecoratedPendingAction): void {
    if (this.expandedVoteKey() === this.getRowKey(item)) {
      this.expandedVoteKey.set(null);
    }
    this.startCompletion(item, { withSkeleton: true });
  }

  protected handleVoteCancelled(item: DecoratedPendingAction): void {
    if (this.expandedVoteKey() === this.getRowKey(item)) {
      this.expandedVoteKey.set(null);
    }
  }

  // Accept a committee invitation. Optimistically removes the row (markResolved → resolvedInviteUids filter), then commits
  // upstream; on failure the row is restored (unmarkResolved) and an error toast is shown.
  protected onAcceptInvitation(item: PendingActionItem): void {
    const inviteUid = item.inviteUid;
    const committeeUid = item.committeeUid;
    if (!inviteUid || !committeeUid) return;

    const groupName = item.inviteGroupName ?? item.badge;
    this.invitationService.markResolved(inviteUid);
    this.invitationService
      .acceptInvitation(committeeUid, inviteUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.messageService.add({
            key: 'pending-actions-toast',
            severity: 'success',
            summary: `You've joined ${groupName}`,
            life: 5000,
          });
        },
        error: () => {
          this.invitationService.unmarkResolved(inviteUid);
          this.messageService.add({
            key: 'pending-actions-toast',
            severity: 'error',
            summary: "Couldn't accept — try again.",
            life: 5000,
          });
        },
      });
  }

  // Decline a committee invitation with a true (deferred) undo: optimistically remove the row, schedule the real decline
  // ~5s out, and surface an Undo toast. Undo (or destroy) cancels the timer; only one decline can be pending at a time, so
  // a new decline first commits any in-flight one.
  protected onDeclineInvitation(item: PendingActionItem): void {
    const inviteUid = item.inviteUid;
    const committeeUid = item.committeeUid;
    if (!inviteUid || !committeeUid) return;

    // If a previous decline is still mid-window, commit it now before starting a new one.
    this.commitPendingDecline();

    this.invitationService.markResolved(inviteUid);
    this.pendingDecline.set({ inviteUid, committeeUid });
    this.declineTimerId = setTimeout(() => this.fireDecline(inviteUid, committeeUid), INVITE_DECLINE_UNDO_MS);

    this.messageService.add({
      key: 'pending-actions-toast',
      severity: 'info',
      summary: 'Invite declined',
      data: { undoInviteUid: inviteUid },
      life: INVITE_DECLINE_UNDO_MS,
    });
  }

  // Undo a still-pending decline: cancel the timer, restore the row, and clear the toast.
  protected onUndoDecline(): void {
    const pending = this.pendingDecline();
    if (!pending) return;
    this.clearDeclineTimer();
    this.invitationService.unmarkResolved(pending.inviteUid);
    this.pendingDecline.set(null);
    this.messageService.clear('pending-actions-toast');
  }

  protected openDrawer(): void {
    this.drawerVisible.set(true);
  }

  protected onDrawerActionCompleted(): void {
    // Drawer persists the hide cookie itself; we just need to recompute visibility so the inline list and `View all (N)` count refresh.
    this.hiddenActionsVersion.update((v) => v + 1);
  }

  protected handleDismiss(item: DecoratedPendingAction): void {
    this.hiddenActionsService.dismissAction(item);
    // skipHide: the permanent dismiss cookie already hides the row; a 24h hideAction cookie would be redundant.
    this.startCompletion(item, { withSkeleton: true, skipHide: true });
  }

  // Parse the href into a UrlTree up-front so `[routerLink]` preserves query params (e.g. `?password=...`).
  // Binding a raw string with `?` to `[routerLink]` treats the entire value as a path segment and URL-encodes the query separator.
  private buildToastMeetingData(item: PendingActionItem): { meetingUrl: UrlTree; meetingTitle: string } | undefined {
    const href = item.buttonLink ?? (item.meetingUid ? `/meetings/${item.meetingUid}` : null);
    if (!href) return undefined;
    return { meetingUrl: this.router.parseUrl(href), meetingTitle: item.text };
  }

  private loadMeeting(meetingUid: string): void {
    if (this.rsvpMeetingCache()[meetingUid]) return;
    if (this.loadingMeetingUids().has(meetingUid)) return;
    if (this.failedMeetingUids().has(meetingUid)) return;

    this.loadingMeetingUids.update((set) => new Set(set).add(meetingUid));
    this.meetingService
      .getMeeting(meetingUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (meeting) => {
          this.rsvpMeetingCache.update((cache) => ({ ...cache, [meetingUid]: meeting }));
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

  private loadVoteForRow(item: PendingActionItem): void {
    const voteUid = item.voteUid;
    if (!voteUid) return;

    this.expandedVoteKey.set(this.getRowKey(item));

    const cached = this.voteCache()[voteUid];
    if (cached) {
      this.dispatchLoadedVote(cached);
      return;
    }

    // Idempotency guard: a fetch for this voteUid is already in flight — let it complete
    // rather than firing a second GET that would also re-emit castVoteRequested on success.
    if (this.loadingVoteUids().has(voteUid)) return;

    this.loadingVoteUids.update((s) => new Set(s).add(voteUid));
    this.voteService
      .getVote(voteUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (vote) => {
          this.loadingVoteUids.update((s) => this.removeFromSet(s, voteUid));
          this.voteCache.update((cache) => ({ ...cache, [voteUid]: vote }));
          if (this.expandedVoteKey() === this.getRowKey(item)) {
            this.dispatchLoadedVote(vote);
          }
        },
        error: () => {
          this.loadingVoteUids.update((s) => this.removeFromSet(s, voteUid));
          if (this.expandedVoteKey() === this.getRowKey(item)) {
            this.expandedVoteKey.set(null);
          }
          this.messageService.add({
            key: 'pending-actions-toast',
            severity: 'error',
            summary: 'Could not load vote',
            detail: 'Please try again or open it from the My Votes page.',
            life: 4000,
          });
        },
      });
  }

  private dispatchLoadedVote(vote: Vote): void {
    if (this.voteUsesDrawer(vote)) {
      this.expandedVoteKey.set(null);
      this.castVoteRequested.emit(vote.uid);
    }
    // Otherwise the row stays expanded and the template renders VoteBallotInlineComponent.
  }

  private voteUsesDrawer(vote: Vote): boolean {
    const questions = vote.poll_questions ?? [];
    const isRanked = (vote.poll_type ?? PollType.GENERIC) !== PollType.GENERIC;
    // Inline ballot supports exactly one single/multiple-choice question; everything else
    // (zero questions, multiple questions, ranked/unsupported types) falls back to the drawer.
    if (questions.length !== 1) return true;
    const type = questions[0]?.type;
    if (type !== 'single_choice' && type !== 'multiple_choice') return true;
    return isRanked;
  }

  // Persist the hide synchronously unless `skipHide` is set (Dismiss already wrote a permanent cookie), so an unmount within the animation window can't cancel the cookie write, then drive the fade → drop → skeleton-arrival animation through two timers.
  private startCompletion(item: PendingActionItem, options: { withSkeleton: boolean; skipHide?: boolean }): void {
    const rowKey = this.getRowKey(item);
    if (!options.skipHide) {
      this.hiddenActionsService.hideAction(item);
    }

    this.completingRowKeys.update((keys) => new Set(keys).add(rowKey));
    timer(PENDING_ACTION_FADE_OUT_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // Drop the completed row — it's already hidden via cookie; removing it from completingRowKeys lets the natural filter take over.
        this.completingRowKeys.update((keys) => this.removeFromSet(keys, rowKey));
        this.hiddenActionsVersion.update((v) => v + 1);

        if (!options.withSkeleton) return;

        // After the recompute, the new arrival (if any) occupies the last visible slot — render it as a skeleton briefly so the user sees a "loading in" effect.
        const limit = this.safeDisplayLimit();
        const visible = this.visibleActionsUnlimited();
        if (limit === 0 || visible.length < limit) return;

        const arrival = visible[limit - 1];
        const arrivalKey = this.getRowKey(arrival);
        if (arrivalKey === rowKey) return;

        this.swappingRowKeys.update((keys) => new Set(keys).add(arrivalKey));
        timer(PENDING_ACTION_SKELETON_HOLD_MS)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => {
            this.swappingRowKeys.update((keys) => this.removeFromSet(keys, arrivalKey));
          });
      });
  }

  // Commit the deferred decline upstream once its undo window elapses. The row is already optimistically removed; on
  // failure restore it and surface an inline error toast. Only acts while this UID is still the pending decline.
  private fireDecline(inviteUid: string, committeeUid: string): void {
    const pending = this.pendingDecline();
    if (!pending || pending.inviteUid !== inviteUid) return;
    this.declineTimerId = null;
    this.pendingDecline.set(null);
    this.invitationService
      .declineInvitation(committeeUid, inviteUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.invitationService.unmarkResolved(inviteUid);
          this.messageService.add({
            key: 'pending-actions-toast',
            severity: 'error',
            summary: "Couldn't decline — try again.",
            life: 5000,
          });
        },
      });
  }

  // Flush a still-pending decline synchronously (e.g. a new decline supersedes it): clear the timer and fire the API now.
  private commitPendingDecline(): void {
    const pending = this.pendingDecline();
    if (!pending) return;
    this.clearDeclineTimer();
    this.pendingDecline.set(null);
    this.invitationService.declineInvitation(pending.committeeUid, pending.inviteUid).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  private clearDeclineTimer(): void {
    if (this.declineTimerId !== null) {
      clearTimeout(this.declineTimerId);
      this.declineTimerId = null;
    }
  }

  private removeFromSet(keys: ReadonlySet<string>, rowKey: string): ReadonlySet<string> {
    if (!keys.has(rowKey)) return keys;
    const next = new Set(keys);
    next.delete(rowKey);
    return next;
  }

  private isRsvpInline(item: PendingActionItem): boolean {
    return item.type === 'RSVP' && !!item.meetingUid;
  }

  private isVoteInline(item: PendingActionItem): boolean {
    return item.type === 'Vote' && !!item.voteUid;
  }

  // Mirror HiddenActionsService.getActionIdentifier so the row key, hidden-cookie identifier, and `@for` track key all stay in sync.
  private getRowKey(item: PendingActionItem): string {
    if (item.meetingUid) {
      return `${item.type}-${item.meetingUid}-${item.occurrenceId ?? ''}`;
    }
    if (item.voteUid) {
      return `${item.type}-${item.voteUid}`;
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

  private initSafeDisplayLimit(): Signal<number> {
    return computed(() => {
      const raw = this.displayLimit();
      return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 2;
    });
  }

  private initVisibleActionsUnlimited(): Signal<PendingActionItem[]> {
    return computed(() => {
      this.hiddenActionsVersion();
      // Invitations are resolved server-side, not cookie-hidden: drop any invite the user accepted/declined this session
      // (tracked in the shared resolvedInviteUids signal) so the row disappears across every surface. Reading the signal
      // here makes this computed re-run automatically on accept/decline/undo.
      const resolvedInvites = this.invitationService.resolvedInviteUids();
      const pinned = new Set<string>();
      this.completingRowKeys().forEach((k) => pinned.add(k));
      this.swappingRowKeys().forEach((k) => pinned.add(k));
      return this.pendingActions().filter((item) => {
        if (item.type === 'Invitation' && !!item.inviteUid && resolvedInvites.has(item.inviteUid)) {
          return false;
        }
        return pinned.has(this.getRowKey(item)) || !this.hiddenActionsService.isActionHidden(item);
      });
    });
  }

  private initVisibleActions(): Signal<PendingActionItem[]> {
    return computed(() => this.visibleActionsUnlimited().slice(0, this.safeDisplayLimit()));
  }

  private initDecoratedActions(): Signal<DecoratedPendingAction[]> {
    return computed(() => {
      const cache = this.rsvpMeetingCache();
      const cacheV = this.voteCache();
      const loading = this.loadingMeetingUids();
      const loadingVoteUids = this.loadingVoteUids();
      const failed = this.failedMeetingUids();
      const expandedVoteKey = this.expandedVoteKey();
      return this.visibleActions().map((item) => {
        const rowKey = this.getRowKey(item);
        // When the meeting fetch fails, fall back to the regular buttonLink/CTA path so the user has a working action instead of perpetual skeletons.
        const meetingFailed = !!item.meetingUid && failed.has(item.meetingUid);
        const isRsvpInline = this.isRsvpInline(item) && !meetingFailed;
        const isVoteInline = this.isVoteInline(item);
        const meeting = item.meetingUid ? (cache[item.meetingUid] ?? null) : null;
        const vote = item.voteUid ? (cacheV[item.voteUid] ?? null) : null;
        const isVoteLoading = !!item.voteUid && loadingVoteUids.has(item.voteUid);
        const isVoteInlineExpanded = isVoteInline && expandedVoteKey === rowKey;
        const voteUsesDrawerVal = !!vote && this.voteUsesDrawer(vote);
        const isInvitation = item.type === 'Invitation' && !!item.inviteUid;
        const inviteGroupName = item.inviteGroupName ?? item.badge;
        return {
          ...item,
          rowKey,
          isRsvpInline,
          isVoteInline,
          isRsvpInlineLink: isRsvpInline && !!item.buttonLink,
          isExpanded: false,
          isLoading: !!item.meetingUid && loading.has(item.meetingUid),
          meeting,
          rowClass: 'bg-white',
          vote,
          isVoteLoading,
          isVoteInlineExpanded,
          voteUsesDrawer: voteUsesDrawerVal,
          isInvitation,
          acceptAriaLabel: `Accept invite to ${inviteGroupName}`,
          declineAriaLabel: `Decline invite to ${inviteGroupName}`,
        };
      });
    });
  }
}
