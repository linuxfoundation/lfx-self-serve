// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS, NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES } from '../constants/newsletter.constants';
import { NewsletterScheduleWindowError } from '../interfaces/newsletter.interface';
import { combineDateTime } from '../utils/date-time.utils';

/**
 * Group-level validator for a newsletter's schedule picker (`scheduleDate` +
 * `scheduleTime` + `scheduleTimezone` controls). Mirrors the shape of
 * `futureDateTimeValidator` in `meeting.validators.ts`, but reports a
 * discriminated reason rather than a single boolean, because the three
 * failure modes call for different UI responses:
 *
 * - `'past'`: the picked time has drifted behind now — save-time validation
 *   upstream will reject it, so the caller should clear the picker.
 * - `'tooSoon'`: still in the future, but inside the UI-enforced minimum lead
 *   (`NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES`) — saves fine, only arming should
 *   be blocked.
 * - `'tooFar'`: beyond the UI-enforced horizon (`NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS`,
 *   SendGrid's own send_at ceiling) — also saves fine, only arming should be
 *   blocked.
 *
 * Returns `null` when either `scheduleDate` or `scheduleTime` is empty —
 * that's "send now," not an invalid schedule.
 */
export function newsletterScheduleWindowValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const formGroup = control as any; // FormGroup
    const scheduleDate = formGroup.get?.('scheduleDate')?.value;
    const scheduleTime = formGroup.get?.('scheduleTime')?.value;
    const scheduleTimezone = formGroup.get?.('scheduleTimezone')?.value;

    if (!scheduleDate || !scheduleTime) {
      return null; // No schedule picked — nothing to validate.
    }

    const combined = combineDateTime(scheduleDate, scheduleTime, scheduleTimezone);
    if (!combined) {
      return null; // Invalid time format — timeFormatValidator-style checks own this.
    }

    const scheduledAtMs = new Date(combined).getTime();
    const nowMs = Date.now();
    const minLeadMs = NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES * 60_000;
    const maxHorizonMs = NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS * 60 * 60_000;

    let reason: NewsletterScheduleWindowError | null = null;
    if (scheduledAtMs <= nowMs) {
      reason = 'past';
    } else if (scheduledAtMs < nowMs + minLeadMs) {
      reason = 'tooSoon';
    } else if (scheduledAtMs > nowMs + maxHorizonMs) {
      reason = 'tooFar';
    }

    return reason ? { scheduleWindow: reason } : null;
  };
}
