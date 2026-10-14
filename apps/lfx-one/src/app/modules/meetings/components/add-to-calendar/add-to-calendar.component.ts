// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, InputSignal, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { environment } from '@environments/environment';
import { CalendarLinkEvent, Meeting, MeetingCalendarScope, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { buildMeetingOccurrenceRoute } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl } from '@shared/utils/calendar-link.util';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-add-to-calendar',
  imports: [ButtonComponent, MenuComponent, RadioButtonComponent],
  templateUrl: './add-to-calendar.component.html',
})
export class AddToCalendarComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly formBuilder = inject(FormBuilder);

  // Inputs
  public meeting: InputSignal<Meeting> = input.required<Meeting>();
  public currentOccurrence: InputSignal<MeetingOccurrence | null> = input<MeetingOccurrence | null>(null);

  // Forms
  /** Only meaningful when `isRecurring()` — which occurrence(s) "Add to calendar" downloads. */
  public readonly scopeForm: FormGroup = this.formBuilder.group({ scope: ['occurrence'] });

  // Computed values
  public readonly isRecurring: Signal<boolean> = computed(() => !!this.meeting().recurrence);
  public readonly menuItems: Signal<MenuItem[]> = this.initializeMenuItems();

  protected readonly menuOpen: WritableSignal<boolean> = signal(false);

  private readonly scope: Signal<MeetingCalendarScope> = this.initializeScope();

  protected toggleMenu(event: Event, menuComponent: MenuComponent): void {
    menuComponent.toggle(event);
  }

  private initializeScope(): Signal<MeetingCalendarScope> {
    return toSignal(this.scopeForm.get('scope')!.valueChanges, { initialValue: this.scopeForm.get('scope')!.value });
  }

  private initializeMenuItems(): Signal<MenuItem[]> {
    return computed(() => {
      // Google Calendar's and Outlook's deep links only ever add a single event — a "series" choice
      // can't be represented without each provider's own recurrence syntax, so those two options are
      // disabled rather than silently downloading just the current occurrence (GH-3505).
      const seriesSelected = this.scope() === 'series';
      return [
        { label: 'Google Calendar', icon: 'fa-brands fa-google', disabled: seriesSelected, command: () => this.openExternalCalendar(buildGoogleCalendarUrl) },
        {
          label: 'Outlook / Microsoft 365',
          icon: 'fa-brands fa-microsoft',
          disabled: seriesSelected,
          command: () => this.openExternalCalendar(buildOutlookCalendarUrl),
        },
        { label: 'Download .ics', icon: 'fa-regular fa-download', command: () => this.downloadIcs() },
      ];
    });
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

  /**
   * Links to the public meeting page with no password — unlike `handleCopyLink`'s clipboard copy,
   * this URL is embedded in a third-party calendar event body that syncs to every device and, if the
   * invitee forwards the event, to every other attendee. A visitor is asked for the password there
   * instead, the same way a plain share of the meeting page already works without one (GH-3505).
   * The selected occurrence is preserved via `buildMeetingOccurrenceRoute` so the link lands on the
   * same date the user picked, not whichever occurrence the meeting page defaults to (GH-3505).
   */
  private meetingPageUrl(): string {
    const meeting = this.meeting();
    const occurrence = this.isRecurring() ? this.currentOccurrence() : null;

    if (!occurrence) {
      return `${environment.urls.home}/meetings/${encodeURIComponent(meeting.id)}`;
    }

    const route = buildMeetingOccurrenceRoute(meeting.id, occurrence.start_time, occurrence.duration ?? meeting.duration);
    const path = route.path.map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment))).join('/');
    const query = route.queryParams ? `?${new URLSearchParams(route.queryParams).toString()}` : '';

    return `${environment.urls.home}${path}${query}`;
  }
}
