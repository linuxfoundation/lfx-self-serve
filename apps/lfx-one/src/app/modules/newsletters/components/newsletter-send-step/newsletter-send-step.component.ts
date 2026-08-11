// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { TimePickerComponent } from '@components/time-picker/time-picker.component';
import { NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS, NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES } from '@lfx-one/shared/constants';
import { NewsletterScheduleWindowError } from '@lfx-one/shared/interfaces';

// See newsletter-review.component.ts's identical constant — this component and the
// review card render the same "when should this go out?" picker as two radio cards
// rather than a segmented toggle, so each choice reads as its own labeled option
// instead of a settings flip.
const SEND_MODE_OPTIONS: { value: 'now' | 'schedule'; label: string; description: string; icon: string }[] = [
  { value: 'now', label: 'Send immediately', description: 'Goes out as soon as you confirm', icon: 'fa-regular fa-paper-plane' },
  { value: 'schedule', label: 'Schedule for later', description: 'Pick a date and time to send', icon: 'fa-regular fa-clock' },
];

const SCHEDULE_WINDOW_MESSAGES: Record<NewsletterScheduleWindowError, string> = {
  past: 'This time has passed — pick a new one.',
  tooSoon: 'Pick a time at least 30 minutes from now, so it can still be cancelled if needed.',
  tooFar: 'Pick a time within the next 72 hours.',
  invalidFormat: 'Enter a valid time, like 9:30 AM.',
};

// See newsletter-review.component.ts's identical constant for the rationale — this
// component and the review card show the same schedule panel in two different steps.
const SCHEDULE_RULES_TEXT = `Pick a time at least ${NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES} minutes from now (so it can still be cancelled) and within the next ${NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS} hours. Delivery can lag up to a few minutes behind the time shown here.`;

@Component({
  selector: 'lfx-newsletter-send-step',
  imports: [ButtonComponent, CalendarComponent, TimePickerComponent],
  templateUrl: './newsletter-send-step.component.html',
})
export class NewsletterSendStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly subject = input<string>('');
  public readonly recipientCount = input<number | null>(null);
  public readonly committeeCount = input<number>(0);
  public readonly edName = input<string>('');
  public readonly displayName = input<string>('');
  public readonly edReplyEmail = input<string>('');
  public readonly edEmail = input<string>('');
  public readonly canSend = input<boolean>(false);
  public readonly sending = input<boolean>(false);
  public readonly canSendTest = input<boolean>(false);
  public readonly testSending = input<boolean>(false);
  public readonly sendMode = input<'now' | 'schedule'>('now');
  public readonly scheduleMinDate = input<Date | null>(null);
  public readonly scheduleMaxDate = input<Date | null>(null);
  public readonly scheduleMinDateTime = input<Date | null>(null);
  public readonly scheduleSummary = input<string>('');
  public readonly scheduleWindowError = input<NewsletterScheduleWindowError | null>(null);
  public readonly canSchedule = input<boolean>(false);
  public readonly scheduling = input<boolean>(false);
  public readonly isScheduleReadOnly = input<boolean>(false);
  public readonly cancelingSchedule = input<boolean>(false);

  public readonly send = output<void>();
  public readonly sendTest = output<void>();
  public readonly schedule = output<void>();
  public readonly cancelSchedule = output<void>();

  protected readonly sendModeOptions = SEND_MODE_OPTIONS;
  protected readonly scheduleRulesText = SCHEDULE_RULES_TEXT;
  protected readonly scheduleWindowMessage = computed<string | null>(() => {
    const error = this.scheduleWindowError();
    return error ? SCHEDULE_WINDOW_MESSAGES[error] : null;
  });

  // The radio cards bind directly to the form control (like the date/time pickers below
  // already do) rather than emitting an output — sendMode is a plain @Input mirror the
  // parent keeps in sync with the form, the same pattern the select-button toggle used.
  protected selectSendMode(mode: 'now' | 'schedule'): void {
    this.form().controls['sendMode']?.setValue(mode);
  }
}
