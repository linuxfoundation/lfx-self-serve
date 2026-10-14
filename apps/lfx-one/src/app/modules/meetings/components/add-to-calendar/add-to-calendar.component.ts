// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, InputSignal, Signal, signal, WritableSignal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { environment } from '@environments/environment';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl, CalendarLinkEvent } from '@shared/utils/calendar-link.util';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-add-to-calendar',
  imports: [ButtonComponent, MenuComponent],
  templateUrl: './add-to-calendar.component.html',
})
export class AddToCalendarComponent {
  private readonly meetingService = inject(MeetingService);

  // Inputs
  public meeting: InputSignal<Meeting> = input.required<Meeting>();
  public currentOccurrence: InputSignal<MeetingOccurrence | null> = input<MeetingOccurrence | null>(null);

  // Simple WritableSignals
  /** Only meaningful when `isRecurring()` — which occurrence(s) "Add to calendar" downloads. */
  public scope: WritableSignal<'occurrence' | 'series'> = signal('occurrence');

  // Computed values
  public readonly isRecurring: Signal<boolean> = computed(() => !!this.meeting().recurrence);
  public readonly menuItems: Signal<MenuItem[]> = this.initializeMenuItems();

  protected toggleMenu(event: Event, menuComponent: MenuComponent): void {
    menuComponent.toggle(event);
  }

  private initializeMenuItems(): Signal<MenuItem[]> {
    return computed(() => [
      { label: 'Google Calendar', icon: 'fa-brands fa-google', command: () => this.openExternalCalendar(buildGoogleCalendarUrl) },
      { label: 'Outlook / Microsoft 365', icon: 'fa-brands fa-microsoft', command: () => this.openExternalCalendar(buildOutlookCalendarUrl) },
      { label: 'Download .ics', icon: 'fa-regular fa-download', command: () => this.downloadIcs() },
    ]);
  }

  private openExternalCalendar(buildUrl: (event: CalendarLinkEvent) => string): void {
    window.open(buildUrl(this.resolveCalendarEvent()), '_blank', 'noopener,noreferrer');
  }

  private downloadIcs(): void {
    const occurrenceId = this.isRecurring() ? this.currentOccurrence()?.occurrence_id : undefined;
    const url = this.meetingService.getMeetingCalendarIcsUrl(this.meeting().id, { scope: this.scope(), occurrenceId });
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /**
   * Builds the deep-link payload for Google Calendar / Outlook. Links to the meeting details page
   * rather than a raw Zoom URL: the actual join link is resolved there at click time, under the
   * same access rules the Join button itself uses (GH-3505).
   */
  private resolveCalendarEvent(): CalendarLinkEvent {
    const meeting = this.meeting();
    const occurrence = this.isRecurring() ? this.currentOccurrence() : null;

    return {
      title: occurrence?.title || meeting.title,
      startIso: occurrence?.start_time || meeting.start_time,
      durationMinutes: occurrence?.duration ?? meeting.duration,
      description: occurrence?.description || meeting.description,
      joinUrl: this.meetingPageUrl(),
    };
  }

  private meetingPageUrl(): string {
    const meeting = this.meeting();
    const params = new URLSearchParams();
    if (meeting.password) {
      params.set('password', meeting.password);
    }
    const queryString = params.toString();
    return queryString ? `${environment.urls.home}/meetings/${meeting.id}?${queryString}` : `${environment.urls.home}/meetings/${meeting.id}`;
  }
}
