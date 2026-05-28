// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, UrlTree } from '@angular/router';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_FADE_OUT_MS, PENDING_ACTION_LABEL } from '@lfx-one/shared/constants';
import { MeetingService } from '@services/meeting.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { filter, timer } from 'rxjs';

import type { DrawerActionRow, Meeting, MeetingRsvp, PendingActionItem, RsvpResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-pending-actions-drawer',
  imports: [DrawerModule, SkeletonModule, ButtonComponent, TagComponent, EmptyStateComponent, RsvpButtonGroupComponent],
  templateUrl: './pending-actions-drawer.component.html',
  styleUrl: './pending-actions-drawer.component.scss',
})
export class PendingActionsDrawerComponent {
  private readonly hiddenActionsService = inject(HiddenActionsService);
  private readonly meetingService = inject(MeetingService);
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

  private readonly hiddenActionsVersion = signal(0);
  // Rows currently in the fade-out + collapse transition; keeps them rendered through the animation.
  protected readonly completingRowKeys = signal<ReadonlySet<string>>(new Set());
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

  // Persist the hide synchronously, then drive the fade animation through a single timer.
  private startCompletion(item: PendingActionItem): void {
    const rowKey = this.getRowKey(item);
    this.hiddenActionsService.hideAction(item);

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
      const completing = this.completingRowKeys();
      const cache = this.meetingCache();
      const loading = this.loadingMeetingUids();
      const failed = this.failedMeetingUids();
      return this.pendingActions()
        .filter((item) => completing.has(this.getRowKey(item)) || !this.hiddenActionsService.isActionHidden(item))
        .map((item) => {
          const rowKey = this.getRowKey(item);
          // When the meeting fetch fails, fall back to the regular buttonLink/CTA branch so users still have a working action.
          const meetingLoadFailed = !!item.meetingUid && failed.has(item.meetingUid);
          const isRsvpInline = item.type === 'RSVP' && !!item.meetingUid && !meetingLoadFailed;
          const isVoteInline = item.type === 'Vote' && !!item.voteUid;
          return {
            ...item,
            rowKey,
            isRsvpInline,
            isVoteInline,
            meeting: item.meetingUid ? (cache[item.meetingUid] ?? null) : null,
            isMeetingLoading: !!item.meetingUid && loading.has(item.meetingUid),
            meetingLoadFailed,
          };
        });
    });
  }
}
