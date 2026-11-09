// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, InputModalityDetector } from '@angular/cdk/a11y';
import { hasModifierKey } from '@angular/cdk/keycodes';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import {
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MeetingHomeAttendance, MeetingHomeRow, MeetingRegistrant, PastMeeting, PastMeetingParticipant } from '@lfx-one/shared/interfaces';
import { getPastMeetingResourceId, resolveRsvpOccurrenceId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { Observable, Subscription } from 'rxjs';

import { MeetingAttendeeGridComponent } from '../meeting-attendee-grid/meeting-attendee-grid.component';
import { MeetingHomeAttendanceComponent } from '../meeting-home-attendance/meeting-home-attendance.component';

/**
 * A meetings home row's attendance block that opens the invited people above it on hover or keyboard focus.
 * @description People load on the first open and are kept per occurrence; a failed load closes the popup quietly.
 */
@Component({
  selector: 'lfx-meeting-home-attendance-popup',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, MeetingAttendeeGridComponent, MeetingHomeAttendanceComponent, UiSpinnerComponent],
  templateUrl: './meeting-home-attendance-popup.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingHomeAttendancePopupComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly inputModality = inject(InputModalityDetector);
  private readonly idGenerator = inject(_IdGenerator);
  private readonly document = inject(DOCUMENT);

  public readonly row = input.required<MeetingHomeRow>();
  public readonly attendance = input.required<MeetingHomeAttendance>();
  /** Loads the past meeting's participants instead of the date's registrants. */
  public readonly past = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly panelId = this.idGenerator.getId('lfx-meeting-home-attendance-popup-');
  // Above the block, centred, 6px off; below it when there is no room.
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
  ];
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  private readonly connectedOverlay = viewChild(CdkConnectedOverlay);
  private readonly cache = signal<Record<string, readonly (MeetingRegistrant | PastMeetingParticipant)[]>>({});

  protected readonly people: Signal<readonly (MeetingRegistrant | PastMeetingParticipant)[] | null> = computed(() => this.cache()[this.row().key] ?? null);
  // Nothing to show once an empty list has loaded.
  protected readonly visible: Signal<boolean> = computed(() => this.open() && (this.loading() || !!this.people()?.length));
  protected readonly triggerLabel: Signal<string> = this.initTriggerLabel();

  // Milliseconds of hover before the popup opens, so a pointer passing over the list loads nothing.
  private readonly hoverDelayMs = 150;
  // Milliseconds the pointer may spend crossing between the block and the popup.
  private readonly graceMs = 120;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private request: Subscription | null = null;
  private requestKey: string | null = null;
  // Keyboard focus keeps the popup open when the pointer leaves, as a scroll under a still pointer does.
  private keyboardFocused = false;

  public constructor() {
    // Re-place the popup once the grid replaces the spinner, and on any scroll, as the list scrolls in its own column.
    afterRenderEffect((onCleanup) => {
      this.people();
      if (!this.visible()) return;
      const reposition = (): void => this.connectedOverlay()?.overlayRef?.updatePosition();
      reposition();
      this.document.addEventListener('scroll', reposition, true);
      onCleanup(() => this.document.removeEventListener('scroll', reposition, true));
    });
    this.destroyRef.onDestroy(() => {
      this.cancelShow();
      this.cancelHide();
    });
  }

  protected show(): void {
    this.cancelShow();
    this.cancelHide();
    this.open.set(true);
    this.load();
  }

  protected close(): void {
    this.cancelShow();
    this.cancelHide();
    this.open.set(false);
  }

  protected cancelHide(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  protected onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    this.cancelHide();
    if (this.open() || this.showTimer !== null) return;
    this.showTimer = setTimeout(() => this.show(), this.hoverDelayMs);
  }

  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    this.cancelShow();
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.keyboardFocused) this.open.set(false);
    }, this.graceMs);
  }

  protected onFocus(): void {
    const modality = this.inputModality.mostRecentModality;
    this.keyboardFocused = modality !== 'mouse' && modality !== 'touch';
    this.show();
  }

  // Focus moving between the block and the popup keeps it open.
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Element | null;
    if (next?.closest(`#${this.panelId}, #${this.panelId}-trigger`)) return;
    this.keyboardFocused = false;
    this.close();
  }

  protected onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || hasModifierKey(event)) return;
    event.preventDefault();
    this.close();
  }

  // The trigger is a button, so its name carries the visible text.
  private initTriggerLabel(): Signal<string> {
    return computed(() => {
      const { label, ariaLabel, poor } = this.attendance();
      const parts = label === ariaLabel ? [label] : [label, ariaLabel];
      return [...parts, ...(poor ? ['This meeting was poorly attended'] : [])].join('. ');
    });
  }

  private cancelShow(): void {
    if (this.showTimer === null) return;
    clearTimeout(this.showTimer);
    this.showTimer = null;
  }

  private load(): void {
    const row = this.row();
    if (this.cache()[row.key] || this.requestKey === row.key) return;
    this.request?.unsubscribe();
    this.requestKey = row.key;
    this.loading.set(true);
    this.request = this.fetch(row)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (people) => {
          this.cache.update((cache) => ({ ...cache, [row.key]: people }));
          this.finishLoad();
        },
        error: (error) => {
          console.error('Failed to load invited people:', error);
          this.finishLoad();
          this.close();
        },
      });
  }

  private finishLoad(): void {
    this.requestKey = null;
    this.request = null;
    this.loading.set(false);
  }

  private fetch(row: MeetingHomeRow): Observable<readonly (MeetingRegistrant | PastMeetingParticipant)[]> {
    if (this.past()) return this.meetingService.getPastMeetingParticipants(getPastMeetingResourceId(row.meeting as PastMeeting));
    const occurrenceId = resolveRsvpOccurrenceId(row.meeting, { occurrenceId: row.occurrenceId });
    // A series with no date to resolve reads only its all-dates RSVPs, as the registrants list does.
    const allDatesOnly = !!row.meeting.recurrence && !occurrenceId;
    return this.meetingService.getMeetingRegistrants(row.meeting.id, true, occurrenceId, false, undefined, false, allDatesOnly);
  }
}
