// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { PendingActionsDrawerComponent } from '@app/modules/dashboards/components/pending-actions-drawer/pending-actions-drawer.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_FADE_OUT_MS, PENDING_ACTION_LABEL, PENDING_ACTION_SKELETON_HOLD_MS } from '@lfx-one/shared/constants';
import { MeetingService } from '@services/meeting.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { timer } from 'rxjs';

import type { DecoratedPendingAction, Meeting, MeetingRsvp, PendingActionItem, RsvpResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-pending-actions',
  imports: [ButtonComponent, TagComponent, RsvpButtonGroupComponent, PendingActionsDrawerComponent, SkeletonModule, ToastModule, RouterLink],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  private readonly hiddenActionsService = inject(HiddenActionsService);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly buttonIcons = PENDING_ACTION_BUTTON_ICON;
  protected readonly typeLabels = PENDING_ACTION_LABEL;

  public readonly pendingActions = input.required<PendingActionItem[]>();
  public readonly displayLimit = input<number>(2);

  public readonly actionClick = output<PendingActionItem>();
  // Emits the voteUid when a Vote pending-action is clicked, so the parent dashboard can open the cast drawer inline.
  public readonly castVoteRequested = output<string>();

  protected readonly drawerVisible = model<boolean>(false);

  // Cookie-backed dismissals live outside the signal graph; bumping forces the computed to recompute.
  private readonly hiddenActionsVersion = signal(0);
  // Rows currently in the 300ms fade-out + collapse transition.
  protected readonly completingRowKeys = signal<ReadonlySet<string>>(new Set());
  // Rows whose content is currently swapped to a skeleton placeholder while the next action takes the slot.
  protected readonly swappingRowKeys = signal<ReadonlySet<string>>(new Set());
  private readonly rsvpMeetingCache = signal<Record<string, Meeting>>({});
  private readonly loadingMeetingUids = signal<ReadonlySet<string>>(new Set());
  private readonly failedMeetingUids = signal<ReadonlySet<string>>(new Set());

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
  }

  protected handleAgendaOrOtherClick(item: DecoratedPendingAction): void {
    if (this.isVoteInline(item) && item.voteUid) {
      // Vote rows: parent opens drawer; hide-on-success is handled by the parent dashboard's vote-submitted path.
      this.castVoteRequested.emit(item.voteUid);
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

  protected openDrawer(): void {
    this.drawerVisible.set(true);
  }

  protected onDrawerActionCompleted(): void {
    // Drawer persists the hide cookie itself; we just need to recompute visibility so the inline list and `View all (N)` count refresh.
    this.hiddenActionsVersion.update((v) => v + 1);
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

  // Persist the hide synchronously (so an unmount within the animation window can't cancel the cookie write), then drive the fade → drop → skeleton-arrival animation through two timers.
  private startCompletion(item: PendingActionItem, options: { withSkeleton: boolean }): void {
    const rowKey = this.getRowKey(item);
    this.hiddenActionsService.hideAction(item);

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
      const pinned = new Set<string>();
      this.completingRowKeys().forEach((k) => pinned.add(k));
      this.swappingRowKeys().forEach((k) => pinned.add(k));
      return this.pendingActions().filter((item) => pinned.has(this.getRowKey(item)) || !this.hiddenActionsService.isActionHidden(item));
    });
  }

  private initVisibleActions(): Signal<PendingActionItem[]> {
    return computed(() => this.visibleActionsUnlimited().slice(0, this.safeDisplayLimit()));
  }

  private initDecoratedActions(): Signal<DecoratedPendingAction[]> {
    return computed(() => {
      const cache = this.rsvpMeetingCache();
      const loading = this.loadingMeetingUids();
      const failed = this.failedMeetingUids();
      return this.visibleActions().map((item) => {
        const rowKey = this.getRowKey(item);
        // When the meeting fetch fails, fall back to the regular buttonLink/CTA path so the user has a working action instead of perpetual skeletons.
        const meetingFailed = !!item.meetingUid && failed.has(item.meetingUid);
        const isRsvpInline = this.isRsvpInline(item) && !meetingFailed;
        const isVoteInline = this.isVoteInline(item);
        const meeting = item.meetingUid ? (cache[item.meetingUid] ?? null) : null;
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
        };
      });
    });
  }
}
